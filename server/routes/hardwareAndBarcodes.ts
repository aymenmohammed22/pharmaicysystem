import type { Express, Request, Response } from 'express';
import { sqlite, currentTimestamp, logAudit, syncMedicineFromBatches } from '../db.ts';
import { requireAuth, requirePermission, getPharmacyId, type AuthedRequest } from '../middleware.ts';
import {
  detectBarcodeSymbology,
  generateInternalEan13,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
  normalizeScannerInput,
  parseGs1Barcode,
} from '../../shared/gs1Barcode.ts';

const DEFAULT_HARDWARE_DEVICES = [
  {
    device_key: 'default_a4_pdf',
    name: 'طابعة تقارير A4 وحفظ PDF (النظام)',
    device_type: 'a4_printer',
    connection_type: 'browser_print',
    protocol: 'HTML_CSS',
    paper_width_mm: 210,
    label_width_mm: 210,
    label_height_mm: 297,
    dpi: 300,
    is_default: 1,
    settings_json: JSON.stringify({ marginTopMm: 10, marginSideMm: 10, orientation: 'portrait' }),
  },
  {
    device_key: 'default_thermal_80',
    name: 'طابعة إيصالات حرارية 80mm',
    device_type: 'thermal_printer',
    connection_type: 'browser_print',
    protocol: 'ESCPOS',
    paper_width_mm: 80,
    label_width_mm: 80,
    label_height_mm: 0,
    dpi: 203,
    is_default: 1,
    settings_json: JSON.stringify({ autoCut: true, openDrawer: false, bridgeUrl: 'http://127.0.0.1:9191' }),
  },
  {
    device_key: 'default_label_50x25',
    name: 'طابعة ملصقات باركود 50×25 mm',
    device_type: 'label_printer',
    connection_type: 'browser_print',
    protocol: 'TSPL',
    paper_width_mm: 50,
    label_width_mm: 50,
    label_height_mm: 25,
    dpi: 203,
    is_default: 1,
    settings_json: JSON.stringify({ gapMm: 2, darkLevel: 10, columns: 1 }),
  },
  {
    device_key: 'default_hid_scanner',
    name: 'ماسح الباركود USB / Bluetooth (HID & 2D GS1)',
    device_type: 'barcode_scanner',
    connection_type: 'usb_hid',
    protocol: 'HID',
    paper_width_mm: 0,
    label_width_mm: 0,
    label_height_mm: 0,
    dpi: 0,
    is_default: 1,
    settings_json: JSON.stringify({
      suffixKey: 'Enter',
      burstMaxIntervalMs: 65,
      autoSwitchArabicLayout: true,
      gs1Enabled: true,
    }),
  },
];

function ensureDefaultHardwareDevices(pharmId: number): void {
  const existing = (
    sqlite.prepare('SELECT COUNT(*) AS c FROM hardware_devices WHERE pharmacy_id = ?').get(pharmId) as { c: number }
  ).c;
  if (existing > 0) return;

  const now = currentTimestamp();
  const ins = sqlite.prepare(
    `INSERT INTO hardware_devices
      (device_key, name, device_type, connection_type, protocol, host, port, baud_rate, paper_width_mm, label_width_mm, label_height_mm, dpi, is_default, is_active, settings_json, last_seen_at, last_status, terminal_id, branch_id, pharmacy_id, created_at)
     VALUES (?, ?, ?, ?, ?, '', 9100, 9600, ?, ?, ?, ?, ?, 1, ?, '', 'configured', 'POS-01', 1, ?, ?)`,
  );
  for (const d of DEFAULT_HARDWARE_DEVICES) {
    ins.run(
      d.device_key,
      d.name,
      d.device_type,
      d.connection_type,
      d.protocol,
      d.paper_width_mm,
      d.label_width_mm,
      d.label_height_mm,
      d.dpi,
      d.is_default,
      d.settings_json,
      pharmId,
      now,
    );
  }
}

