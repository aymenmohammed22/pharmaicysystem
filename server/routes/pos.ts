import type { Express, Request, Response } from 'express';
import {
  sqlite,
  currentTimestamp,
  getSiteSettings,
  resolveSiteCurrency,
  getAdminName,
  isExpired,
  rowToInventory,
  syncMedicineFromBatches,
  recordStockMovement,
  postJournalEntry,
  logAudit,
  resolvePharmacyAccountId,
} from '../db.ts';
import type { BillItem, SessionData } from '../db.ts';
import { parseGs1Barcode } from '../../shared/gs1Barcode.ts';
import { requireAuth, requirePermission, getPharmacyId, normalizeScannerInput, type AuthedRequest } from '../middleware.ts';

function getOpenShiftForUser(userId: number, pharmacyId: number) {
  return sqlite
    .prepare("SELECT * FROM pos_shifts WHERE user_id = ? AND pharmacy_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
    .get(userId, pharmacyId) as Record<string, unknown> | undefined;
}

function getOrConvertUnitDetails(
  med: ReturnType<typeof rowToInventory>,
  requestedSaleUnit?: string,
): { saleUnit: string; unitFactor: number; unitPrice: number } {
  const baseSell = Number(med.price) || 0;
  const su = (requestedSaleUnit || '').trim();
  if (su && su === med.stripUnit && med.stripsPerPack > 1) {
    return {
      saleUnit: med.stripUnit,
      unitFactor: Number((1 / med.stripsPerPack).toFixed(4)),
      unitPrice: med.stripPrice > 0 ? med.stripPrice : Number((baseSell / med.stripsPerPack).toFixed(2)),
    };
  }
  if (su && su === med.pieceUnit && med.piecesPerPack > 1) {
    return {
      saleUnit: med.pieceUnit,
      unitFactor: Number((1 / med.piecesPerPack).toFixed(4)),
      unitPrice: med.piecePrice > 0 ? med.piecePrice : Number((baseSell / med.piecesPerPack).toFixed(2)),
    };
  }
  return {
    saleUnit: med.packUnit || 'علبة',
    unitFactor: 1,
    unitPrice: baseSell,
  };
}

export function registerPosRoutes(app: Express): void {
  // --- POS Shifts ---
  app.get('/api/shifts', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const currentShift = getOpenShiftForUser(user.id, pharmId) || null;
    const shifts = sqlite
      .prepare('SELECT * FROM pos_shifts WHERE pharmacy_id = ? ORDER BY id DESC LIMIT 50')
      .all(pharmId);
    return res.json({ currentShift, shifts });
  });

  app.post('/api/shifts/open', requireAuth, requirePermission('manageShifts'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const existing = getOpenShiftForUser(user.id, pharmId);
    if (existing) {
      return res.status(400).json({ error: 'يوجد لديك وردية مفتوحة بالفعل' });
    }
    const openingCash = Math.max(0, Number(req.body?.openingCash ?? 0));
    const reqWh = req.body?.warehouseId ? Number(req.body.warehouseId) : 0;
    const whRow = (
      reqWh
        ? sqlite.prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?').get(reqWh, pharmId)
        : sqlite.prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId)
    ) as { id: number } | undefined;
    const warehouseId = whRow?.id || 1;
    const info = sqlite
      .prepare(
        `INSERT INTO pos_shifts (user_id, user_name, warehouse_id, opened_at, opening_cash, expected_cash, status, pharmacy_id)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .run(user.id, user.name, warehouseId, currentTimestamp(), openingCash, openingCash, pharmId);
    const shiftId = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'open_shift',
      entityType: 'pos_shift',
      entityId: shiftId,
      details: `فتح وردية كاشير برصيد افتتاحي ${openingCash}`,
      pharmacyId: pharmId,
    });
    const shift = sqlite.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(shiftId);
    return res.status(201).json({ shift });
  });

  app.post('/api/shifts/:id/close', requireAuth, requirePermission('manageShifts'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const shift = sqlite.prepare('SELECT * FROM pos_shifts WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | {
          id: number;
          user_id: number;
          status: string;
          opening_cash: number;
          cash_sales: number;
          cash_returns: number;
        }
      | undefined;
    if (!shift) return res.status(404).json({ error: 'الوردية غير موجودة' });
    if (shift.status !== 'open') return res.status(400).json({ error: 'هذه الوردية مغلقة مسبقاً' });

    const actualCash = Math.max(0, Number(req.body?.actualCash ?? 0));
    const notes = String(req.body?.notes ?? '').trim();
    const expectedCash = Number((shift.opening_cash + shift.cash_sales - shift.cash_returns).toFixed(2));
    const variance = Number((actualCash - expectedCash).toFixed(2));

    sqlite
      .prepare(
        `UPDATE pos_shifts
         SET closed_at = ?, expected_cash = ?, actual_cash = ?, variance = ?, status = 'closed', notes = ?
         WHERE id = ? AND pharmacy_id = ?`,
      )
      .run(currentTimestamp(), expectedCash, actualCash, variance, notes, id, pharmId);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'close_shift',
      entityType: 'pos_shift',
      entityId: id,
      details: `إغلاق ومطابقة الوردية #${id}: المتوقع ${expectedCash}، الفعلي ${actualCash}، الفارق ${variance}`,
      pharmacyId: pharmId,
    });
    const updated = sqlite.prepare('SELECT * FROM pos_shifts WHERE id = ?').get(id);
    return res.json({ shift: updated });
  });

  // --- Held Bills (تعليق الفواتير واستكمالها) ---
  app.get('/api/bill/held', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const held = sqlite
      .prepare(
        `SELECT h.*, u.name AS user_name
         FROM held_bills h LEFT JOIN users u ON u.id = h.user_id
         WHERE h.pharmacy_id = ?
         ORDER BY h.id DESC`,
      )
      .all(pharmId);
    return res.json({ held });
  });

  app.post('/api/bill/hold', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session, user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    if (session.bill.length === 0) {
      return res.status(400).json({ error: 'السلة فارغة ولا توجد أصناف لتعليقها' });
    }
    const customerName = String(req.body?.customerName ?? '').trim();
    const label = String(req.body?.label ?? '').trim() || customerName || `فاتورة معلقة ${new Date().toLocaleTimeString('en-GB')}`;
    const discount = Number(req.body?.discount) || 0;

    const info = sqlite
      .prepare(
        'INSERT INTO held_bills (label, customer_name, items_json, discount, user_id, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(label, customerName, JSON.stringify(session.bill), discount, user.id, pharmId, currentTimestamp());
    session.bill = [];
    return res.status(201).json({ id: Number(info.lastInsertRowid), bill: [] });
  });

  app.post('/api/bill/held/:id/resume', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const held = sqlite.prepare('SELECT * FROM held_bills WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { id: number; items_json: string; discount: number; customer_name: string }
      | undefined;
    if (!held) return res.status(404).json({ error: 'الفاتورة المعلقة غير موجودة' });
    try {
      session.bill = JSON.parse(held.items_json) as BillItem[];
    } catch {
      session.bill = [];
    }
    sqlite.prepare('DELETE FROM held_bills WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    return res.json({ bill: session.bill, discount: held.discount, customerName: held.customer_name });
  });

  app.delete('/api/bill/held/:id', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    sqlite.prepare('DELETE FROM held_bills WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    return res.json({ ok: true });
  });

  // --- Bill Cart Management ---
  app.get('/api/bill', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    return res.json({ bill: session.bill });
  });

  function addMedicineToSessionBill(session: SessionData, medId: number, pharmacyId: number, saleUnit?: string) {
    const medRow = sqlite.prepare('SELECT * FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(medId, pharmacyId) as
      | Record<string, unknown>
      | undefined;
    if (!medRow) {
      return { status: 404, error: 'الدواء غير موجود في المخزون' };
    }
    const med = rowToInventory(medRow);
    if (med.status === 'suspended') {
      return { status: 400, error: `الدواء "${med.name}" موقوف حالياً عن الصرف` };
    }
    if (med.quantity <= 0) {
      return { status: 400, error: `الدواء "${med.name}" نفد من المخزون حالياً` };
    }

    // Check active non-expired batches (FEFO)
    const today = new Date().toISOString().slice(0, 10);
    const validBatchRow = sqlite
      .prepare(
        `SELECT COALESCE(SUM(qty_remaining), 0) AS avail, MIN(expiry_date) AS nextExp
         FROM medicine_batches
         WHERE medicine_id = ? AND status = 'active' AND qty_remaining > 0 AND (expiry_date = '' OR expiry_date >= ?)`,
      )
      .get(med.id, today) as { avail: number; nextExp: string | null };

    if (validBatchRow.avail <= 0) {
      if (isExpired(med.expiryDate)) {
        return { status: 400, error: `لا يمكن بيع "${med.name}" لأن تشغيلاته منتهية الصلاحية` };
      }
      return { status: 400, error: `لا توجد تشغيلات نشطة صالحة للبيع للدواء "${med.name}"` };
    }

    const { saleUnit: finalSaleUnit, unitFactor, unitPrice } = getOrConvertUnitDetails(med, saleUnit);
    const existing = session.bill.find((b) => b.id === med.id && b.saleUnit === finalSaleUnit);

    const otherUsedPacks = session.bill
      .filter((b) => b.id === med.id)
      .reduce((s, b) => s + b.qty * b.unitFactor, 0);
    if (otherUsedPacks + unitFactor > validBatchRow.avail + 0.0001) {
      return {
        status: 400,
        error: `الكمية المطلوبة من "${med.name}" تتجاوز الرصيد الصالح المتاح (${validBatchRow.avail})`,
      };
    }

    if (existing) {
      existing.qty += 1;
    } else {
      session.bill.push({
        id: med.id,
        name: med.name,
        scientificName: med.scientificName,
        dosageForm: med.dosageForm,
        unit: med.unit,
        saleUnit: finalSaleUnit,
        unitFactor,
        price: unitPrice,
        discountPct: 0,
        company: med.company,
        barcode: med.barcode,
        batchNumber: med.batchNumber,
        qty: 1,
      });
    }
    return { status: 200, med };
  }

  app.post('/api/bill/add', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.body?.id);
    const saleUnit = req.body?.saleUnit ? String(req.body.saleUnit) : undefined;
    const result = addMedicineToSessionBill(session, id, pharmId, saleUnit);
    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.json({ bill: session.bill });
  });

  app.post('/api/bill/scan', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const rawCode = String(req.body?.barcode ?? '').trim();
    const gs1 = parseGs1Barcode(rawCode);
    const code = normalizeScannerInput(rawCode, { preserveGs: false });
    if (!code && !gs1.gtin) return res.status(400).json({ error: 'يرجى إدخال أو مسح رقم الباركود أو اسم الدواء' });

    if (gs1.isGs1 && gs1.isExpired) {
      return res.status(400).json({
        error: `تحذير سلامة: العبوة الممسوحة منتهية الصلاحية حسب رمز GS1 (17): ${gs1.expiryDate}`,
      });
    }

    const candidates = gs1.isGs1
      ? Array.from(new Set([gs1.gtin, gs1.gtin13, gs1.normalizedRaw, code].filter((v): v is string => Boolean(v))))
      : [code];

    let medId: number | null = null;
    let matchedSaleUnit: string | undefined;
    let matchedBatchNumber: string | undefined = gs1.batchNumber;

    // 1. Lookup in product_barcodes (multi-unit / secondary / batch-specific barcodes)
    for (const candidate of candidates) {
      const pbRow = sqlite
        .prepare(
          `SELECT pb.medicine_id, pb.unit_name, pb.batch_id, mb.batch_number
           FROM product_barcodes pb
           LEFT JOIN medicine_batches mb ON mb.id = pb.batch_id
           WHERE pb.pharmacy_id = ? AND pb.is_active = 1 AND pb.barcode = ?
           LIMIT 1`,
        )
        .get(pharmId, candidate) as
        | { medicine_id: number; unit_name: string; batch_id: number | null; batch_number: string | null }
        | undefined;
      if (pbRow) {
        medId = Number(pbRow.medicine_id);
        matchedSaleUnit = pbRow.unit_name || undefined;
        if (pbRow.batch_number) matchedBatchNumber = pbRow.batch_number;
        break;
      }
    }

    // 2. Fallback to primary barcode / trade name / scientific name on inventeries
    if (!medId) {
      for (const candidate of candidates) {
        const medRow = sqlite
          .prepare(
            `SELECT id FROM inventeries
             WHERE pharmacy_id = ? AND (barcode = ? OR lower(name) = lower(?) OR lower(scientific_name) = lower(?))
             LIMIT 1`,
          )
          .get(pharmId, candidate, candidate, candidate) as { id: number } | undefined;
        if (medRow) {
          medId = Number(medRow.id);
          break;
        }
      }
    }

    if (!medId) {
      return res.status(404).json({
        error: gs1.isGs1
          ? `لم يتم العثور على دواء مطابق لرمز GTIN: ${gs1.gtin || code}`
          : `لم يتم العثور على دواء مطابق لـ: ${code}`,
      });
    }

    // Check scanned batch status / recalls if batch number was provided in GS1 or batch barcode
    if (matchedBatchNumber) {
      const batchRow = sqlite
        .prepare('SELECT id, status, expiry_date, qty_remaining FROM medicine_batches WHERE medicine_id = ? AND batch_number = ? LIMIT 1')
        .get(medId, matchedBatchNumber) as
        | { id: number; status: string; expiry_date: string; qty_remaining: number }
        | undefined;
      if (batchRow) {
        if (batchRow.status !== 'active') {
          return res.status(400).json({
            error: `التشغيلة الممسوحة (${matchedBatchNumber}) موقوفة حالياً بالحالة: ${batchRow.status}`,
          });
        }
        const today = new Date().toISOString().slice(0, 10);
        if (batchRow.expiry_date && batchRow.expiry_date < today) {
          return res.status(400).json({
            error: `التشغيلة الممسوحة (${matchedBatchNumber}) منتهية الصلاحية (${batchRow.expiry_date})`,
          });
        }
      }
    }

    const result = addMedicineToSessionBill(session, medId, pharmId, matchedSaleUnit);
    if (result.error) return res.status(result.status).json({ error: result.error });

    if (matchedBatchNumber && result.med) {
      const addedLine = session.bill.find((b) => b.id === medId && (!matchedSaleUnit || b.saleUnit === matchedSaleUnit));
      if (addedLine) addedLine.batchNumber = matchedBatchNumber;
    }

    return res.json({
      bill: session.bill,
      addedItem: result.med,
      matchedUnit: matchedSaleUnit || null,
      gs1: gs1.isGs1 ? gs1 : null,
    });
  });

  app.patch('/api/bill/item/:id', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const targetSaleUnit = req.body?.currentSaleUnit ? String(req.body.currentSaleUnit) : undefined;
    const item = session.bill.find((b) => b.id === id && (!targetSaleUnit || b.saleUnit === targetSaleUnit));
    if (!item) return res.status(404).json({ error: 'العنصر غير موجود في الفاتورة' });

    const medRow = sqlite.prepare('SELECT * FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | Record<string, unknown>
      | undefined;
    if (!medRow) return res.status(404).json({ error: 'الدواء غير موجود' });
    const med = rowToInventory(medRow);

    let nextSaleUnit = item.saleUnit;
    let nextUnitFactor = item.unitFactor;
    let nextPrice = item.price;
    if (req.body?.saleUnit !== undefined) {
      const conv = getOrConvertUnitDetails(med, String(req.body.saleUnit));
      nextSaleUnit = conv.saleUnit;
      nextUnitFactor = conv.unitFactor;
      nextPrice = conv.unitPrice;
    }

    const qty = req.body?.qty !== undefined ? Math.max(1, Math.floor(Number(req.body.qty) || 1)) : item.qty;
    const discountPct =
      req.body?.discountPct !== undefined
        ? Math.min(100, Math.max(0, Number(req.body.discountPct) || 0))
        : item.discountPct;

    const today = new Date().toISOString().slice(0, 10);
    const validAvail = (
      sqlite
        .prepare(
          "SELECT COALESCE(SUM(qty_remaining), 0) AS avail FROM medicine_batches WHERE medicine_id = ? AND status = 'active' AND qty_remaining > 0 AND (expiry_date = '' OR expiry_date >= ?)",
        )
        .get(id, today) as { avail: number }
    ).avail;

    const otherUsedPacks = session.bill
      .filter((b) => b !== item && b.id === id)
      .reduce((s, b) => s + b.qty * b.unitFactor, 0);

    if (otherUsedPacks + qty * nextUnitFactor > validAvail + 0.0001) {
      return res.status(400).json({
        error: `الكمية المتاحة الصالحة لـ "${med.name}" هي ${validAvail} ${med.packUnit} فقط`,
      });
    }

    item.saleUnit = nextSaleUnit;
    item.unitFactor = nextUnitFactor;
    item.price = nextPrice;
    item.qty = qty;
    item.discountPct = discountPct;
    return res.json({ bill: session.bill });
  });

  app.delete('/api/bill/item/:id', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const saleUnit = req.query.saleUnit ? String(req.query.saleUnit) : undefined;
    if (saleUnit) {
      session.bill = session.bill.filter((b) => !(b.id === id && b.saleUnit === saleUnit));
    } else {
      session.bill = session.bill.filter((b) => b.id !== id);
    }
    return res.json({ bill: session.bill });
  });

  app.post('/api/bill/clear', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session } = (req as AuthedRequest).auth;
    session.bill = [];
    return res.json({ bill: [] });
  });

  // --- Checkout (FEFO Multi-Batch + Payment Methods + Credit + Shift + Accounting) ---
  app.post('/api/bill/checkout', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { session, user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    if (session.bill.length === 0) {
      return res.status(400).json({ error: 'سلة الفاتورة فارغة' });
    }

    const buyerName = String(req.body?.name ?? '').trim() || 'عميل نقدي';
    const contact = String(req.body?.contact ?? '').trim();
    const discount = Math.min(100, Math.max(0, Number(req.body?.discount) || 0));
    const paymentMethod = String(req.body?.paymentMethod ?? 'cash');
    const customerId = req.body?.customerId ? Number(req.body.customerId) : null;
    const prescriptionId = req.body?.prescriptionId ? Number(req.body.prescriptionId) : null;
    const reqWh = req.body?.warehouseId ? Number(req.body.warehouseId) : 0;
    const defaultWhRow = (
      reqWh
        ? sqlite.prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?').get(reqWh, pharmId)
        : sqlite.prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId)
    ) as { id: number } | undefined;
    const warehouseId = defaultWhRow?.id || 1;
    const insuranceId = req.body?.insuranceId ? Number(req.body.insuranceId) : null;
    const policyNumber = String(req.body?.policyNumber ?? '').trim();
    const approvalCode = String(req.body?.approvalCode ?? '').trim();
    const redeemPoints = Math.max(0, Math.floor(Number(req.body?.redeemPoints) || 0));
    const applyPromotions = req.body?.applyPromotions !== false;
    const controlledMeta = (req.body?.controlledMeta ?? {}) as {
      patientNationalId?: string;
      doctorName?: string;
      doctorLicense?: string;
      prescriptionNumber?: string;
      notes?: string;
    };

    if ((paymentMethod === 'credit' || paymentMethod === 'partial') && !customerId) {
      return res.status(400).json({ error: 'يجب اختيار عميل مسجل عند البيع الآجل أو الدفع الجزئي' });
    }
    if (redeemPoints > 0 && !customerId) {
      return res.status(400).json({ error: 'يجب اختيار عميل مسجل لاستبدال نقاط الولاء' });
    }

    let custRecord:
      | { id: number; name: string; credit_limit: number; balance: number; loyalty_points: number }
      | undefined;
    if (customerId) {
      custRecord = sqlite
        .prepare('SELECT id, name, credit_limit, balance, loyalty_points FROM customers WHERE id = ? AND pharmacy_id = ?')
        .get(customerId, pharmId) as
        | { id: number; name: string; credit_limit: number; balance: number; loyalty_points: number }
        | undefined;
      if (!custRecord) {
        return res.status(404).json({ error: 'العميل المحدد غير موجود' });
      }
    }

    const site = getSiteSettings(pharmId);
    const requestedCurr = req.body?.invoiceCurrencyCode
      ? String(req.body.invoiceCurrencyCode)
      : site.autoConvertCurrencies
        ? site.defaultDisplayCurrency
        : site.currencyCode;
    const invCurr = resolveSiteCurrency(site, requestedCurr);
    const rate = invCurr.rateToBase;

    const itemsSnapshot: BillItem[] = session.bill.map((b) => ({ ...b }));
    const date = currentTimestamp();
    const today = date.slice(0, 10);

    // Check active promotions per line (in Base Currency)
    let promoDiscountBase = 0;
    if (applyPromotions) {
      const activePromos = sqlite
        .prepare(
          `SELECT * FROM promotions
           WHERE pharmacy_id = ? AND is_active = 1 AND (start_date = '' OR start_date <= ?) AND (end_date = '' OR end_date >= ?)`,
        )
        .all(pharmId, today, today) as Array<{
        scope: string;
        target_id: number | null;
        discount_pct: number;
        min_qty: number;
      }>;

      if (activePromos.length > 0) {
        for (const item of itemsSnapshot) {
          const medCatRow = sqlite.prepare('SELECT catId FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(item.id, pharmId) as
            | { catId: number }
            | undefined;
          let bestPct = 0;
          for (const p of activePromos) {
            if (item.qty < (p.min_qty || 1)) continue;
            if (
              p.scope === 'all' ||
              (p.scope === 'category' && medCatRow && p.target_id === medCatRow.catId) ||
              (p.scope === 'medicine' && p.target_id === item.id)
            ) {
              bestPct = Math.max(bestPct, Number(p.discount_pct) || 0);
            }
          }
          if (bestPct > 0) {
            const lineGross = item.price * item.qty;
            const lineAfterItemDisc = lineGross - (lineGross * (item.discountPct || 0)) / 100;
            promoDiscountBase += (lineAfterItemDisc * bestPct) / 100;
          }
        }
      }
    }
    promoDiscountBase = Number(promoDiscountBase.toFixed(2));

    // Item-level discounts -> promotion discount -> invoice-level discount in Base Currency
    const netLinesTotalBase = itemsSnapshot.reduce((sum, item) => {
      const lineGross = item.price * item.qty;
      const lineNet = lineGross - (lineGross * (item.discountPct || 0)) / 100;
      return sum + lineNet;
    }, 0);
    const afterPromoBase = Math.max(0, netLinesTotalBase - promoDiscountBase);
    let baseFinalAmount = Number((afterPromoBase - (afterPromoBase * discount) / 100).toFixed(2));

    // Loyalty redemption (each 100 points = 5 base currency units, i.e., 0.05 per point)
    let loyaltyDiscountBase = 0;
    if (redeemPoints > 0 && custRecord) {
      if ((custRecord.loyalty_points || 0) < redeemPoints) {
        return res.status(400).json({ error: `نقاط الولاء المتاحة للعميل (${custRecord.loyalty_points || 0}) لا تكفي` });
      }
      loyaltyDiscountBase = Math.min(baseFinalAmount, Number((redeemPoints * 0.05).toFixed(2)));
      baseFinalAmount = Number(Math.max(0, baseFinalAmount - loyaltyDiscountBase).toFixed(2));
    }

    // Insurance coverage split
    let insuranceComp:
      | { id: number; name: string; default_coverage_pct: number; max_claim_limit: number; is_active: number }
      | undefined;
    let baseInsuranceShare = 0;
    if (insuranceId) {
      insuranceComp = sqlite
        .prepare('SELECT id, name, default_coverage_pct, max_claim_limit, is_active FROM insurance_companies WHERE id = ? AND pharmacy_id = ?')
        .get(insuranceId, pharmId) as
        | { id: number; name: string; default_coverage_pct: number; max_claim_limit: number; is_active: number }
        | undefined;
      if (!insuranceComp || !insuranceComp.is_active) {
        return res.status(400).json({ error: 'شركة التأمين المختارة غير نشطة أو غير موجودة' });
      }
      const covPct = Math.min(100, Math.max(0, Number(req.body?.coveragePct ?? insuranceComp.default_coverage_pct)));
      baseInsuranceShare = Math.min(
        insuranceComp.max_claim_limit || baseFinalAmount,
        Number(((baseFinalAmount * covPct) / 100).toFixed(2)),
      );
    }
    const basePatientDue = Number(Math.max(0, baseFinalAmount - baseInsuranceShare).toFixed(2));

    const finalAmount = rate === 1 ? baseFinalAmount : Number((baseFinalAmount * rate).toFixed(2));
    const insuranceShare = rate === 1 ? baseInsuranceShare : Number((baseInsuranceShare * rate).toFixed(2));
    const patientCopay = Number(Math.max(0, finalAmount - insuranceShare).toFixed(2));
    const totalItems = itemsSnapshot.reduce((sum, item) => sum + item.qty, 0);

    let paidAmount = patientCopay;
    if (paymentMethod === 'credit') {
      paidAmount = 0;
    } else if (paymentMethod === 'partial') {
      paidAmount = Math.min(patientCopay, Math.max(0, Number(req.body?.paidAmount ?? 0)));
    }
    const remainingAmount = Number(Math.max(0, patientCopay - paidAmount).toFixed(2));

    const basePaidAmount = rate === 1 ? paidAmount : Number((paidAmount / rate).toFixed(2));
    const baseRemainingAmount = Number(Math.max(0, basePatientDue - basePaidAmount).toFixed(2));

    const openShift = getOpenShiftForUser(user.id, pharmId) as { id: number; warehouse_id: number } | undefined;
    const sellingWarehouse = openShift?.warehouse_id || warehouseId;

    sqlite.exec('BEGIN IMMEDIATE');
    let invoiceId = 0;
    let totalCostOfGoods = 0;
    const recordedItems: Array<BillItem & { batchId: number | null }> = [];
    let insuranceClaimId: number | null = null;
    const earnedPoints =
      custRecord && custRecord.name !== 'عميل نقدي عام' ? Math.floor(basePatientDue / 10) : 0;

    try {
      // Credit limit check if remaining debt > 0 (customer balances & limits are tracked in Base Currency)
      if (baseRemainingAmount > 0 && custRecord) {
        if (custRecord.credit_limit > 0 && custRecord.balance + baseRemainingAmount > custRecord.credit_limit) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({
            error: `الرصيد الآجل يتجاوز الحد الائتماني المسموح للعميل (${custRecord.credit_limit} ${site.currencySymbol})`,
          });
        }
      }

      const soldInfo = sqlite
        .prepare(
          `INSERT INTO sold
            (name, contact, discount, item, amount, currency_code, currency_symbol, exchange_rate, base_amount,
             payment_method, paid_amount, remaining_amount, customer_id, prescription_id, shift_id, warehouse_id,
             insurance_id, insurance_share, patient_copay, loyalty_points_earned, loyalty_points_redeemed, loyalty_discount, promo_discount,
             status, userId, pharmacy_id, date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
        )
        .run(
          buyerName,
          contact,
          String(discount),
          String(totalItems),
          String(finalAmount),
          invCurr.code,
          invCurr.symbol,
          rate,
          baseFinalAmount,
          paymentMethod,
          paidAmount,
          remainingAmount,
          customerId,
          prescriptionId,
          openShift?.id ?? null,
          sellingWarehouse,
          insuranceComp?.id ?? null,
          insuranceShare,
          patientCopay,
          earnedPoints,
          redeemPoints,
          loyaltyDiscountBase,
          promoDiscountBase,
          user.id,
          pharmId,
          date,
        );
      invoiceId = Number(soldInfo.lastInsertRowid);

      const insertSoldItem = sqlite.prepare(
        `INSERT INTO sold_items
          (soldId, medicineId, name, price, discount_pct, unit, sale_unit, unit_factor, company, barcode, batchNumber, batch_id, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const cartItem of itemsSnapshot) {
        const medRow = sqlite.prepare('SELECT * FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(cartItem.id, pharmId) as
          | Record<string, unknown>
          | undefined;
        if (!medRow) {
          sqlite.exec('ROLLBACK');
          return res.status(404).json({ error: `الدواء "${cartItem.name}" لم يعد موجوداً` });
        }
        const med = rowToInventory(medRow);
        if (med.status === 'suspended') {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: `الدواء "${med.name}" موقوف عن الصرف` });
        }
        if (med.isControlled) {
          const natId = String(controlledMeta.patientNationalId ?? '').trim();
          const rxNum = String(controlledMeta.prescriptionNumber ?? (prescriptionId ? `RX-${prescriptionId}` : '')).trim();
          if (!natId || !rxNum || buyerName === 'عميل نقدي') {
            sqlite.exec('ROLLBACK');
            return res.status(400).json({
              error: `الدواء "${med.name}" من الأدوية المقيدة/المراقبة: يلزم إدخال اسم المريض ورقم الهوية ورقم الوصفة الطبية لإتمام الصرف`,
            });
          }
          sqlite
            .prepare(
              `INSERT INTO controlled_dispense_logs
                (sold_id, medicine_id, medicine_name, schedule, patient_name, patient_national_id, doctor_name, doctor_license, prescription_number, qty, warehouse_id, pharmacist_id, pharmacist_name, notes, pharmacy_id, dispensed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              invoiceId,
              med.id,
              med.name,
              med.controlledSchedule || 'مراقب صرفاً',
              buyerName,
              natId,
              String(controlledMeta.doctorName ?? '').trim(),
              String(controlledMeta.doctorLicense ?? '').trim(),
              rxNum,
              cartItem.qty,
              sellingWarehouse,
              user.id,
              user.name,
              String(controlledMeta.notes ?? '').trim(),
              pharmId,
              date,
            );
          logAudit({
            userId: user.id,
            userName: user.name,
            action: 'controlled_dispense',
            entityType: 'controlled_drug',
            entityId: med.id,
            details: `صرف دواء مقيد "${med.name}" (كمية ${cartItem.qty}) للمريض ${buyerName} هوية ${natId} بوصفة ${rxNum}`,
            pharmacyId: pharmId,
          });
        }

        let neededPacks = Number((cartItem.qty * (cartItem.unitFactor || 1)).toFixed(4));
        // FEFO: Fetch active, non-expired batches ordered by earliest expiry first!
        // Prioritize selling warehouse first, then fallback to other active warehouses if needed.
        const batches = sqlite
          .prepare(
            `SELECT * FROM medicine_batches
             WHERE medicine_id = ? AND status = 'active' AND qty_remaining > 0 AND (expiry_date = '' OR expiry_date >= ?)
             ORDER BY CASE WHEN warehouse_id = ? THEN 0 ELSE 1 END ASC, expiry_date ASC, id ASC`,
          )
          .all(cartItem.id, today, sellingWarehouse) as Array<{
          id: number;
          warehouse_id: number;
          batch_number: string;
          qty_remaining: number;
          purchase_price: number;
        }>;

        const totalValid = batches.reduce((s, b) => s + b.qty_remaining, 0);
        if (neededPacks > totalValid + 0.0001) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({
            error: `الكمية الصالحة المتاحة من "${med.name}" (${totalValid}) لا تكفي للكمية المطلوبة (${neededPacks})`,
          });
        }

        let primaryBatchNo = cartItem.batchNumber;
        let primaryBatchId: number | null = null;
        for (const b of batches) {
          if (neededPacks <= 0.0001) break;
          const deduct = Number(Math.min(neededPacks, b.qty_remaining).toFixed(4));
          if (!primaryBatchId) {
            primaryBatchId = b.id;
            primaryBatchNo = b.batch_number;
          }
          sqlite
            .prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining - ?, 4) WHERE id = ?')
            .run(deduct, b.id);
          totalCostOfGoods += deduct * (b.purchase_price || med.purchasePrice || 0);
          const bal = syncMedicineFromBatches(med.id);
          recordStockMovement({
            medicineId: med.id,
            medicineName: med.name,
            warehouseId: b.warehouse_id,
            batchId: b.id,
            batchNumber: b.batch_number,
            movementType: 'sale',
            qtyChange: -deduct,
            balanceAfter: bal,
            referenceType: 'sold',
            referenceId: invoiceId,
            notes: `بيع فاتورة #${invoiceId} (${cartItem.qty} ${cartItem.saleUnit})`,
            userId: user.id,
            pharmacyId: pharmId,
          });
          neededPacks = Number((neededPacks - deduct).toFixed(4));
        }

        const itemInvPrice = rate === 1 ? cartItem.price : Number((cartItem.price * rate).toFixed(2));
        insertSoldItem.run(
          invoiceId,
          cartItem.id,
          cartItem.name,
          itemInvPrice,
          cartItem.discountPct || 0,
          cartItem.unit,
          cartItem.saleUnit || 'علبة',
          cartItem.unitFactor || 1,
          cartItem.company,
          cartItem.barcode,
          primaryBatchNo,
          primaryBatchId,
          cartItem.qty,
        );
        recordedItems.push({ ...cartItem, price: itemInvPrice, batchNumber: primaryBatchNo, batchId: primaryBatchId });
      }

      // Update Customer Balance if Credit / Partial (Base Currency)
      if (baseRemainingAmount > 0 && customerId) {
        sqlite
          .prepare('UPDATE customers SET balance = ROUND(balance + ?, 2) WHERE id = ? AND pharmacy_id = ?')
          .run(baseRemainingAmount, customerId, pharmId);
      }

      // Loyalty earn / redeem ledger updates
      if (customerId && (redeemPoints > 0 || earnedPoints > 0)) {
        const netDelta = earnedPoints - redeemPoints;
        sqlite
          .prepare('UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?) WHERE id = ? AND pharmacy_id = ?')
          .run(netDelta, customerId, pharmId);
        const updatedCust = sqlite.prepare('SELECT loyalty_points FROM customers WHERE id = ? AND pharmacy_id = ?').get(customerId, pharmId) as
          | { loyalty_points: number }
          | undefined;
        const pts = updatedCust?.loyalty_points || 0;
        const nextTier = pts >= 1000 ? 'بلاتيني' : pts >= 300 ? 'ذهبي' : pts >= 100 ? 'فضي' : 'عادي';
        sqlite.prepare('UPDATE customers SET loyalty_tier = ? WHERE id = ? AND pharmacy_id = ?').run(nextTier, customerId, pharmId);

        if (redeemPoints > 0) {
          sqlite
            .prepare(
              'INSERT INTO loyalty_transactions (customer_id, points_delta, tx_type, reference_sold_id, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(customerId, -redeemPoints, 'redeem', invoiceId, `استبدال نقاط في الفاتورة #${invoiceId}`, user.id, date);
        }
        if (earnedPoints > 0) {
          sqlite
            .prepare(
              'INSERT INTO loyalty_transactions (customer_id, points_delta, tx_type, reference_sold_id, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(customerId, earnedPoints, 'earn', invoiceId, `نقاط مكتسبة من الفاتورة #${invoiceId}`, user.id, date);
        }
      }

      // Insurance Claim record & receivable balance
      if (insuranceComp && baseInsuranceShare > 0) {
        const claimNum = `CLM-${invoiceId}-${Date.now().toString().slice(-4)}`;
        const claimInfo = sqlite
          .prepare(
            `INSERT INTO insurance_claims
              (claim_number, insurance_id, insurance_name, customer_id, customer_name, sold_id, policy_number, approval_code, total_amount, insurance_share, patient_copay, status, notes, created_by, pharmacy_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?)`,
          )
          .run(
            claimNum,
            insuranceComp.id,
            insuranceComp.name,
            customerId,
            buyerName,
            invoiceId,
            policyNumber,
            approvalCode,
            baseFinalAmount,
            baseInsuranceShare,
            basePatientDue,
            `مطالبة آلية من فاتورة #${invoiceId}`,
            user.id,
            pharmId,
            date,
          );
        insuranceClaimId = Number(claimInfo.lastInsertRowid);
        sqlite.prepare('UPDATE sold SET insurance_claim_id = ? WHERE id = ?').run(insuranceClaimId, invoiceId);
        sqlite
          .prepare('UPDATE insurance_companies SET balance = ROUND(balance + ?, 2) WHERE id = ? AND pharmacy_id = ?')
          .run(baseInsuranceShare, insuranceComp.id, pharmId);
      }

      // Mark prescription as dispensed if linked
      if (prescriptionId) {
        sqlite
          .prepare(
            "UPDATE prescriptions SET status = 'dispensed', dispensed_sold_id = ?, refills_used = refills_used + 1 WHERE id = ? AND pharmacy_id = ?",
          )
          .run(invoiceId, prescriptionId, pharmId);
      }

      // Update active Shift counters (Base Currency)
      if (openShift) {
        if (paymentMethod === 'card') {
          sqlite.prepare('UPDATE pos_shifts SET card_sales = ROUND(card_sales + ?, 2) WHERE id = ?').run(basePaidAmount, openShift.id);
        } else {
          sqlite
            .prepare(
              'UPDATE pos_shifts SET cash_sales = ROUND(cash_sales + ?, 2), credit_sales = ROUND(credit_sales + ?, 2), expected_cash = ROUND(expected_cash + ?, 2) WHERE id = ?',
            )
            .run(basePaidAmount, baseRemainingAmount, basePaidAmount, openShift.id);
        }
      }

      // Double-entry Accounting Posting (Base Currency)
      const accCash = resolvePharmacyAccountId(pharmId, '1010');
      const accBank = resolvePharmacyAccountId(pharmId, '1020');
      const accInv = resolvePharmacyAccountId(pharmId, '1030');
      const accArCust = resolvePharmacyAccountId(pharmId, '1040');
      const accArIns = resolvePharmacyAccountId(pharmId, '1050');
      const accSales = resolvePharmacyAccountId(pharmId, '4010');
      const accCogs = resolvePharmacyAccountId(pharmId, '5010');

      const journalLines: Array<{ accountId: number; debit: number; credit: number }> = [];
      if (basePaidAmount > 0) {
        journalLines.push({
          accountId: paymentMethod === 'card' ? accBank : accCash,
          debit: basePaidAmount,
          credit: 0,
        });
      }
      if (baseRemainingAmount > 0) {
        journalLines.push({ accountId: accArCust, debit: baseRemainingAmount, credit: 0 });
      }
      if (baseInsuranceShare > 0) {
        journalLines.push({ accountId: accArIns, debit: baseInsuranceShare, credit: 0 });
      }
      journalLines.push({ accountId: accSales, debit: 0, credit: baseFinalAmount });

      const cogs = Number(totalCostOfGoods.toFixed(2));
      if (cogs > 0) {
        journalLines.push({ accountId: accCogs, debit: cogs, credit: 0 });
        journalLines.push({ accountId: accInv, debit: 0, credit: cogs });
      }

      postJournalEntry({
        description: `قيد مبيعات فاتورة #${invoiceId} - ${buyerName}${insuranceComp ? ` (تأمين: ${insuranceComp.name})` : ''}${invCurr.code !== site.currencyCode ? ` (${finalAmount} ${invCurr.symbol})` : ''}`,
        referenceType: 'sold',
        referenceId: invoiceId,
        userId: user.id,
        pharmacyId: pharmId,
        lines: journalLines,
      });

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'checkout',
        entityType: 'sold',
        entityId: invoiceId,
        details: `إصدار فاتورة #${invoiceId} بمبلغ ${finalAmount} ${invCurr.symbol} (${paymentMethod})`,
        pharmacyId: pharmId,
      });

      sqlite.exec('COMMIT');
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore rollback error
      }
      throw err;
    }

    session.bill = [];
    return res.status(201).json({
      invoice: {
        id: invoiceId,
        name: buyerName,
        contact,
        discount: String(discount),
        item: String(totalItems),
        amount: String(finalAmount),
        currencyCode: invCurr.code,
        currencySymbol: invCurr.symbol,
        exchangeRate: rate,
        baseAmount: baseFinalAmount,
        paymentMethod,
        paidAmount,
        remainingAmount,
        customerId,
        prescriptionId,
        shiftId: openShift?.id ?? null,
        insuranceId: insuranceComp?.id ?? null,
        insuranceClaimId,
        insuranceShare,
        patientCopay,
        loyaltyPointsEarned: earnedPoints,
        loyaltyPointsRedeemed: redeemPoints,
        promoDiscount: promoDiscountBase,
        status: 'completed',
        userId: user.id,
        adminName: getAdminName(user.id),
        date,
        itemsDetail: recordedItems,
      },
      bill: [],
    });
  });

  // --- Cancel / Void Invoice ---
  app.post('/api/sold/:id/cancel', requireAuth, requirePermission('cancelInvoices'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const inv = sqlite.prepare('SELECT * FROM sold WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | {
          id: number;
          name: string;
          amount: string;
          exchange_rate?: number;
          base_amount?: number | null;
          payment_method: string;
          paid_amount: number;
          remaining_amount: number;
          customer_id: number | null;
          shift_id: number | null;
          warehouse_id: number;
          insurance_id?: number | null;
          insurance_claim_id?: number | null;
          insurance_share?: number;
          loyalty_points_earned?: number;
          loyalty_points_redeemed?: number;
          status: string;
        }
      | undefined;
    if (!inv) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    if (inv.status === 'cancelled') return res.status(400).json({ error: 'الفاتورة ملغاة مسبقاً' });

    const exRate = Number(inv.exchange_rate) || 1;
    const baseRev =
      inv.base_amount !== null && inv.base_amount !== undefined
        ? Number(inv.base_amount)
        : Number(((Number(inv.amount) || 0) / exRate).toFixed(2));
    const basePaid = exRate === 1 ? Number(inv.paid_amount || 0) : Number(((inv.paid_amount || 0) / exRate).toFixed(2));
    const baseInsShare = exRate === 1 ? Number(inv.insurance_share || 0) : Number(((inv.insurance_share || 0) / exRate).toFixed(2));
    const baseRem = Number(Math.max(0, baseRev - basePaid - baseInsShare).toFixed(2));

    const items = sqlite.prepare('SELECT * FROM sold_items WHERE soldId = ?').all(id) as Array<{
      medicineId: number;
      name: string;
      qty: number;
      unit_factor: number;
      batch_id: number | null;
      batchNumber: string;
    }>;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      let totalRestoredCogs = 0;
      for (const it of items) {
        const restorePacks = Number((it.qty * (it.unit_factor || 1)).toFixed(4));
        let unitCost = 0;
        if (it.batch_id) {
          const b = sqlite
            .prepare('SELECT id, purchase_price FROM medicine_batches WHERE id = ?')
            .get(it.batch_id) as { id: number; purchase_price: number } | undefined;
          if (b) {
            unitCost = Number(b.purchase_price || 0);
            sqlite
              .prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining + ?, 4) WHERE id = ?')
              .run(restorePacks, b.id);
          }
        } else {
          const fallbackBatch = sqlite
            .prepare('SELECT id, purchase_price FROM medicine_batches WHERE medicine_id = ? ORDER BY id DESC LIMIT 1')
            .get(it.medicineId) as { id: number; purchase_price: number } | undefined;
          if (fallbackBatch) {
            unitCost = Number(fallbackBatch.purchase_price || 0);
            sqlite
              .prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining + ?, 4) WHERE id = ?')
              .run(restorePacks, fallbackBatch.id);
          }
        }
        if (unitCost === 0) {
          const medCostRow = sqlite
            .prepare('SELECT purchase_price FROM inventeries WHERE id = ? AND pharmacy_id = ?')
            .get(it.medicineId, pharmId) as { purchase_price: number } | undefined;
          unitCost = Number(medCostRow?.purchase_price || 0);
        }
        totalRestoredCogs += restorePacks * unitCost;
        const bal = syncMedicineFromBatches(it.medicineId);
        recordStockMovement({
          medicineId: it.medicineId,
          medicineName: it.name,
          warehouseId: inv.warehouse_id || 1,
          batchId: it.batch_id,
          batchNumber: it.batchNumber,
          movementType: 'invoice_cancel',
          qtyChange: restorePacks,
          balanceAfter: bal,
          referenceType: 'sold',
          referenceId: id,
          notes: `إلغاء فاتورة #${id}`,
          userId: user.id,
          pharmacyId: pharmId,
        });
      }

      if (baseRem > 0 && inv.customer_id) {
        sqlite
          .prepare('UPDATE customers SET balance = ROUND(MAX(0, balance - ?), 2) WHERE id = ? AND pharmacy_id = ?')
          .run(baseRem, inv.customer_id, pharmId);
      }

      // Reverse insurance claim & receivable balance
      if (inv.insurance_claim_id) {
        sqlite
          .prepare("UPDATE insurance_claims SET status = 'cancelled' WHERE id = ? AND pharmacy_id = ?")
          .run(inv.insurance_claim_id, pharmId);
      } else if (inv.insurance_id) {
        sqlite
          .prepare("UPDATE insurance_claims SET status = 'cancelled' WHERE sold_id = ? AND pharmacy_id = ?")
          .run(id, pharmId);
      }
      if (inv.insurance_id && baseInsShare > 0) {
        sqlite
          .prepare('UPDATE insurance_companies SET balance = ROUND(MAX(0, balance - ?), 2) WHERE id = ? AND pharmacy_id = ?')
          .run(baseInsShare, inv.insurance_id, pharmId);
      }

      // Reverse loyalty points earned / redeemed
      const earnedPts = Number(inv.loyalty_points_earned || 0);
      const redeemedPts = Number(inv.loyalty_points_redeemed || 0);
      if (inv.customer_id && (earnedPts > 0 || redeemedPts > 0)) {
        const netReversal = redeemedPts - earnedPts;
        sqlite
          .prepare('UPDATE customers SET loyalty_points = MAX(0, COALESCE(loyalty_points, 0) + ?) WHERE id = ? AND pharmacy_id = ?')
          .run(netReversal, inv.customer_id, pharmId);
        const updatedCust = sqlite
          .prepare('SELECT loyalty_points FROM customers WHERE id = ? AND pharmacy_id = ?')
          .get(inv.customer_id, pharmId) as { loyalty_points: number } | undefined;
        const pts = updatedCust?.loyalty_points || 0;
        const nextTier = pts >= 1000 ? 'بلاتيني' : pts >= 300 ? 'ذهبي' : pts >= 100 ? 'فضي' : 'عادي';
        sqlite.prepare('UPDATE customers SET loyalty_tier = ? WHERE id = ? AND pharmacy_id = ?').run(nextTier, inv.customer_id, pharmId);
        if (netReversal !== 0) {
          sqlite
            .prepare(
              'INSERT INTO loyalty_transactions (customer_id, points_delta, tx_type, reference_sold_id, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            )
            .run(inv.customer_id, netReversal, 'cancel_reversal', id, `عكس نقاط عند إلغاء الفاتورة #${id}`, user.id, currentTimestamp());
        }
      }

      if (inv.shift_id && basePaid > 0 && inv.payment_method !== 'card') {
        sqlite
          .prepare(
            'UPDATE pos_shifts SET cash_returns = ROUND(cash_returns + ?, 2), expected_cash = ROUND(expected_cash - ?, 2) WHERE id = ? AND pharmacy_id = ?',
          )
          .run(basePaid, basePaid, inv.shift_id, pharmId);
      }

      const accCash = resolvePharmacyAccountId(pharmId, '1010');
      const accBank = resolvePharmacyAccountId(pharmId, '1020');
      const accInv = resolvePharmacyAccountId(pharmId, '1030');
      const accArCust = resolvePharmacyAccountId(pharmId, '1040');
      const accArIns = resolvePharmacyAccountId(pharmId, '1050');
      const accSales = resolvePharmacyAccountId(pharmId, '4010');
      const accCogs = resolvePharmacyAccountId(pharmId, '5010');

      const journalLines: Array<{ accountId: number; debit: number; credit: number }> = [
        { accountId: accSales, debit: baseRev, credit: 0 },
      ];
      if (basePaid > 0) {
        journalLines.push({
          accountId: inv.payment_method === 'card' ? accBank : accCash,
          debit: 0,
          credit: basePaid,
        });
      }
      if (baseRem > 0) {
        journalLines.push({ accountId: accArCust, debit: 0, credit: baseRem });
      }
      if (baseInsShare > 0) {
        journalLines.push({ accountId: accArIns, debit: 0, credit: baseInsShare });
      }
      const cogsReversal = Number(totalRestoredCogs.toFixed(2));
      if (cogsReversal > 0) {
        journalLines.push({ accountId: accInv, debit: cogsReversal, credit: 0 });
        journalLines.push({ accountId: accCogs, debit: 0, credit: cogsReversal });
      }
      postJournalEntry({
        description: `عكس قيد إلغاء فاتورة #${id} (${inv.name})`,
        referenceType: 'sold_cancel',
        referenceId: id,
        userId: user.id,
        pharmacyId: pharmId,
        lines: journalLines,
      });

      sqlite.prepare("UPDATE sold SET status = 'cancelled' WHERE id = ? AND pharmacy_id = ?").run(id, pharmId);
      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'cancel',
        entityType: 'sold',
        entityId: id,
        details: `إلغاء الفاتورة #${id} بقيمة ${inv.amount}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.json({ ok: true });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  // --- Sales Returns (مرتجعات المبيعات) ---
  app.get('/api/sales-returns', requireAuth, requirePermission('viewReports'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const returns = sqlite
      .prepare(
        `SELECT r.*, s.name AS customer_name, u.name AS user_name
         FROM sales_returns r
         JOIN sold s ON s.id = r.sold_id
         LEFT JOIN users u ON u.id = r.user_id
         WHERE r.pharmacy_id = ?
         ORDER BY r.id DESC`,
      )
      .all(pharmId) as Array<Record<string, unknown>>;
    const getItems = sqlite.prepare('SELECT * FROM sales_return_items WHERE return_id = ?');
    return res.json({
      returns: returns.map((r) => ({ ...r, items: getItems.all(Number(r.id)) })),
    });
  });

  app.post('/api/sales-returns', requireAuth, requirePermission('processReturns'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const soldId = Number(req.body?.soldId);
    const reason = String(req.body?.reason ?? '').trim() || 'مرتجع عميل';
    const refundMethod = String(req.body?.refundMethod ?? 'cash');
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const inv = sqlite.prepare('SELECT * FROM sold WHERE id = ? AND pharmacy_id = ?').get(soldId, pharmId) as
      | { id: number; name: string; customer_id: number | null; remaining_amount: number; warehouse_id: number; status: string; exchange_rate?: number }
      | undefined;
    if (!inv) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    if (inv.status === 'cancelled') return res.status(400).json({ error: 'لا يمكن عمل مرتجع لفاتورة ملغاة' });
    if (items.length === 0) return res.status(400).json({ error: 'يرجى تحديد صنف واحد على الأقل للإرجاع' });

    const invRate = Number(inv.exchange_rate) || 1;
    const openShift = getOpenShiftForUser(user.id, pharmId) as { id: number } | undefined;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const soldQtyRows = sqlite
        .prepare('SELECT medicineId, COALESCE(SUM(qty), 0) AS sold_qty FROM sold_items WHERE soldId = ? GROUP BY medicineId')
        .all(soldId) as Array<{ medicineId: number; sold_qty: number }>;
      const soldQtyMap = new Map<number, number>(soldQtyRows.map((r) => [Number(r.medicineId), Number(r.sold_qty)]));

      const priorRetRows = sqlite
        .prepare(
          `SELECT sri.medicine_id, COALESCE(SUM(sri.qty), 0) AS ret_qty
           FROM sales_return_items sri
           JOIN sales_returns sr ON sr.id = sri.return_id
           WHERE sr.sold_id = ? AND sr.pharmacy_id = ?
           GROUP BY sri.medicine_id`,
        )
        .all(soldId, pharmId) as Array<{ medicine_id: number; ret_qty: number }>;
      const priorRetMap = new Map<number, number>(priorRetRows.map((r) => [Number(r.medicine_id), Number(r.ret_qty)]));

      const requestedByMed = new Map<number, number>();
      let totalRefund = 0;
      for (const it of items) {
        const medId = Number(it.medicineId);
        const qty = Number(it.qty) || 0;
        const refundPrice = Number(it.refundPrice) || 0;
        if (!Number.isFinite(medId) || qty <= 0) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: 'بيانات أصناف المرتجع غير صالحة' });
        }
        const soldQty = soldQtyMap.get(medId) ?? 0;
        if (soldQty <= 0) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: 'الصنف المحدد للإرجاع غير موجود في الفاتورة الأصلية' });
        }
        const alreadyReturned = priorRetMap.get(medId) ?? 0;
        const nextReqTotal = (requestedByMed.get(medId) ?? 0) + qty;
        if (alreadyReturned + nextReqTotal > soldQty + 0.0001) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({
            error: `الكمية المطلوب إرجاعها تتجاوز الكمية القابلة للإرجاع في الفاتورة (المباع: ${soldQty}، المرتجع سابقاً: ${alreadyReturned})`,
          });
        }
        requestedByMed.set(medId, nextReqTotal);
        totalRefund += qty * refundPrice;
      }
      totalRefund = Number(totalRefund.toFixed(2));
      const baseRefund = invRate === 1 ? totalRefund : Number((totalRefund / invRate).toFixed(2));
      if (totalRefund <= 0) {
        sqlite.exec('ROLLBACK');
        return res.status(400).json({ error: 'قيمة المرتجع يجب أن تكون أكبر من الصفر' });
      }

      const retInfo = sqlite
        .prepare(
          'INSERT INTO sales_returns (sold_id, reason, refund_amount, refund_method, shift_id, user_id, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(soldId, reason, baseRefund, refundMethod, openShift?.id ?? null, user.id, pharmId, currentTimestamp());
      const returnId = Number(retInfo.lastInsertRowid);

      const insRetItem = sqlite.prepare(
        'INSERT INTO sales_return_items (return_id, medicine_id, medicine_name, batch_id, qty, unit_factor, refund_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );

      for (const it of items) {
        const medId = Number(it.medicineId);
        const qty = Number(it.qty);
        const unitFactor = Number(it.unitFactor) || 1;
        const refundPrice = Number(it.refundPrice) || 0;
        const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(medId, pharmId) as
          | { id: number; name: string }
          | undefined;
        if (!med || qty <= 0) continue;

        const restorePacks = Number((qty * unitFactor).toFixed(4));
        let targetBatchId: number | null = it.batchId ? Number(it.batchId) : null;
        if (targetBatchId) {
          const validBatch = sqlite
            .prepare(
              `SELECT mb.id FROM medicine_batches mb
               JOIN inventeries i ON i.id = mb.medicine_id
               WHERE mb.id = ? AND mb.medicine_id = ? AND i.pharmacy_id = ?`,
            )
            .get(targetBatchId, medId, pharmId) as { id: number } | undefined;
          if (!validBatch) targetBatchId = null;
        }
        if (!targetBatchId) {
          const b = sqlite
            .prepare(
              `SELECT mb.id FROM medicine_batches mb
               JOIN inventeries i ON i.id = mb.medicine_id
               WHERE mb.medicine_id = ? AND i.pharmacy_id = ? AND mb.status = 'active'
               ORDER BY mb.expiry_date DESC LIMIT 1`,
            )
            .get(medId, pharmId) as { id: number } | undefined;
          targetBatchId = b?.id ?? null;
        }
        if (targetBatchId) {
          sqlite
            .prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining + ?, 4) WHERE id = ?')
            .run(restorePacks, targetBatchId);
        }
        const bal = syncMedicineFromBatches(medId);
        insRetItem.run(returnId, medId, med.name, targetBatchId, qty, unitFactor, refundPrice);
        recordStockMovement({
          medicineId: medId,
          medicineName: med.name,
          warehouseId: inv.warehouse_id || 1,
          batchId: targetBatchId,
          movementType: 'sales_return',
          qtyChange: restorePacks,
          balanceAfter: bal,
          referenceType: 'sales_return',
          referenceId: returnId,
          notes: `مرتجع من فاتورة #${soldId}`,
          userId: user.id,
          pharmacyId: pharmId,
        });
      }

      const accCash = resolvePharmacyAccountId(pharmId, '1010');
      const accArCust = resolvePharmacyAccountId(pharmId, '1040');
      const accSales = resolvePharmacyAccountId(pharmId, '4010');

      if (refundMethod === 'credit_note' && inv.customer_id) {
        sqlite
          .prepare('UPDATE customers SET balance = ROUND(MAX(0, balance - ?), 2) WHERE id = ? AND pharmacy_id = ?')
          .run(baseRefund, inv.customer_id, pharmId);
        postJournalEntry({
          description: `مرتجع مبيعات خصماً من ذمة العميل - فاتورة #${soldId}`,
          referenceType: 'sales_return',
          referenceId: returnId,
          userId: user.id,
          pharmacyId: pharmId,
          lines: [
            { accountId: accSales, debit: baseRefund, credit: 0 },
            { accountId: accArCust, debit: 0, credit: baseRefund },
          ],
        });
      } else {
        if (openShift) {
          sqlite
            .prepare(
              'UPDATE pos_shifts SET cash_returns = ROUND(cash_returns + ?, 2), expected_cash = ROUND(expected_cash - ?, 2) WHERE id = ? AND pharmacy_id = ?',
            )
            .run(baseRefund, baseRefund, openShift.id, pharmId);
        }
        postJournalEntry({
          description: `مرتجع مبيعات نقدي - فاتورة #${soldId}`,
          referenceType: 'sales_return',
          referenceId: returnId,
          userId: user.id,
          pharmacyId: pharmId,
          lines: [
            { accountId: accSales, debit: baseRefund, credit: 0 },
            { accountId: accCash, debit: 0, credit: baseRefund },
          ],
        });
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'sales_return',
        entityType: 'sales_return',
        entityId: returnId,
        details: `مرتجع مبيعات للفاتورة #${soldId} بمبلغ ${baseRefund}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ returnId, refundAmount: baseRefund });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });
}
