import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  sqlite,
  currentTimestamp,
  getAllCat,
  rowToInventory,
  syncMedicineFromBatches,
  recordStockMovement,
  postJournalEntry,
  resolvePharmacyAccountId,
  logAudit,
  detectBarcodeSymbology,
} from '../db.ts';
import type { CategoryRecord } from '../db.ts';
import {
  requireAuth,
  requirePermission,
  getPharmacyId,
  generateBarcode,
  type AuthedRequest,
} from '../middleware.ts';

export function registerPharmacyRoutes(app: Express): void {
  // --- Categories ---
  app.get('/api/categories', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const categories = sqlite
      .prepare(
        `SELECT c.id, c.name, c.pic, c.details, c.date, COUNT(i.id) AS medicineCount
         FROM categories c
         LEFT JOIN inventeries i ON i.catId = c.id AND i.pharmacy_id = c.pharmacy_id
         WHERE c.pharmacy_id = ?
         GROUP BY c.id
         ORDER BY c.id ASC`,
      )
      .all(pharmId) as unknown as Array<CategoryRecord & { medicineCount: number }>;
    return res.json({ categories, options: getAllCat() });
  });

  app.post('/api/categories', requireAuth, requirePermission('manageCategories'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const details = String(req.body?.details ?? '').trim();
    const pic = String(req.body?.pic ?? '').trim() || 'cap.png';
    if (!name) return res.status(400).json({ error: 'يرجى إدخال اسم التصنيف' });
    const date = currentTimestamp();
    const info = sqlite
      .prepare('INSERT INTO categories (name, pic, details, pharmacy_id, date) VALUES (?, ?, ?, ?, ?)')
      .run(name, pic, details, pharmId, date);
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'category',
      entityId: id,
      details: `إضافة تصنيف: ${name}`,
      pharmacyId: pharmId,
    });
    return res.status(201).json({
      category: { id, name, pic, details, date, medicineCount: 0 },
    });
  });

  app.put('/api/categories/:id', requireAuth, requirePermission('manageCategories'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite
      .prepare('SELECT * FROM categories WHERE id = ? AND pharmacy_id = ?')
      .get(id, pharmId) as CategoryRecord | undefined;
    if (!existing) return res.status(404).json({ error: 'التصنيف غير موجود' });

    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'اسم التصنيف مطلوب' });
    const details = req.body?.details !== undefined ? String(req.body.details) : existing.details;
    const pic =
      req.body?.pic !== undefined && String(req.body.pic).trim() !== ''
        ? String(req.body.pic).trim()
        : existing.pic;

    sqlite.prepare('UPDATE categories SET name = ?, details = ?, pic = ? WHERE id = ? AND pharmacy_id = ?').run(name, details, pic, id, pharmId);
    const cnt = sqlite.prepare('SELECT COUNT(*) AS cnt FROM inventeries WHERE catId = ? AND pharmacy_id = ?').get(id, pharmId) as { cnt: number };
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update',
      entityType: 'category',
      entityId: id,
      details: `تعديل تصنيف: ${name}`,
      pharmacyId: pharmId,
    });
    return res.json({
      category: { id, name, details, pic, date: existing.date, medicineCount: cnt.cnt },
    });
  });

  app.delete('/api/categories/:id', requireAuth, requirePermission('deleteCategories'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT name FROM categories WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as { name: string } | undefined;
    if (!existing) return res.status(404).json({ error: 'التصنيف غير موجود' });

    const linked = sqlite.prepare('SELECT COUNT(*) AS cnt FROM inventeries WHERE catId = ? AND pharmacy_id = ?').get(id, pharmId) as { cnt: number };
    if (linked.cnt > 0) {
      return res.status(409).json({
        error: `لا يمكن حذف هذا التصنيف لوجود (${linked.cnt}) دواء مرتبط به في المخزون`,
      });
    }
    sqlite.prepare('DELETE FROM categories WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'category',
      entityId: id,
      details: `حذف تصنيف: ${existing.name}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  // --- Inventories & Full Drug Master Data ---
  app.get('/api/inventories', requireAuth, requirePermission('viewInventories'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const catId = req.query.catId ? Number(req.query.catId) : null;
    const rows = (catId
      ? sqlite
          .prepare(
            `SELECT i.*, COALESCE(c.name, 'غير مصنف') AS categoryName
             FROM inventeries i
             LEFT JOIN categories c ON c.id = i.catId
             WHERE i.pharmacy_id = ? AND i.catId = ?
             ORDER BY i.id ASC`,
          )
          .all(pharmId, catId)
      : sqlite
          .prepare(
            `SELECT i.*, COALESCE(c.name, 'غير مصنف') AS categoryName
             FROM inventeries i
             LEFT JOIN categories c ON c.id = i.catId
             WHERE i.pharmacy_id = ?
             ORDER BY i.id ASC`,
          )
          .all(pharmId)) as Array<Record<string, unknown>>;

    return res.json({ inventories: rows.map(rowToInventory) });
  });

  app.post('/api/inventories', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const b = req.body ?? {};
    const name = String(b.name ?? '').trim();
    const catId = Number(b.catId);
    const price = String(b.price ?? '').trim();
    if (!name || !catId || !price) {
      return res.status(400).json({ error: 'يرجى إدخال اسم الدواء والتصنيف وسعر البيع' });
    }
    const cat = sqlite.prepare('SELECT id, name FROM categories WHERE id = ? AND pharmacy_id = ?').get(catId, pharmId) as
      | { id: number; name: string }
      | undefined;
    if (!cat) return res.status(400).json({ error: 'التصنيف المحدد غير موجود' });

    const requestedBarcode = b.barcode !== undefined ? String(b.barcode).trim() : '';
    if (requestedBarcode) {
      const clash = sqlite.prepare('SELECT id FROM inventeries WHERE barcode = ? AND pharmacy_id = ?').get(requestedBarcode, pharmId);
      if (clash) return res.status(409).json({ error: 'رقم الباركود مسجل مسبقاً لدواء آخر' });
    }

    const quantity = Math.max(0, Number(b.quantity ?? 0));
    const minStock = Math.max(0, Math.floor(Number(b.minStock ?? 10)));
    const maxStock = Math.max(minStock, Math.floor(Number(b.maxStock ?? 500)));
    const sellPriceNum = Number(price) || 0;
    const purchasePrice = Math.max(0, Number(b.purchasePrice ?? Number((sellPriceNum * 0.7).toFixed(2))));
    const stripsPerPack = Math.max(1, Math.floor(Number(b.stripsPerPack ?? 1)));
    const stripPrice = Number(b.stripPrice) > 0 ? Number(b.stripPrice) : Number((sellPriceNum / stripsPerPack).toFixed(2));
    const piecesPerPack = Math.max(1, Math.floor(Number(b.piecesPerPack ?? 1)));
    const piecePrice = Number(b.piecePrice) > 0 ? Number(b.piecePrice) : Number((sellPriceNum / piecesPerPack).toFixed(2));
    const batchNumber = String(b.batchNumber ?? '').trim() || `B-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const expiryDate = String(b.expiryDate ?? '').trim() || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const productionDate = String(b.productionDate ?? '').trim();
    const defaultWh = sqlite
      .prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1')
      .get(pharmId) as { id: number } | undefined;
    const requestedWhId = b.warehouseId ? Number(b.warehouseId) : null;
    if (requestedWhId) {
      const whExists = sqlite
        .prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?')
        .get(requestedWhId, pharmId);
      if (!whExists) return res.status(400).json({ error: 'المستودع المحدد غير موجود لهذه الصيدلية' });
    }
    const warehouseId = requestedWhId || defaultWh?.id || 1;
    const supplier = String(b.supplier ?? '').trim();
    const date = currentTimestamp();
    const tempBarcode = requestedBarcode || `TMP-${crypto.randomUUID()}`;

    sqlite.exec('BEGIN IMMEDIATE');
    let newId = 0;
    let finalBarcode = requestedBarcode;
    try {
      const info = sqlite
        .prepare(
          `INSERT INTO inventeries
            (catId, supplier, name, scientific_name, active_ingredient, dosage_form, country_of_origin, reg_number,
             unit, pack_unit, strip_unit, strips_per_pack, strip_price, piece_unit, pieces_per_pack, piece_price,
             purchase_price, price, quantity, minStock, max_stock, storage_location, requires_prescription,
             is_controlled, controlled_schedule, max_daily_dose, pregnancy_category, status,
             barcode, batchNumber, expiryDate, pic, description, company, pharmacy_id, date)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          catId,
          supplier,
          name,
          String(b.scientificName ?? '').trim(),
          String(b.activeIngredient ?? '').trim(),
          String(b.dosageForm ?? 'أقراص').trim(),
          String(b.countryOfOrigin ?? '').trim(),
          String(b.regNumber ?? '').trim(),
          String(b.unit ?? '').trim(),
          String(b.packUnit ?? 'علبة').trim(),
          String(b.stripUnit ?? 'شريط').trim(),
          stripsPerPack,
          stripPrice,
          String(b.pieceUnit ?? 'حبة').trim(),
          piecesPerPack,
          piecePrice,
          purchasePrice,
          price,
          quantity,
          minStock,
          maxStock,
          String(b.storageLocation ?? 'الرف A-1').trim(),
          b.requiresPrescription || b.isControlled ? 1 : 0,
          b.isControlled ? 1 : 0,
          String(b.controlledSchedule ?? '').trim(),
          String(b.maxDailyDose ?? '').trim(),
          String(b.pregnancyCategory ?? '').trim(),
          String(b.status ?? 'active').trim(),
          tempBarcode,
          batchNumber,
          expiryDate,
          String(b.pic ?? '').trim(),
          String(b.description ?? '').trim(),
          String(b.company ?? '').trim(),
          pharmId,
          date,
        );
      newId = Number(info.lastInsertRowid);
      if (!requestedBarcode) {
        finalBarcode = generateBarcode(newId);
        sqlite.prepare('UPDATE inventeries SET barcode = ? WHERE id = ?').run(finalBarcode, newId);
      }

      sqlite
        .prepare(
          `INSERT INTO product_barcodes
            (medicine_id, batch_id, barcode, symbology, unit_type, unit_name, unit_factor, is_primary, is_active, notes, pharmacy_id, created_at)
           VALUES (?, NULL, ?, ?, 'pack', ?, 1, 1, 1, 'الباركود الأساسي عند إضافة الدواء', ?, ?)`,
        )
        .run(
          newId,
          finalBarcode,
          detectBarcodeSymbology(finalBarcode),
          String(b.packUnit ?? 'علبة').trim() || 'علبة',
          pharmId,
          date,
        );
      sqlite
        .prepare(
          `INSERT INTO barcode_history
            (medicine_id, old_barcode, new_barcode, unit_type, action, changed_by, changed_by_name, notes, pharmacy_id, created_at)
           VALUES (?, '', ?, 'pack', ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          newId,
          finalBarcode,
          requestedBarcode ? 'assign' : 'generate',
          user.id,
          user.name,
          requestedBarcode ? 'تعيين باركود يدوي' : 'توليد باركود داخلي تلقائياً',
          pharmId,
          date,
        );

      if (quantity > 0) {
        const bInfo = sqlite
          .prepare(
            `INSERT INTO medicine_batches
              (medicine_id, warehouse_id, supplier_name, batch_number, production_date, expiry_date, qty_initial, qty_remaining, purchase_price, status, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'رصيد افتتاحي عند تعريف الصنف', ?)`,
          )
          .run(newId, warehouseId, supplier, batchNumber, productionDate, expiryDate, quantity, quantity, purchasePrice, date);

        recordStockMovement({
          medicineId: newId,
          medicineName: name,
          warehouseId,
          batchId: Number(bInfo.lastInsertRowid),
          batchNumber,
          movementType: 'opening',
          qtyChange: quantity,
          balanceAfter: quantity,
          referenceType: 'medicine',
          referenceId: newId,
          notes: 'إضافة صنف جديد برصيد افتتاحي',
          userId: user.id,
          pharmacyId: pharmId,
        });
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'medicine',
        entityId: newId,
        details: `إضافة الدواء "${name}" (كمية: ${quantity}, تشغيلة: ${batchNumber})`,
        pharmacyId: pharmId,
      });

      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }

    const row = sqlite
      .prepare(
        `SELECT i.*, COALESCE(c.name, 'غير مصنف') AS categoryName
         FROM inventeries i LEFT JOIN categories c ON c.id = i.catId WHERE i.id = ?`,
      )
      .get(newId) as Record<string, unknown>;
    return res.status(201).json({ item: rowToInventory(row) });
  });

  app.put('/api/inventories/:id', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existingRow = sqlite.prepare('SELECT * FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) return res.status(404).json({ error: 'الدواء غير موجود' });
    const existing = rowToInventory(existingRow);

    const b = req.body ?? {};
    const nextBarcode = b.barcode !== undefined ? String(b.barcode).trim() || existing.barcode : existing.barcode;
    if (nextBarcode !== existing.barcode) {
      const clash = sqlite.prepare('SELECT id FROM inventeries WHERE barcode = ? AND pharmacy_id = ? AND id != ?').get(nextBarcode, pharmId, id);
      if (clash) return res.status(409).json({ error: 'رقم الباركود مسجل مسبقاً لدواء آخر' });
    }

    const nextName = b.name !== undefined ? String(b.name).trim() : existing.name;
    const nextCatId = b.catId !== undefined ? Number(b.catId) : existing.catId;
    if (nextCatId !== existing.catId) {
      const catRow = sqlite.prepare('SELECT id FROM categories WHERE id = ? AND pharmacy_id = ?').get(nextCatId, pharmId);
      if (!catRow) return res.status(400).json({ error: 'التصنيف المحدد غير موجود لهذه الصيدلية' });
    }
    const nextQty = b.quantity !== undefined ? Math.max(0, Number(b.quantity)) : existing.quantity;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite
        .prepare(
          `UPDATE inventeries SET
            name = ?, scientific_name = ?, active_ingredient = ?, dosage_form = ?, country_of_origin = ?, reg_number = ?,
            catId = ?, supplier = ?, unit = ?, pack_unit = ?, strip_unit = ?, strips_per_pack = ?, strip_price = ?,
            piece_unit = ?, pieces_per_pack = ?, piece_price = ?, purchase_price = ?, price = ?,
            quantity = ?, minStock = ?, max_stock = ?, storage_location = ?, requires_prescription = ?,
            is_controlled = ?, controlled_schedule = ?, max_daily_dose = ?, pregnancy_category = ?, status = ?,
            barcode = ?, batchNumber = ?, expiryDate = ?, company = ?, description = ?, pic = ?
           WHERE id = ?`,
        )
        .run(
          nextName,
          b.scientificName !== undefined ? String(b.scientificName).trim() : existing.scientificName,
          b.activeIngredient !== undefined ? String(b.activeIngredient).trim() : existing.activeIngredient,
          b.dosageForm !== undefined ? String(b.dosageForm).trim() : existing.dosageForm,
          b.countryOfOrigin !== undefined ? String(b.countryOfOrigin).trim() : existing.countryOfOrigin,
          b.regNumber !== undefined ? String(b.regNumber).trim() : existing.regNumber,
          nextCatId,
          b.supplier !== undefined ? String(b.supplier).trim() : existing.supplier,
          b.unit !== undefined ? String(b.unit).trim() : existing.unit,
          b.packUnit !== undefined ? String(b.packUnit).trim() : existing.packUnit,
          b.stripUnit !== undefined ? String(b.stripUnit).trim() : existing.stripUnit,
          b.stripsPerPack !== undefined ? Math.max(1, Number(b.stripsPerPack)) : existing.stripsPerPack,
          b.stripPrice !== undefined ? Number(b.stripPrice) : existing.stripPrice,
          b.pieceUnit !== undefined ? String(b.pieceUnit).trim() : existing.pieceUnit,
          b.piecesPerPack !== undefined ? Math.max(1, Number(b.piecesPerPack)) : existing.piecesPerPack,
          b.piecePrice !== undefined ? Number(b.piecePrice) : existing.piecePrice,
          b.purchasePrice !== undefined ? Number(b.purchasePrice) : existing.purchasePrice,
          b.price !== undefined ? String(b.price).trim() : existing.price,
          nextQty,
          b.minStock !== undefined ? Math.max(0, Math.floor(Number(b.minStock))) : existing.minStock,
          b.maxStock !== undefined ? Math.max(0, Math.floor(Number(b.maxStock))) : existing.maxStock,
          b.storageLocation !== undefined ? String(b.storageLocation).trim() : existing.storageLocation,
          b.requiresPrescription !== undefined
            ? b.requiresPrescription || b.isControlled
              ? 1
              : 0
            : existing.requiresPrescription
              ? 1
              : 0,
          b.isControlled !== undefined ? (b.isControlled ? 1 : 0) : existing.isControlled ? 1 : 0,
          b.controlledSchedule !== undefined ? String(b.controlledSchedule).trim() : existing.controlledSchedule,
          b.maxDailyDose !== undefined ? String(b.maxDailyDose).trim() : existing.maxDailyDose,
          b.pregnancyCategory !== undefined ? String(b.pregnancyCategory).trim() : existing.pregnancyCategory,
          b.status !== undefined ? String(b.status).trim() : existing.status,
          nextBarcode,
          b.batchNumber !== undefined ? String(b.batchNumber).trim() : existing.batchNumber,
          b.expiryDate !== undefined ? String(b.expiryDate).trim() : existing.expiryDate,
          b.company !== undefined ? String(b.company).trim() : existing.company,
          b.description !== undefined ? String(b.description).trim() : existing.description,
          b.pic !== undefined ? String(b.pic).trim() : existing.pic,
          id,
        );

      if (nextBarcode && nextBarcode !== existing.barcode) {
        const updateNow = currentTimestamp();
        sqlite.prepare('UPDATE product_barcodes SET is_primary = 0 WHERE pharmacy_id = ? AND medicine_id = ?').run(pharmId, id);
        const existingPb = sqlite
          .prepare('SELECT id FROM product_barcodes WHERE pharmacy_id = ? AND medicine_id = ? AND barcode = ? LIMIT 1')
          .get(pharmId, id, nextBarcode) as { id: number } | undefined;
        if (existingPb) {
          sqlite.prepare('UPDATE product_barcodes SET is_primary = 1, is_active = 1 WHERE id = ?').run(existingPb.id);
        } else {
          sqlite
            .prepare(
              `INSERT INTO product_barcodes
                (medicine_id, batch_id, barcode, symbology, unit_type, unit_name, unit_factor, is_primary, is_active, notes, pharmacy_id, created_at)
               VALUES (?, NULL, ?, ?, 'pack', ?, 1, 1, 1, 'تحديث الباركود الأساسي للدواء', ?, ?)`,
            )
            .run(id, nextBarcode, detectBarcodeSymbology(nextBarcode), existing.packUnit || 'علبة', pharmId, updateNow);
        }
        sqlite
          .prepare(
            `INSERT INTO barcode_history
              (medicine_id, old_barcode, new_barcode, unit_type, action, changed_by, changed_by_name, notes, pharmacy_id, created_at)
             VALUES (?, ?, ?, 'pack', 'replace_primary', ?, ?, 'تعديل الباركود الأساسي للدواء', ?, ?)`,
          )
          .run(id, existing.barcode, nextBarcode, user.id, user.name, pharmId, updateNow);
      }

      // Keep batch total aligned if quantity was directly edited from Edit Medicine modal
      if (b.quantity !== undefined && Math.abs(nextQty - existing.quantity) > 0.0001) {
        const diff = Number((nextQty - existing.quantity).toFixed(4));
        const firstBatch = sqlite
          .prepare(
            "SELECT id, batch_number, warehouse_id, qty_remaining FROM medicine_batches WHERE medicine_id = ? AND status = 'active' ORDER BY expiry_date ASC, id ASC LIMIT 1",
          )
          .get(id) as
          | { id: number; batch_number: string; warehouse_id: number; qty_remaining: number }
          | undefined;
        if (firstBatch) {
          const nextBatchQty = Math.max(0, Number((firstBatch.qty_remaining + diff).toFixed(4)));
          sqlite.prepare('UPDATE medicine_batches SET qty_remaining = ? WHERE id = ?').run(nextBatchQty, firstBatch.id);
          recordStockMovement({
            medicineId: id,
            medicineName: nextName,
            warehouseId: firstBatch.warehouse_id,
            batchId: firstBatch.id,
            batchNumber: firstBatch.batch_number,
            movementType: 'manual_edit',
            qtyChange: diff,
            balanceAfter: nextQty,
            referenceType: 'medicine',
            referenceId: id,
            notes: 'تعديل مباشر للكمية من بطاقة الدواء',
            userId: user.id,
          });
        } else if (nextQty > 0) {
          const defaultWh = sqlite
            .prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1')
            .get(pharmId) as { id: number } | undefined;
          const fallbackWhId = defaultWh?.id || 1;
          const bInfo = sqlite
            .prepare(
              `INSERT INTO medicine_batches
                (medicine_id, warehouse_id, supplier_name, batch_number, production_date, expiry_date, qty_initial, qty_remaining, purchase_price, status, notes, created_at)
               VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 'active', 'تعديل رصيد الدواء', ?)`,
            )
            .run(
              id,
              fallbackWhId,
              existing.supplier,
              b.batchNumber || existing.batchNumber || `B-${id}`,
              b.expiryDate || existing.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
              nextQty,
              nextQty,
              existing.purchasePrice,
              currentTimestamp(),
            );
          recordStockMovement({
            medicineId: id,
            medicineName: nextName,
            warehouseId: fallbackWhId,
            batchId: Number(bInfo.lastInsertRowid),
            batchNumber: b.batchNumber || existing.batchNumber || `B-${id}`,
            movementType: 'manual_edit',
            qtyChange: diff,
            balanceAfter: nextQty,
            referenceType: 'medicine',
            referenceId: id,
            notes: 'إنشاء تشغيلة عند تعديل الدواء',
            userId: user.id,
          });
        }
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'update',
        entityType: 'medicine',
        entityId: id,
        details: `تعديل بيانات الدواء "${nextName}"`,
        pharmacyId: pharmId,
      });

      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }

    const updatedRow = sqlite
      .prepare(
        `SELECT i.*, COALESCE(c.name, 'غير مصنف') AS categoryName
         FROM inventeries i LEFT JOIN categories c ON c.id = i.catId WHERE i.id = ?`,
      )
      .get(id) as Record<string, unknown>;
    return res.json({ item: rowToInventory(updatedRow) });
  });

  app.delete('/api/inventories/:id', requireAuth, requirePermission('deleteMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as { name: string } | undefined;
    if (!existing) return res.status(404).json({ error: 'الدواء غير موجود' });
    sqlite.prepare('DELETE FROM inventeries WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'medicine',
      entityId: id,
      details: `حذف الدواء "${existing.name}"`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  // --- Independent Medicine Batches (FEFO & Quarantine/Expiry Isolation) ---
  app.get('/api/batches', requireAuth, requirePermission('viewInventories'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const medicineId = req.query.medicineId ? Number(req.query.medicineId) : null;
    const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
    const conds: string[] = ['i.pharmacy_id = ?'];
    const params: number[] = [pharmId];
    if (medicineId) {
      conds.push('b.medicine_id = ?');
      params.push(medicineId);
    }
    if (warehouseId) {
      conds.push('b.warehouse_id = ?');
      params.push(warehouseId);
    }
    const whereSql = `WHERE ${conds.join(' AND ')}`;
    const batches = sqlite
      .prepare(
        `SELECT b.*, i.name AS medicine_name, i.unit, i.barcode, w.name AS warehouse_name
         FROM medicine_batches b
         JOIN inventeries i ON i.id = b.medicine_id
         LEFT JOIN warehouses w ON w.id = b.warehouse_id
         ${whereSql}
         ORDER BY b.expiry_date ASC, b.id ASC`,
      )
      .all(...params);
    return res.json({ batches });
  });

  app.post('/api/batches', requireAuth, requirePermission('manageBatches'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const medicineId = Number(req.body?.medicineId);
    const defaultWh = sqlite.prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId) as { id: number } | undefined;
    const requestedWhId = req.body?.warehouseId ? Number(req.body.warehouseId) : null;
    if (requestedWhId) {
      const whExists = sqlite
        .prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?')
        .get(requestedWhId, pharmId);
      if (!whExists) return res.status(400).json({ error: 'المستودع المحدد غير موجود لهذه الصيدلية' });
    }
    const warehouseId = requestedWhId || defaultWh?.id || 1;
    const batchNumber = String(req.body?.batchNumber ?? '').trim();
    const productionDate = String(req.body?.productionDate ?? '').trim();
    const expiryDate = String(req.body?.expiryDate ?? '').trim();
    const qty = Number(req.body?.qty ?? 0);
    const purchasePrice = Math.max(0, Number(req.body?.purchasePrice ?? 0));
    const supplierName = String(req.body?.supplierName ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();

    if (!medicineId || !batchNumber || !expiryDate || qty <= 0) {
      return res.status(400).json({ error: 'يرجى تحديد الدواء ورقم التشغيلة وتاريخ الانتهاء والكمية' });
    }
    const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(medicineId, pharmId) as
      | { id: number; name: string }
      | undefined;
    if (!med) return res.status(404).json({ error: 'الدواء غير موجود' });

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const info = sqlite
        .prepare(
          `INSERT INTO medicine_batches
            (medicine_id, warehouse_id, supplier_name, batch_number, production_date, expiry_date, qty_initial, qty_remaining, purchase_price, status, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          medicineId,
          warehouseId,
          supplierName,
          batchNumber,
          productionDate,
          expiryDate,
          qty,
          qty,
          purchasePrice,
          notes || 'إضافة تشغيلة جديدة',
          currentTimestamp(),
        );
      const batchId = Number(info.lastInsertRowid);
      const newTotal = syncMedicineFromBatches(medicineId);
      recordStockMovement({
        medicineId,
        medicineName: med.name,
        warehouseId,
        batchId,
        batchNumber,
        movementType: 'batch_in',
        qtyChange: qty,
        balanceAfter: newTotal,
        referenceType: 'batch',
        referenceId: batchId,
        notes: notes || 'توريد تشغيلة جديدة',
        userId: user.id,
        pharmacyId: pharmId,
      });
      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'batch',
        entityId: batchId,
        details: `إضافة تشغيلة ${batchNumber} للدواء "${med.name}" بكمية ${qty} (تنتهي ${expiryDate})`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ batchId, totalQuantity: newTotal });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.patch('/api/batches/:id/status', requireAuth, requirePermission('manageBatches'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? '').trim();
    const reason = String(req.body?.reason ?? '').trim();
    if (!['active', 'quarantined', 'expired', 'damaged'].includes(status)) {
      return res.status(400).json({ error: 'حالة التشغيلة غير صالحة' });
    }

    const batch = sqlite
      .prepare(
        `SELECT b.*
         FROM medicine_batches b
         JOIN inventeries i ON i.id = b.medicine_id
         WHERE b.id = ? AND i.pharmacy_id = ?`,
      )
      .get(id, pharmId) as
      | {
          id: number;
          medicine_id: number;
          warehouse_id: number;
          batch_number: string;
          qty_remaining: number;
          purchase_price: number;
          status: string;
        }
      | undefined;
    if (!batch) return res.status(404).json({ error: 'التشغيلة غير موجودة' });

    const med = sqlite
      .prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?')
      .get(batch.medicine_id, pharmId) as { id: number; name: string };

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite
        .prepare('UPDATE medicine_batches SET status = ?, notes = COALESCE(NULLIF(?, \'\'), notes) WHERE id = ?')
        .run(status, reason, id);
      const newTotal = syncMedicineFromBatches(batch.medicine_id);

      if (status !== 'active' && batch.status === 'active' && batch.qty_remaining > 0) {
        const lossValue = Number((batch.qty_remaining * (batch.purchase_price || 0)).toFixed(2));
        sqlite
          .prepare(
            `INSERT INTO stock_counts
              (warehouse_id, medicine_id, medicine_name, batch_id, system_qty, counted_qty, variance, adjustment_type, reason, user_id, pharmacy_id, created_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            batch.warehouse_id,
            batch.medicine_id,
            med.name,
            batch.id,
            batch.qty_remaining,
            -batch.qty_remaining,
            status,
            reason || `عزل تشغيلة (${status})`,
            user.id,
            pharmId,
            currentTimestamp(),
          );
        recordStockMovement({
          medicineId: batch.medicine_id,
          medicineName: med.name,
          warehouseId: batch.warehouse_id,
          batchId: batch.id,
          batchNumber: batch.batch_number,
          movementType: status === 'damaged' ? 'damaged_writeoff' : 'quarantine',
          qtyChange: -batch.qty_remaining,
          balanceAfter: newTotal,
          referenceType: 'batch',
          referenceId: batch.id,
          notes: reason || `عزل تشغيلة ${batch.batch_number}`,
          userId: user.id,
          pharmacyId: pharmId,
        });
        if (lossValue > 0 && (status === 'damaged' || status === 'expired')) {
          postJournalEntry({
            description: `خسارة عزل تشغيلة ${batch.batch_number} (${med.name})`,
            referenceType: 'batch_isolation',
            referenceId: batch.id,
            userId: user.id,
            pharmacyId: pharmId,
            lines: [
              { accountId: resolvePharmacyAccountId(pharmId, '5040'), debit: lossValue, credit: 0 },
              { accountId: resolvePharmacyAccountId(pharmId, '1030'), debit: 0, credit: lossValue },
            ],
          });
        }
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'status_change',
        entityType: 'batch',
        entityId: id,
        details: `تغيير حالة التشغيلة ${batch.batch_number} (${med.name}) إلى ${status}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.json({ ok: true, totalQuantity: newTotal });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  // --- Warehouses & Branches ---
  app.get('/api/warehouses', requireAuth, requirePermission('viewInventories'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const warehouses = sqlite
      .prepare(
        `SELECT w.*,
                COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.qty_remaining ELSE 0 END), 0) AS totalUnits,
                COALESCE(SUM(CASE WHEN b.status = 'active' THEN b.qty_remaining * b.purchase_price ELSE 0 END), 0) AS costValuation
         FROM warehouses w
         LEFT JOIN medicine_batches b ON b.warehouse_id = w.id
         WHERE w.pharmacy_id = ?
         GROUP BY w.id
         ORDER BY w.id ASC`,
      )
      .all(pharmId);
    return res.json({ warehouses });
  });

  app.post('/api/warehouses', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const type = String(req.body?.type ?? 'branch') === 'main' ? 'main' : 'branch';
    const location = String(req.body?.location ?? '').trim();
    if (!name) return res.status(400).json({ error: 'اسم المخزن مطلوب' });
    const info = sqlite
      .prepare('INSERT INTO warehouses (name, type, location, is_active, pharmacy_id, created_at) VALUES (?, ?, ?, 1, ?, ?)')
      .run(name, type, location, pharmId, currentTimestamp());
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'warehouse',
      entityId: id,
      details: `إنشاء مخزن: ${name}`,
      pharmacyId: pharmId,
    });
    return res.status(201).json({ id });
  });

  // --- Inter-Warehouse Transfers (Request -> Approve -> Receive) ---
  app.get('/api/transfers', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const transfers = sqlite
      .prepare(
        `SELECT t.*, wf.name AS from_warehouse_name, wt.name AS to_warehouse_name,
                u1.name AS requested_by_name
         FROM stock_transfers t
         JOIN warehouses wf ON wf.id = t.from_warehouse_id
         JOIN warehouses wt ON wt.id = t.to_warehouse_id
         LEFT JOIN users u1 ON u1.id = t.requested_by
         WHERE t.pharmacy_id = ?
         ORDER BY t.id DESC`,
      )
      .all(pharmId) as Array<Record<string, unknown>>;

    const getItems = sqlite.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?');
    const enriched = transfers.map((t) => ({
      ...t,
      items: getItems.all(Number(t.id)),
    }));
    return res.json({ transfers: enriched });
  });

  app.post('/api/transfers', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const fromWarehouseId = Number(req.body?.fromWarehouseId);
    const toWarehouseId = Number(req.body?.toWarehouseId);
    const notes = String(req.body?.notes ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    if (!fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId) {
      return res.status(400).json({ error: 'يرجى تحديد مخزن مصدر ومخزن وجهة مختلفين' });
    }
    const fromWh = sqlite.prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?').get(fromWarehouseId, pharmId);
    const toWh = sqlite.prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?').get(toWarehouseId, pharmId);
    if (!fromWh || !toWh) {
      return res.status(404).json({ error: 'أحد المستودعات المحددة غير موجود لهذه الصيدلية' });
    }
    if (items.length === 0) {
      return res.status(400).json({ error: 'يرجى إضافة صنف واحد على الأقل للتحويل' });
    }

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const info = sqlite
        .prepare(
          'INSERT INTO stock_transfers (from_warehouse_id, to_warehouse_id, status, notes, requested_by, pharmacy_id, created_at) VALUES (?, ?, \'pending\', ?, ?, ?, ?)',
        )
        .run(fromWarehouseId, toWarehouseId, notes, user.id, pharmId, currentTimestamp());
      const transferId = Number(info.lastInsertRowid);

      const insItem = sqlite.prepare(
        'INSERT INTO stock_transfer_items (transfer_id, medicine_id, medicine_name, batch_id, batch_number, qty) VALUES (?, ?, ?, ?, ?, ?)',
      );

      for (const rawItem of items) {
        const medId = Number(rawItem.medicineId);
        const qty = Number(rawItem.qty);
        const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(medId, pharmId) as
          | { id: number; name: string }
          | undefined;
        if (!med || qty <= 0) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: 'بيانات أصناف التحويل غير صالحة' });
        }
        const availRow = sqlite
          .prepare(
            "SELECT COALESCE(SUM(qty_remaining), 0) AS avail FROM medicine_batches WHERE medicine_id = ? AND warehouse_id = ? AND status = 'active'",
          )
          .get(medId, fromWarehouseId) as { avail: number };
        if (qty > availRow.avail) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: `الكمية المتاحة من "${med.name}" في المخزن المصدر هي ${availRow.avail} فقط` });
        }
        insItem.run(transferId, medId, med.name, rawItem.batchId ? Number(rawItem.batchId) : null, String(rawItem.batchNumber || ''), qty);
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'stock_transfer',
        entityId: transferId,
        details: `طلب تحويل مخزني من مخزن #${fromWarehouseId} إلى #${toWarehouseId}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ transferId });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.post('/api/transfers/:id/approve', requireAuth, requirePermission('approveTransfers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const tr = sqlite.prepare('SELECT * FROM stock_transfers WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { status: string }
      | undefined;
    if (!tr) return res.status(404).json({ error: 'طلب التحويل غير موجود' });
    if (tr.status !== 'pending') return res.status(400).json({ error: 'تمت معالجة هذا الطلب مسبقاً' });

    sqlite.prepare("UPDATE stock_transfers SET status = 'approved', approved_by = ? WHERE id = ? AND pharmacy_id = ?").run(user.id, id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'approve',
      entityType: 'stock_transfer',
      entityId: id,
      details: `اعتماد طلب التحويل المخزني #${id}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  app.post('/api/transfers/:id/receive', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const tr = sqlite.prepare('SELECT * FROM stock_transfers WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { id: number; from_warehouse_id: number; to_warehouse_id: number; status: string }
      | undefined;
    if (!tr) return res.status(404).json({ error: 'طلب التحويل غير موجود' });
    if (tr.status === 'received') return res.status(400).json({ error: 'تم استلام هذا التحويل مسبقاً' });
    if (tr.status === 'pending') return res.status(400).json({ error: 'يجب اعتماد التحويل أولاً قبل الاستلام' });

    const items = sqlite.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(id) as Array<{
      medicine_id: number;
      medicine_name: string;
      qty: number;
    }>;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      for (const item of items) {
        let remainingToMove = item.qty;
        const srcBatches = sqlite
          .prepare(
            "SELECT * FROM medicine_batches WHERE medicine_id = ? AND warehouse_id = ? AND status = 'active' AND qty_remaining > 0 ORDER BY expiry_date ASC, id ASC",
          )
          .all(item.medicine_id, tr.from_warehouse_id) as Array<{
          id: number;
          supplier_name: string;
          batch_number: string;
          production_date: string;
          expiry_date: string;
          qty_remaining: number;
          purchase_price: number;
        }>;

        for (const sb of srcBatches) {
          if (remainingToMove <= 0) break;
          const take = Math.min(remainingToMove, sb.qty_remaining);
          sqlite
            .prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining - ?, 4) WHERE id = ?')
            .run(take, sb.id);

          // Add or merge into destination warehouse batch
          const destExisting = sqlite
            .prepare(
              "SELECT id, qty_remaining FROM medicine_batches WHERE medicine_id = ? AND warehouse_id = ? AND batch_number = ? AND status = 'active'",
            )
            .get(item.medicine_id, tr.to_warehouse_id, sb.batch_number) as
            | { id: number; qty_remaining: number }
            | undefined;
          let destBatchId = 0;
          if (destExisting) {
            sqlite
              .prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining + ?, 4) WHERE id = ?')
              .run(take, destExisting.id);
            destBatchId = destExisting.id;
          } else {
            const ins = sqlite
              .prepare(
                `INSERT INTO medicine_batches
                  (medicine_id, warehouse_id, supplier_name, batch_number, production_date, expiry_date, qty_initial, qty_remaining, purchase_price, status, notes, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
              )
              .run(
                item.medicine_id,
                tr.to_warehouse_id,
                sb.supplier_name,
                sb.batch_number,
                sb.production_date,
                sb.expiry_date,
                take,
                take,
                sb.purchase_price,
                `محول من مخزن #${tr.from_warehouse_id}`,
                currentTimestamp(),
              );
            destBatchId = Number(ins.lastInsertRowid);
          }

          const totalBal = syncMedicineFromBatches(item.medicine_id);
          recordStockMovement({
            medicineId: item.medicine_id,
            medicineName: item.medicine_name,
            warehouseId: tr.from_warehouse_id,
            batchId: sb.id,
            batchNumber: sb.batch_number,
            movementType: 'transfer_out',
            qtyChange: -take,
            balanceAfter: totalBal,
            referenceType: 'stock_transfer',
            referenceId: id,
            notes: `تحويل إلى مخزن #${tr.to_warehouse_id}`,
            userId: user.id,
            pharmacyId: pharmId,
          });
          recordStockMovement({
            medicineId: item.medicine_id,
            medicineName: item.medicine_name,
            warehouseId: tr.to_warehouse_id,
            batchId: destBatchId,
            batchNumber: sb.batch_number,
            movementType: 'transfer_in',
            qtyChange: take,
            balanceAfter: totalBal,
            referenceType: 'stock_transfer',
            referenceId: id,
            notes: `استلام تحويل من مخزن #${tr.from_warehouse_id}`,
            userId: user.id,
            pharmacyId: pharmId,
          });
          remainingToMove = Number((remainingToMove - take).toFixed(4));
        }

        if (remainingToMove > 0.0001) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: `الرصيد المتاح لـ "${item.medicine_name}" غير كافٍ لإتمام التحويل` });
        }
      }

      sqlite
        .prepare("UPDATE stock_transfers SET status = 'received', received_by = ?, received_at = ? WHERE id = ? AND pharmacy_id = ?")
        .run(user.id, currentTimestamp(), id, pharmId);

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'receive',
        entityType: 'stock_transfer',
        entityId: id,
        details: `استلام التحويل المخزني #${id}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.json({ ok: true });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  // --- Stocktaking, Adjustments, Damaged/Lost & Item Movement Card ---
  app.get('/api/stock-counts', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const counts = sqlite
      .prepare(
        `SELECT sc.*, w.name AS warehouse_name, u.name AS user_name
         FROM stock_counts sc
         LEFT JOIN warehouses w ON w.id = sc.warehouse_id
         LEFT JOIN users u ON u.id = sc.user_id
         WHERE sc.pharmacy_id = ?
         ORDER BY sc.id DESC LIMIT 200`,
      )
      .all(pharmId);
    return res.json({ counts });
  });

  app.post('/api/stock-counts', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const batchId = Number(req.body?.batchId);
    const countedQty = Math.max(0, Number(req.body?.countedQty ?? 0));
    const adjustmentType = String(req.body?.adjustmentType ?? 'stocktake');
    const reason = String(req.body?.reason ?? '').trim();

    const batch = sqlite
      .prepare(
        `SELECT b.* FROM medicine_batches b
         JOIN inventeries i ON i.id = b.medicine_id
         WHERE b.id = ? AND i.pharmacy_id = ?`,
      )
      .get(batchId, pharmId) as
      | {
          id: number;
          medicine_id: number;
          warehouse_id: number;
          batch_number: string;
          qty_remaining: number;
          purchase_price: number;
        }
      | undefined;
    if (!batch) return res.status(404).json({ error: 'التشغيلة غير موجودة' });
    const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(batch.medicine_id, pharmId) as {
      id: number;
      name: string;
    };

    const variance = Number((countedQty - batch.qty_remaining).toFixed(4));
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.prepare('UPDATE medicine_batches SET qty_remaining = ? WHERE id = ?').run(countedQty, batch.id);
      const newTotal = syncMedicineFromBatches(batch.medicine_id);

      const info = sqlite
        .prepare(
          `INSERT INTO stock_counts
            (warehouse_id, medicine_id, medicine_name, batch_id, system_qty, counted_qty, variance, adjustment_type, reason, user_id, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          batch.warehouse_id,
          batch.medicine_id,
          med.name,
          batch.id,
          batch.qty_remaining,
          countedQty,
          variance,
          adjustmentType,
          reason || 'تسوية جرد مخزني',
          user.id,
          pharmId,
          currentTimestamp(),
        );

      recordStockMovement({
        medicineId: batch.medicine_id,
        medicineName: med.name,
        warehouseId: batch.warehouse_id,
        batchId: batch.id,
        batchNumber: batch.batch_number,
        movementType: adjustmentType,
        qtyChange: variance,
        balanceAfter: newTotal,
        referenceType: 'stock_count',
        referenceId: Number(info.lastInsertRowid),
        notes: reason || 'جرد وتسوية مخزنية',
        userId: user.id,
        pharmacyId: pharmId,
      });

      if (variance < 0 && (adjustmentType === 'damaged' || adjustmentType === 'lost' || adjustmentType === 'expired')) {
        const lossAmt = Number((Math.abs(variance) * (batch.purchase_price || 0)).toFixed(2));
        if (lossAmt > 0) {
          postJournalEntry({
            description: `تسوية عجز/تالف (${med.name} - تشغيلة ${batch.batch_number})`,
            referenceType: 'stock_count',
            referenceId: Number(info.lastInsertRowid),
            userId: user.id,
            pharmacyId: pharmId,
            lines: [
              { accountId: resolvePharmacyAccountId(pharmId, '5040'), debit: lossAmt, credit: 0 },
              { accountId: resolvePharmacyAccountId(pharmId, '1030'), debit: 0, credit: lossAmt },
            ],
          });
        }
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'stocktake',
        entityType: 'batch',
        entityId: batch.id,
        details: `جرد/تسوية "${med.name}" تشغيلة ${batch.batch_number}: ${batch.qty_remaining} -> ${countedQty}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ ok: true, variance, totalQuantity: newTotal });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.get('/api/stock-movements', requireAuth, requirePermission('viewInventories'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const medicineId = req.query.medicineId ? Number(req.query.medicineId) : null;
    const movements = medicineId
      ? sqlite
          .prepare(
            `SELECT m.*, w.name AS warehouse_name, u.name AS user_name
             FROM stock_movements m
             LEFT JOIN warehouses w ON w.id = m.warehouse_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE m.pharmacy_id = ? AND m.medicine_id = ?
             ORDER BY m.id DESC LIMIT 200`,
          )
          .all(pharmId, medicineId)
      : sqlite
          .prepare(
            `SELECT m.*, w.name AS warehouse_name, u.name AS user_name
             FROM stock_movements m
             LEFT JOIN warehouses w ON w.id = m.warehouse_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE m.pharmacy_id = ?
             ORDER BY m.id DESC LIMIT 200`,
          )
          .all(pharmId);
    return res.json({ movements });
  });

  app.get('/api/warehouses/stagnant', requireAuth, requirePermission('viewInventories'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const days = Math.max(7, Number(req.query.days) || 30);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    const items = sqlite
      .prepare(
        `SELECT i.id, i.name, i.unit, i.quantity, i.purchase_price, i.price,
                (SELECT MAX(s.date) FROM sold_items si JOIN sold s ON s.id = si.soldId WHERE si.medicineId = i.id AND s.pharmacy_id = ? AND s.status = 'completed') AS last_sold_date
         FROM inventeries i
         WHERE i.pharmacy_id = ? AND i.quantity > 0
           AND NOT EXISTS (
             SELECT 1 FROM sold_items si
             JOIN sold s ON s.id = si.soldId
             WHERE si.medicineId = i.id AND s.pharmacy_id = ? AND s.status = 'completed' AND substr(s.date, 1, 10) >= ?
           )
         ORDER BY i.quantity DESC`,
      )
      .all(pharmId, pharmId, pharmId, cutoff);
    return res.json({ stagnant: items, days });
  });
}