export function registerHardwareAndBarcodeRoutes(app: Express): void {
  // =========================================================================
  // Stage 4: Multi-Barcode & Unit/Batch Barcode Management API
  // =========================================================================
  app.get('/api/barcodes', requireAuth, requirePermission('viewInventories'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const medicineId = req.query.medicineId ? Number(req.query.medicineId) : null;
    const barcodes = medicineId
      ? sqlite
          .prepare(
            `SELECT pb.*, i.name AS medicine_name, mb.batch_number
             FROM product_barcodes pb
             JOIN inventeries i ON i.id = pb.medicine_id
             LEFT JOIN medicine_batches mb ON mb.id = pb.batch_id
             WHERE pb.pharmacy_id = ? AND pb.medicine_id = ?
             ORDER BY pb.is_primary DESC, pb.is_active DESC, pb.id DESC`,
          )
          .all(pharmId, medicineId)
      : sqlite
          .prepare(
            `SELECT pb.*, i.name AS medicine_name, mb.batch_number
             FROM product_barcodes pb
             JOIN inventeries i ON i.id = pb.medicine_id
             LEFT JOIN medicine_batches mb ON mb.id = pb.batch_id
             WHERE pb.pharmacy_id = ?
             ORDER BY pb.medicine_id ASC, pb.is_primary DESC, pb.id DESC
             LIMIT 500`,
          )
          .all(pharmId);

    const history = medicineId
      ? sqlite
          .prepare(
            'SELECT * FROM barcode_history WHERE pharmacy_id = ? AND medicine_id = ? ORDER BY id DESC LIMIT 50',
          )
          .all(pharmId, medicineId)
      : [];

    return res.json({ barcodes, history });
  });

  app.post('/api/barcodes/generate', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    let candidate = generateInternalEan13();
    for (let i = 0; i < 15; i += 1) {
      const clashInv = sqlite
        .prepare('SELECT id FROM inventeries WHERE pharmacy_id = ? AND barcode = ? LIMIT 1')
        .get(pharmId, candidate);
      const clashPb = sqlite
        .prepare('SELECT id FROM product_barcodes WHERE pharmacy_id = ? AND barcode = ? LIMIT 1')
        .get(pharmId, candidate);
      if (!clashInv && !clashPb) break;
      candidate = generateInternalEan13();
    }
    return res.json({ barcode: candidate, symbology: 'EAN13', validCheckDigit: isValidEan13(candidate) });
  });

  app.post('/api/barcodes', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const medicineId = Number(req.body?.medicineId);
    const batchId = req.body?.batchId ? Number(req.body.batchId) : null;
    const rawBarcode = String(req.body?.barcode ?? '').trim();
    const barcode = normalizeScannerInput(rawBarcode, { preserveGs: false });
    const unitType = ['pack', 'strip', 'piece', 'box', 'batch'].includes(String(req.body?.unitType))
      ? String(req.body.unitType)
      : 'pack';
    const isPrimary = Boolean(req.body?.isPrimary);
    const notes = String(req.body?.notes ?? '').trim();
    const validateCheck = Boolean(req.body?.validateCheckDigit);

    if (!medicineId || !barcode) {
      return res.status(400).json({ error: 'يرجى تحديد الدواء وإدخال رقم الباركود' });
    }

    const med = sqlite
      .prepare('SELECT * FROM inventeries WHERE id = ? AND pharmacy_id = ?')
      .get(medicineId, pharmId) as Record<string, unknown> | undefined;
    if (!med) return res.status(404).json({ error: 'الدواء غير موجود في هذه الصيدلية' });

    if (batchId) {
      const b = sqlite
        .prepare('SELECT id FROM medicine_batches WHERE id = ? AND medicine_id = ?')
        .get(batchId, medicineId);
      if (!b) return res.status(400).json({ error: 'التشغيلة المحددة لا تتبع لهذا الدواء' });
    }

    const requestedSymbology = String(req.body?.symbology ?? '').trim().toUpperCase();
    const symbology = ['EAN13', 'EAN8', 'ITF14', 'CODE128', 'GS1_DATAMATRIX', 'QR'].includes(requestedSymbology)
      ? requestedSymbology
      : detectBarcodeSymbology(barcode);

    if (validateCheck) {
      if (symbology === 'EAN13' && !isValidEan13(barcode)) {
        return res.status(400).json({ error: 'رمز EAN-13 غير صالح (خطأ في رقم التحقق Check Digit)' });
      }
      if (symbology === 'EAN8' && !isValidEan8(barcode)) {
        return res.status(400).json({ error: 'رمز EAN-8 غير صالح (خطأ في رقم التحقق Check Digit)' });
      }
      if (symbology === 'ITF14' && !isValidGtin14(barcode)) {
        return res.status(400).json({ error: 'رمز ITF-14 / GTIN-14 غير صالح (خطأ في رقم التحقق)' });
      }
    }

    const clashPb = sqlite
      .prepare('SELECT id, medicine_id FROM product_barcodes WHERE pharmacy_id = ? AND barcode = ? AND is_active = 1 LIMIT 1')
      .get(pharmId, barcode) as { id: number; medicine_id: number } | undefined;
    const clashInv = sqlite
      .prepare('SELECT id FROM inventeries WHERE pharmacy_id = ? AND barcode = ? AND id != ? LIMIT 1')
      .get(pharmId, barcode, medicineId) as { id: number } | undefined;
    if (clashPb || clashInv) {
      return res.status(409).json({ error: `الباركود (${barcode}) مستخدم مسبقاً لصنف آخر في هذه الصيدلية` });
    }

    let unitName = String(req.body?.unitName ?? '').trim();
    let unitFactor = Number(req.body?.unitFactor ?? 0);
    if (!unitName || unitFactor <= 0) {
      if (unitType === 'strip') {
        const spp = Math.max(1, Number(med.strips_per_pack) || 1);
        unitName = unitName || String(med.strip_unit || 'شريط');
        unitFactor = unitFactor > 0 ? unitFactor : Number((1 / spp).toFixed(4));
      } else if (unitType === 'piece') {
        const ppp = Math.max(1, Number(med.pieces_per_pack) || 1);
        unitName = unitName || String(med.piece_unit || 'حبة');
        unitFactor = unitFactor > 0 ? unitFactor : Number((1 / ppp).toFixed(4));
      } else {
        unitName = unitName || String(med.pack_unit || 'علبة');
        unitFactor = unitFactor > 0 ? unitFactor : 1;
      }
    }

    const now = currentTimestamp();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const prevPrimary = String(med.barcode || '');
      if (isPrimary) {
        sqlite.prepare('UPDATE product_barcodes SET is_primary = 0 WHERE pharmacy_id = ? AND medicine_id = ?').run(pharmId, medicineId);
        sqlite.prepare('UPDATE inventeries SET barcode = ? WHERE id = ? AND pharmacy_id = ?').run(barcode, medicineId, pharmId);
      }

      const info = sqlite
        .prepare(
          `INSERT INTO product_barcodes
            (medicine_id, batch_id, barcode, symbology, unit_type, unit_name, unit_factor, is_primary, is_active, notes, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(medicineId, batchId, barcode, symbology, unitType, unitName, unitFactor, isPrimary ? 1 : 0, notes, pharmId, now);
      const newId = Number(info.lastInsertRowid);

      sqlite
        .prepare(
          `INSERT INTO barcode_history
            (medicine_id, old_barcode, new_barcode, unit_type, action, changed_by, changed_by_name, notes, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          medicineId,
          isPrimary ? prevPrimary : '',
          barcode,
          unitType,
          isPrimary ? 'replace_primary' : 'assign',
          user.id,
          user.name,
          notes || `ربط باركود ${symbology} للوحدة (${unitName})`,
          pharmId,
          now,
        );

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'barcode_assign',
        entityType: 'product_barcode',
        entityId: newId,
        details: `إضافة باركود (${barcode}) للدواء #${medicineId} (${String(med.name)}) - وحدة ${unitName}`,
        pharmacyId: pharmId,
      });

      sqlite.exec('COMMIT');
      const record = sqlite.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(newId);
      return res.status(201).json({ barcodeRecord: record });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.patch('/api/barcodes/:id', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare('SELECT * FROM product_barcodes WHERE id = ? AND pharmacy_id = ?')
      .get(id, pharmId) as
      | { id: number; medicine_id: number; barcode: string; unit_type: string; is_primary: number; is_active: number }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'سجل الباركود غير موجود' });

    const nextActive = req.body?.isActive !== undefined ? (req.body.isActive ? 1 : 0) : existing.is_active;
    const setPrimary = Boolean(req.body?.isPrimary);

    if (existing.is_primary && nextActive === 0) {
      return res.status(400).json({ error: 'لا يمكن تعطيل الباركود الأساسي قبل تعيين باركود أساسي بديل للدواء' });
    }

    const now = currentTimestamp();
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (setPrimary) {
        const med = sqlite
          .prepare('SELECT barcode FROM inventeries WHERE id = ? AND pharmacy_id = ?')
          .get(existing.medicine_id, pharmId) as { barcode: string } | undefined;
        sqlite
          .prepare('UPDATE product_barcodes SET is_primary = 0 WHERE pharmacy_id = ? AND medicine_id = ?')
          .run(pharmId, existing.medicine_id);
        sqlite
          .prepare('UPDATE product_barcodes SET is_primary = 1, is_active = 1 WHERE id = ? AND pharmacy_id = ?')
          .run(id, pharmId);
        sqlite
          .prepare('UPDATE inventeries SET barcode = ? WHERE id = ? AND pharmacy_id = ?')
          .run(existing.barcode, existing.medicine_id, pharmId);
        sqlite
          .prepare(
            `INSERT INTO barcode_history
              (medicine_id, old_barcode, new_barcode, unit_type, action, changed_by, changed_by_name, notes, pharmacy_id, created_at)
             VALUES (?, ?, ?, ?, 'promote_primary', ?, ?, 'ترقية كباركود أساسي', ?, ?)`,
          )
          .run(existing.medicine_id, med?.barcode || '', existing.barcode, existing.unit_type, user.id, user.name, pharmId, now);
      } else {
        sqlite.prepare('UPDATE product_barcodes SET is_active = ? WHERE id = ? AND pharmacy_id = ?').run(nextActive, id, pharmId);
      }
      sqlite.exec('COMMIT');
      const updated = sqlite.prepare('SELECT * FROM product_barcodes WHERE id = ?').get(id);
      return res.json({ barcodeRecord: updated });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.delete('/api/barcodes/:id', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare('SELECT * FROM product_barcodes WHERE id = ? AND pharmacy_id = ?')
      .get(id, pharmId) as { id: number; medicine_id: number; barcode: string; unit_type: string; is_primary: number } | undefined;
    if (!existing) return res.status(404).json({ error: 'الباركود غير موجود' });
    if (existing.is_primary) {
      return res.status(400).json({ error: 'لا يمكن حذف الباركود الأساسي للدواء؛ قم بتعيين بديل أولاً' });
    }

    sqlite.prepare('DELETE FROM product_barcodes WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    sqlite
      .prepare(
        `INSERT INTO barcode_history
          (medicine_id, old_barcode, new_barcode, unit_type, action, changed_by, changed_by_name, notes, pharmacy_id, created_at)
         VALUES (?, ?, '', ?, 'delete', ?, ?, 'حذف باركود إضافي', ?, ?)`,
      )
      .run(existing.medicine_id, existing.barcode, existing.unit_type, user.id, user.name, pharmId, currentTimestamp());
    return res.json({ ok: true });
  });

  app.post('/api/barcodes/parse-gs1', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const raw = String(req.body?.barcode ?? '');
    const parsed = parseGs1Barcode(raw);
    let matchedMedicine: Record<string, unknown> | null = null;
    let matchedBatch: Record<string, unknown> | null = null;
    let matchedUnit: { unitType: string; unitName: string; unitFactor: number } | null = null;

    const candidateCodes = Array.from(
      new Set([parsed.gtin, parsed.gtin13, parsed.normalizedRaw].filter((v): v is string => Boolean(v))),
    );

    for (const c of candidateCodes) {
      const pb = sqlite
        .prepare(
          `SELECT pb.*, i.name AS medicine_name
           FROM product_barcodes pb
           JOIN inventeries i ON i.id = pb.medicine_id
           WHERE pb.pharmacy_id = ? AND pb.is_active = 1 AND pb.barcode = ?
           LIMIT 1`,
        )
        .get(pharmId, c) as Record<string, unknown> | undefined;
      if (pb) {
        matchedMedicine = sqlite
          .prepare('SELECT * FROM inventeries WHERE id = ? AND pharmacy_id = ?')
          .get(Number(pb.medicine_id), pharmId) as Record<string, unknown> | null;
        matchedUnit = {
          unitType: String(pb.unit_type || 'pack'),
          unitName: String(pb.unit_name || 'علبة'),
          unitFactor: Number(pb.unit_factor) || 1,
        };
        if (pb.batch_id) {
          matchedBatch = sqlite
            .prepare('SELECT * FROM medicine_batches WHERE id = ?')
            .get(Number(pb.batch_id)) as Record<string, unknown> | null;
        }
        break;
      }
      const inv = sqlite
        .prepare('SELECT * FROM inventeries WHERE pharmacy_id = ? AND barcode = ? LIMIT 1')
        .get(pharmId, c) as Record<string, unknown> | undefined;
      if (inv) {
        matchedMedicine = inv;
        break;
      }
    }

    if (matchedMedicine && parsed.batchNumber && !matchedBatch) {
      matchedBatch = sqlite
        .prepare('SELECT * FROM medicine_batches WHERE medicine_id = ? AND batch_number = ? LIMIT 1')
        .get(Number(matchedMedicine.id), parsed.batchNumber) as Record<string, unknown> | null;
    }

    return res.json({
      gs1: parsed,
      symbology: detectBarcodeSymbology(raw),
      matchedMedicine,
      matchedBatch,
      matchedUnit,
    });
  });

  // =========================================================================
  // Stage 6 & 7: Hardware Devices Center, Print Queue & Honest Diagnostics
  // =========================================================================
  app.get('/api/hardware/devices', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    ensureDefaultHardwareDevices(pharmId);
    const devices = sqlite
      .prepare('SELECT * FROM hardware_devices WHERE pharmacy_id = ? ORDER BY is_default DESC, id ASC')
      .all(pharmId);
    return res.json({ devices });
  });

  app.post('/api/hardware/devices', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    ensureDefaultHardwareDevices(pharmId);

    const name = String(req.body?.name ?? '').trim();
    const deviceType = ['thermal_printer', 'label_printer', 'a4_printer', 'barcode_scanner'].includes(
      String(req.body?.deviceType),
    )
      ? String(req.body.deviceType)
      : 'thermal_printer';
    const connectionType = ['browser_print', 'usb_hid', 'usb_serial', 'network_tcp', 'local_bridge', 'electron_ipc'].includes(
      String(req.body?.connectionType),
    )
      ? String(req.body.connectionType)
      : 'browser_print';
    const protocol = ['HTML_CSS', 'ESCPOS', 'ZPL', 'TSPL', 'HID'].includes(String(req.body?.protocol))
      ? String(req.body.protocol)
      : 'HTML_CSS';
    const host = String(req.body?.host ?? '').trim();
    const port = Math.max(1, Math.min(65535, Number(req.body?.port ?? 9100) || 9100));
    const baudRate = Number(req.body?.baudRate ?? 9600) || 9600;
    const paperWidthMm = Math.max(0, Number(req.body?.paperWidthMm ?? 80) || 0);
    const labelWidthMm = Math.max(0, Number(req.body?.labelWidthMm ?? 50) || 0);
    const labelHeightMm = Math.max(0, Number(req.body?.labelHeightMm ?? 25) || 0);
    const dpi = Number(req.body?.dpi ?? 203) || 203;
    const isDefault = Boolean(req.body?.isDefault);
    const terminalId = String(req.body?.terminalId ?? 'POS-01').trim() || 'POS-01';
    const branchId = Number(req.body?.branchId ?? 1) || 1;
    const settingsJson =
      typeof req.body?.settings === 'object' && req.body.settings !== null
        ? JSON.stringify(req.body.settings)
        : String(req.body?.settingsJson ?? '{}');

    if (!name) return res.status(400).json({ error: 'اسم الجهاز مطلوب' });

    const now = currentTimestamp();
    const deviceKey = `dev_${deviceType}_${Date.now()}`;
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (isDefault) {
        sqlite
          .prepare('UPDATE hardware_devices SET is_default = 0 WHERE pharmacy_id = ? AND device_type = ?')
          .run(pharmId, deviceType);
      }
      const info = sqlite
        .prepare(
          `INSERT INTO hardware_devices
            (device_key, name, device_type, connection_type, protocol, host, port, baud_rate, paper_width_mm, label_width_mm, label_height_mm, dpi, is_default, is_active, settings_json, last_seen_at, last_status, terminal_id, branch_id, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '', 'configured', ?, ?, ?, ?)`,
        )
        .run(
          deviceKey,
          name,
          deviceType,
          connectionType,
          protocol,
          host,
          port,
          baudRate,
          paperWidthMm,
          labelWidthMm,
          labelHeightMm,
          dpi,
          isDefault ? 1 : 0,
          settingsJson,
          terminalId,
          branchId,
          pharmId,
          now,
        );
      const id = Number(info.lastInsertRowid);
      sqlite
        .prepare(
          `INSERT INTO hardware_audit_logs
            (device_id, device_name, event_type, transport, status, details, user_id, user_name, pharmacy_id, created_at)
           VALUES (?, ?, 'device_register', ?, 'configured', ?, ?, ?, ?, ?)`,
        )
        .run(id, name, connectionType, `إضافة جهاز ${deviceType} ببروتوكول ${protocol}`, user.id, user.name, pharmId, now);
      sqlite.exec('COMMIT');
      const device = sqlite.prepare('SELECT * FROM hardware_devices WHERE id = ?').get(id);
      return res.status(201).json({ device });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.put('/api/hardware/devices/:id', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare('SELECT * FROM hardware_devices WHERE id = ? AND pharmacy_id = ?')
      .get(id, pharmId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'الجهاز غير موجود' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name);
    const connectionType = req.body?.connectionType !== undefined ? String(req.body.connectionType) : String(existing.connection_type);
    const protocol = req.body?.protocol !== undefined ? String(req.body.protocol) : String(existing.protocol);
    const host = req.body?.host !== undefined ? String(req.body.host).trim() : String(existing.host);
    const port = req.body?.port !== undefined ? Number(req.body.port) : Number(existing.port);
    const baudRate = req.body?.baudRate !== undefined ? Number(req.body.baudRate) : Number(existing.baud_rate);
    const paperWidthMm = req.body?.paperWidthMm !== undefined ? Number(req.body.paperWidthMm) : Number(existing.paper_width_mm);
    const labelWidthMm = req.body?.labelWidthMm !== undefined ? Number(req.body.labelWidthMm) : Number(existing.label_width_mm);
    const labelHeightMm = req.body?.labelHeightMm !== undefined ? Number(req.body.labelHeightMm) : Number(existing.label_height_mm);
    const dpi = req.body?.dpi !== undefined ? Number(req.body.dpi) : Number(existing.dpi);
    const isDefault = req.body?.isDefault !== undefined ? (req.body.isDefault ? 1 : 0) : Number(existing.is_default);
    const isActive = req.body?.isActive !== undefined ? (req.body.isActive ? 1 : 0) : Number(existing.is_active);
    const settingsJson =
      req.body?.settings !== undefined
        ? JSON.stringify(req.body.settings)
        : req.body?.settingsJson !== undefined
          ? String(req.body.settingsJson)
          : String(existing.settings_json);

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (isDefault === 1) {
        sqlite
          .prepare('UPDATE hardware_devices SET is_default = 0 WHERE pharmacy_id = ? AND device_type = ?')
          .run(pharmId, String(existing.device_type));
      }
      sqlite
        .prepare(
          `UPDATE hardware_devices
           SET name = ?, connection_type = ?, protocol = ?, host = ?, port = ?, baud_rate = ?,
               paper_width_mm = ?, label_width_mm = ?, label_height_mm = ?, dpi = ?,
               is_default = ?, is_active = ?, settings_json = ?
           WHERE id = ? AND pharmacy_id = ?`,
        )
        .run(
          name,
          connectionType,
          protocol,
          host,
          port,
          baudRate,
          paperWidthMm,
          labelWidthMm,
          labelHeightMm,
          dpi,
          isDefault,
          isActive,
          settingsJson,
          id,
          pharmId,
        );
      sqlite
        .prepare(
          `INSERT INTO hardware_audit_logs
            (device_id, device_name, event_type, transport, status, details, user_id, user_name, pharmacy_id, created_at)
           VALUES (?, ?, 'device_update', ?, 'updated', ?, ?, ?, ?, ?)`,
        )
        .run(id, name, connectionType, `تحديث إعدادات الجهاز (${protocol})`, user.id, user.name, pharmId, currentTimestamp());
      sqlite.exec('COMMIT');
      const device = sqlite.prepare('SELECT * FROM hardware_devices WHERE id = ?').get(id);
      return res.json({ device });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.delete('/api/hardware/devices/:id', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const info = sqlite.prepare('DELETE FROM hardware_devices WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    if (info.changes === 0) return res.status(404).json({ error: 'الجهاز غير موجود' });
    return res.json({ ok: true });
  });

  app.post('/api/hardware/devices/:id/audit', requireAuth, (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const device = sqlite
      .prepare('SELECT id, name, connection_type FROM hardware_devices WHERE id = ? AND pharmacy_id = ?')
      .get(id, pharmId) as { id: number; name: string; connection_type: string } | undefined;
    if (!device) return res.status(404).json({ error: 'الجهاز غير موجود' });

    const eventType = String(req.body?.eventType ?? 'client_diagnostic').trim();
    const transport = String(req.body?.transport ?? device.connection_type).trim();
    const status = String(req.body?.status ?? 'reported').trim();
    const details = String(req.body?.details ?? '').trim();
    const now = currentTimestamp();

    sqlite
      .prepare('UPDATE hardware_devices SET last_seen_at = ?, last_status = ? WHERE id = ? AND pharmacy_id = ?')
      .run(now, status, id, pharmId);

    sqlite
      .prepare(
        `INSERT INTO hardware_audit_logs
          (device_id, device_name, event_type, transport, status, details, user_id, user_name, pharmacy_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, device.name, eventType, transport, status, details, user.id, user.name, pharmId, now);

    const updated = sqlite.prepare('SELECT * FROM hardware_devices WHERE id = ?').get(id);
    return res.json({ device: updated });
  });

  app.get('/api/hardware/print-jobs', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const jobs = sqlite
      .prepare(
        `SELECT pj.*, hd.name AS device_name
         FROM print_jobs pj
         LEFT JOIN hardware_devices hd ON hd.id = pj.device_id
         WHERE pj.pharmacy_id = ?
         ORDER BY pj.id DESC
         LIMIT 100`,
      )
      .all(pharmId);
    const logs = sqlite
      .prepare('SELECT * FROM hardware_audit_logs WHERE pharmacy_id = ? ORDER BY id DESC LIMIT 100')
      .all(pharmId);
    return res.json({ jobs, logs });
  });

  app.post('/api/hardware/print-jobs', requireAuth, (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const jobType = String(req.body?.jobType ?? 'invoice_receipt').trim();
    const title = String(req.body?.title ?? 'مهمة طباعة').trim();
    const deviceId = req.body?.deviceId ? Number(req.body.deviceId) : null;
    const protocol = String(req.body?.protocol ?? 'HTML_CSS').trim();
    const transport = String(req.body?.transport ?? 'browser_print').trim();
    const status = ['queued', 'dispatched', 'completed', 'failed', 'cancelled'].includes(String(req.body?.status))
      ? String(req.body.status)
      : 'queued';
    const copies = Math.max(1, Math.min(200, Number(req.body?.copies ?? 1) || 1));
    const payloadPreview = String(req.body?.payloadPreview ?? '').slice(0, 4000);
    const errorMessage = String(req.body?.errorMessage ?? '').trim();
    const referenceType = String(req.body?.referenceType ?? '').trim();
    const referenceId = req.body?.referenceId ? Number(req.body.referenceId) : null;
    const now = currentTimestamp();
    const completedAt = status === 'completed' ? now : '';

    const info = sqlite
      .prepare(
        `INSERT INTO print_jobs
          (job_type, title, device_id, protocol, transport, status, copies, payload_preview, error_message, reference_type, reference_id, created_by, created_by_name, pharmacy_id, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        jobType,
        title,
        deviceId,
        protocol,
        transport,
        status,
        copies,
        payloadPreview,
        errorMessage,
        referenceType,
        referenceId,
        user.id,
        user.name,
        pharmId,
        now,
        completedAt,
      );
    const jobId = Number(info.lastInsertRowid);
    sqlite
      .prepare(
        `INSERT INTO hardware_audit_logs
          (device_id, device_name, event_type, transport, status, details, user_id, user_name, pharmacy_id, created_at)
         VALUES (?, '', 'print_job', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(deviceId, transport, status, `${title} (${protocol} × ${copies})`, user.id, user.name, pharmId, now);

    const job = sqlite.prepare('SELECT * FROM print_jobs WHERE id = ?').get(jobId);
    return res.status(201).json({ job });
  });

  app.patch('/api/hardware/print-jobs/:id', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare('SELECT * FROM print_jobs WHERE id = ? AND pharmacy_id = ?')
      .get(id, pharmId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'مهمة الطباعة غير موجودة' });

    const nextStatus = ['queued', 'dispatched', 'completed', 'failed', 'cancelled'].includes(String(req.body?.status))
      ? String(req.body.status)
      : String(existing.status);
    const errMsg = req.body?.errorMessage !== undefined ? String(req.body.errorMessage) : String(existing.error_message || '');
    const completedAt = nextStatus === 'completed' ? currentTimestamp() : '';

    sqlite
      .prepare('UPDATE print_jobs SET status = ?, error_message = ?, completed_at = ? WHERE id = ? AND pharmacy_id = ?')
      .run(nextStatus, errMsg, completedAt, id, pharmId);

    const job = sqlite.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    return res.json({ job });
  });
}
