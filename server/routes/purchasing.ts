import type { Express, Request, Response } from 'express';
import {
  sqlite,
  currentTimestamp,
  syncMedicineFromBatches,
  recordStockMovement,
  postJournalEntry,
  resolvePharmacyAccountId,
  logAudit,
} from '../db.ts';
import type { SupplierRecord } from '../db.ts';
import { requireAuth, requirePermission, getPharmacyId, type AuthedRequest } from '../middleware.ts';

export function registerPurchasingRoutes(app: Express): void {
  // --- Suppliers CRUD & Statement ---
  app.get('/api/suppliers', requireAuth, requirePermission('manageSuppliers'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const suppliers = sqlite.prepare('SELECT * FROM supplier WHERE pharmacy_id = ? ORDER BY id ASC').all(pharmId);
    return res.json({ suppliers });
  });

  app.post('/api/suppliers', requireAuth, requirePermission('manageSuppliers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const number = String(req.body?.number ?? '').trim();
    const address = String(req.body?.address ?? '').trim();
    const cnic = String(req.body?.cnic ?? '').trim();
    const pic = String(req.body?.pic ?? '').trim() || 'fk.jpg';
    if (!name || !number) return res.status(400).json({ error: 'اسم المورد ورقم الهاتف مطلوبان' });
    const date = currentTimestamp();
    const info = sqlite
      .prepare('INSERT INTO supplier (name, pic, number, address, cnic, balance, pharmacy_id, date) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
      .run(name, pic, number, address, cnic, pharmId, date);
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'supplier',
      entityId: id,
      details: `إضافة مورد: ${name}`,
      pharmacyId: pharmId,
    });
    return res.status(201).json({
      supplier: { id, name, pic, number, address, cnic, balance: 0, date },
    });
  });

  app.put('/api/suppliers/:id', requireAuth, requirePermission('manageSuppliers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM supplier WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as SupplierRecord | undefined;
    if (!existing) return res.status(404).json({ error: 'المورد غير موجود' });

    const next = {
      name: req.body?.name !== undefined ? String(req.body.name).trim() : existing.name,
      number: req.body?.number !== undefined ? String(req.body.number).trim() : existing.number,
      address: req.body?.address !== undefined ? String(req.body.address).trim() : existing.address,
      cnic: req.body?.cnic !== undefined ? String(req.body.cnic).trim() : existing.cnic,
      pic: req.body?.pic !== undefined && String(req.body.pic).trim() ? String(req.body.pic).trim() : existing.pic,
    };
    sqlite
      .prepare('UPDATE supplier SET name = ?, number = ?, address = ?, cnic = ?, pic = ? WHERE id = ? AND pharmacy_id = ?')
      .run(next.name, next.number, next.address, next.cnic, next.pic, id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update',
      entityType: 'supplier',
      entityId: id,
      details: `تحديث بيانات المورد: ${next.name}`,
      pharmacyId: pharmId,
    });
    return res.json({ supplier: { ...existing, ...next } });
  });

  app.delete('/api/suppliers/:id', requireAuth, requirePermission('deleteSuppliers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT name FROM supplier WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as { name: string } | undefined;
    if (!existing) return res.status(404).json({ error: 'المورد غير موجود' });
    sqlite.prepare('DELETE FROM supplier WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'supplier',
      entityId: id,
      details: `حذف المورد: ${existing.name}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  app.get('/api/suppliers/:id/statement', requireAuth, requirePermission('manageSuppliers'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const supplier = sqlite.prepare('SELECT * FROM supplier WHERE id = ? AND pharmacy_id = ?').get(id, pharmId);
    if (!supplier) return res.status(404).json({ error: 'المورد غير موجود' });

    const orders = sqlite
      .prepare("SELECT id, invoice_number, total_amount, paid_amount, received_at, created_at FROM purchase_orders WHERE supplier_id = ? AND pharmacy_id = ? AND status = 'received' ORDER BY id DESC")
      .all(id, pharmId);
    const returns = sqlite
      .prepare('SELECT id, medicine_name, qty, total_amount, reason, created_at FROM purchase_returns WHERE supplier_id = ? AND pharmacy_id = ? ORDER BY id DESC')
      .all(id, pharmId);
    const payments = sqlite
      .prepare("SELECT id, amount, description, voucher_date, created_at FROM vouchers WHERE counterparty_type = 'supplier' AND counterparty_id = ? AND pharmacy_id = ? ORDER BY id DESC")
      .all(id, pharmId);
    return res.json({ supplier, orders, returns, payments });
  });

  // --- Purchase Workflow: Request -> Approve -> Order -> Receive (with Batches & Shipping Allocation) ---
  app.get('/api/purchases', requireAuth, requirePermission('managePurchases'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const orders = sqlite
      .prepare(
        `SELECT po.*, w.name AS warehouse_name, u1.name AS created_by_name
         FROM purchase_orders po
         LEFT JOIN warehouses w ON w.id = po.warehouse_id
         LEFT JOIN users u1 ON u1.id = po.created_by
         WHERE po.pharmacy_id = ?
         ORDER BY po.id DESC`,
      )
      .all(pharmId) as Array<Record<string, unknown>>;
    const getItems = sqlite.prepare('SELECT * FROM purchase_order_items WHERE po_id = ?');
    return res.json({
      orders: orders.map((o) => ({ ...o, items: getItems.all(Number(o.id)) })),
    });
  });

  app.post('/api/purchases', requireAuth, requirePermission('managePurchases'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const supplierId = Number(req.body?.supplierId);
    const defaultWh = sqlite.prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId) as { id: number } | undefined;
    const requestedWhId = req.body?.warehouseId ? Number(req.body.warehouseId) : null;
    if (requestedWhId) {
      const whExists = sqlite
        .prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?')
        .get(requestedWhId, pharmId);
      if (!whExists) return res.status(400).json({ error: 'المستودع المحدد غير موجود لهذه الصيدلية' });
    }
    const warehouseId = requestedWhId || defaultWh?.id || 1;
    const notes = String(req.body?.notes ?? '').trim();
    const discountAmount = Math.max(0, Number(req.body?.discountAmount ?? 0));
    const taxAmount = Math.max(0, Number(req.body?.taxAmount ?? 0));
    const shippingCost = Math.max(0, Number(req.body?.shippingCost ?? 0));
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const supplier = sqlite.prepare('SELECT id, name FROM supplier WHERE id = ? AND pharmacy_id = ?').get(supplierId, pharmId) as
      | { id: number; name: string }
      | undefined;
    if (!supplier) return res.status(404).json({ error: 'المورد غير موجود' });
    if (items.length === 0) return res.status(400).json({ error: 'يرجى إضافة صنف واحد على الأقل' });

    let subtotal = 0;
    for (const it of items) {
      const qty = Number(it.qty) || 0;
      const pp = Number(it.purchasePrice) || 0;
      const disc = Math.min(100, Math.max(0, Number(it.discountPct) || 0));
      subtotal += qty * pp * (1 - disc / 100);
    }
    subtotal = Number(subtotal.toFixed(2));
    const totalAmount = Number(Math.max(0, subtotal - discountAmount + taxAmount + shippingCost).toFixed(2));

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const info = sqlite
        .prepare(
          `INSERT INTO purchase_orders
            (supplier_id, supplier_name, warehouse_id, stage, status, subtotal, discount_amount, tax_amount, shipping_cost, total_amount, notes, created_by, pharmacy_id, created_at)
           VALUES (?, ?, ?, 'request', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(supplier.id, supplier.name, warehouseId, subtotal, discountAmount, taxAmount, shippingCost, totalAmount, notes, user.id, pharmId, currentTimestamp());
      const poId = Number(info.lastInsertRowid);

      const insItem = sqlite.prepare(
        `INSERT INTO purchase_order_items
          (po_id, medicine_id, medicine_name, qty, purchase_price, discount_pct, landed_unit_cost, batch_number, production_date, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const it of items) {
        const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(Number(it.medicineId), pharmId) as
          | { id: number; name: string }
          | undefined;
        if (!med) {
          sqlite.exec('ROLLBACK');
          return res.status(404).json({ error: 'أحد الأصناف غير موجود في مخزون الصيدلية' });
        }
        const qty = Math.max(0.01, Number(it.qty));
        const pp = Math.max(0, Number(it.purchasePrice) || 0);
        const disc = Math.min(100, Math.max(0, Number(it.discountPct) || 0));
        const lineNet = qty * pp * (1 - disc / 100);
        const shareShipping = subtotal > 0 ? (lineNet / subtotal) * shippingCost : 0;
        const landed = Number(((lineNet + shareShipping) / qty).toFixed(4));
        insItem.run(
          poId,
          med.id,
          med.name,
          qty,
          pp,
          disc,
          landed,
          String(it.batchNumber ?? ''),
          String(it.productionDate ?? ''),
          String(it.expiryDate ?? ''),
        );
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'purchase_order',
        entityId: poId,
        details: `إنشاء طلب شراء #${poId} من المورد "${supplier.name}" بإجمالي ${totalAmount}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ poId, totalAmount });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.post('/api/purchases/:id/approve', requireAuth, requirePermission('approvePurchases'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const po = sqlite.prepare('SELECT status FROM purchase_orders WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as { status: string } | undefined;
    if (!po) return res.status(404).json({ error: 'طلب الشراء غير موجود' });
    if (po.status !== 'pending') return res.status(400).json({ error: 'تمت معالجة هذا الطلب مسبقاً' });

    sqlite.prepare("UPDATE purchase_orders SET stage = 'order', status = 'ordered', approved_by = ? WHERE id = ? AND pharmacy_id = ?").run(user.id, id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'approve',
      entityType: 'purchase_order',
      entityId: id,
      details: `اعتماد وإصدار أمر شراء #${id}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  app.post('/api/purchases/:id/receive', requireAuth, requirePermission('managePurchases'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const po = sqlite.prepare('SELECT * FROM purchase_orders WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | {
          id: number;
          supplier_id: number;
          supplier_name: string;
          warehouse_id: number;
          status: string;
          subtotal: number;
          discount_amount: number;
          tax_amount: number;
          shipping_cost: number;
          total_amount: number;
        }
      | undefined;
    if (!po) return res.status(404).json({ error: 'أمر الشراء غير موجود' });
    if (po.status === 'received') return res.status(400).json({ error: 'تم استلام هذا الطلب مسبقاً' });

    const invoiceNumber = String(req.body?.invoiceNumber ?? '').trim() || `SUP-INV-${id}`;
    const paidAmount = Math.min(po.total_amount, Math.max(0, Number(req.body?.paidAmount ?? 0)));
    const defaultBox = sqlite.prepare('SELECT id FROM cash_boxes WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId) as { id: number } | undefined;
    const cashBoxId = Number(req.body?.cashBoxId) || defaultBox?.id || 1;
    const overrideItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const poItems = sqlite.prepare('SELECT * FROM purchase_order_items WHERE po_id = ?').all(id) as Array<{
      id: number;
      medicine_id: number;
      medicine_name: string;
      qty: number;
      purchase_price: number;
      discount_pct: number;
      landed_unit_cost: number;
      batch_number: string;
      production_date: string;
      expiry_date: string;
    }>;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const now = currentTimestamp();
      const defaultExp = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);

      for (const item of poItems) {
        const ov = overrideItems.find((x: Record<string, unknown>) => Number(x.id) === item.id || Number(x.medicineId) === item.medicine_id);
        const batchNumber = String(ov?.batchNumber ?? item.batch_number ?? '').trim() || `PO-${id}-${item.medicine_id}`;
        const productionDate = String(ov?.productionDate ?? item.production_date ?? '').trim();
        const expiryDate = String(ov?.expiryDate ?? item.expiry_date ?? '').trim() || defaultExp;
        const qty = Number(ov?.qty ?? item.qty);
        const landedCost = item.landed_unit_cost || item.purchase_price;

        sqlite
          .prepare('UPDATE purchase_order_items SET batch_number = ?, production_date = ?, expiry_date = ?, qty = ? WHERE id = ?')
          .run(batchNumber, productionDate, expiryDate, qty, item.id);

        const bInfo = sqlite
          .prepare(
            `INSERT INTO medicine_batches
              (medicine_id, warehouse_id, supplier_name, batch_number, production_date, expiry_date, qty_initial, qty_remaining, purchase_price, status, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .run(
            item.medicine_id,
            po.warehouse_id,
            po.supplier_name,
            batchNumber,
            productionDate,
            expiryDate,
            qty,
            qty,
            landedCost,
            `فاتورة توريد ${invoiceNumber}`,
            now,
          );

        sqlite.prepare('UPDATE inventeries SET purchase_price = ?, supplier = ? WHERE id = ? AND pharmacy_id = ?').run(landedCost, po.supplier_name, item.medicine_id, pharmId);
        const bal = syncMedicineFromBatches(item.medicine_id);
        recordStockMovement({
          medicineId: item.medicine_id,
          medicineName: item.medicine_name,
          warehouseId: po.warehouse_id,
          batchId: Number(bInfo.lastInsertRowid),
          batchNumber,
          movementType: 'purchase_in',
          qtyChange: qty,
          balanceAfter: bal,
          referenceType: 'purchase_order',
          referenceId: id,
          notes: `استلام أمر شراء #${id} (${invoiceNumber})`,
          userId: user.id,
          pharmacyId: pharmId,
        });
      }

      const creditAdded = Number((po.total_amount - paidAmount).toFixed(2));
      if (creditAdded > 0) {
        sqlite.prepare('UPDATE supplier SET balance = ROUND(balance + ?, 2) WHERE id = ? AND pharmacy_id = ?').run(creditAdded, po.supplier_id, pharmId);
      }

      sqlite
        .prepare("UPDATE purchase_orders SET stage = 'received', status = 'received', invoice_number = ?, paid_amount = ?, received_by = ?, received_at = ? WHERE id = ? AND pharmacy_id = ?")
        .run(invoiceNumber, paidAmount, user.id, now, id, pharmId);

      const box = sqlite.prepare('SELECT account_id FROM cash_boxes WHERE id = ? AND pharmacy_id = ?').get(cashBoxId, pharmId) as
        | { account_id: number }
        | undefined;
      const cashAccId = box?.account_id || resolvePharmacyAccountId(pharmId, '1010');
      const lines: Array<{ accountId: number; debit: number; credit: number }> = [
        { accountId: resolvePharmacyAccountId(pharmId, '1030'), debit: po.total_amount, credit: 0 },
      ];
      if (paidAmount > 0) lines.push({ accountId: cashAccId, debit: 0, credit: paidAmount });
      if (creditAdded > 0) lines.push({ accountId: resolvePharmacyAccountId(pharmId, '2010'), debit: 0, credit: creditAdded });

      postJournalEntry({
        description: `استلام فاتورة مورد ${invoiceNumber} - ${po.supplier_name}`,
        referenceType: 'purchase_order',
        referenceId: id,
        userId: user.id,
        pharmacyId: pharmId,
        lines,
      });

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'receive',
        entityType: 'purchase_order',
        entityId: id,
        details: `استلام مشتريات أمر #${id} (${invoiceNumber}) بمبلغ ${po.total_amount} (مدفوع: ${paidAmount})`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.json({ ok: true });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  // --- Purchase Returns ---
  app.get('/api/purchase-returns', requireAuth, requirePermission('managePurchases'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const returns = sqlite
      .prepare('SELECT pr.*, u.name AS user_name FROM purchase_returns pr LEFT JOIN users u ON u.id = pr.user_id WHERE pr.pharmacy_id = ? ORDER BY pr.id DESC')
      .all(pharmId);
    return res.json({ returns });
  });

  app.post('/api/purchase-returns', requireAuth, requirePermission('managePurchases'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const supplierId = Number(req.body?.supplierId);
    const batchId = Number(req.body?.batchId);
    const qty = Number(req.body?.qty ?? 0);
    const reason = String(req.body?.reason ?? '').trim() || 'مرتجع إلى المورد';

    const supplier = sqlite.prepare('SELECT id, name FROM supplier WHERE id = ? AND pharmacy_id = ?').get(supplierId, pharmId) as
      | { id: number; name: string }
      | undefined;
    const batch = sqlite
      .prepare('SELECT b.* FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id WHERE b.id = ? AND i.pharmacy_id = ?')
      .get(batchId, pharmId) as
      | { id: number; medicine_id: number; warehouse_id: number; batch_number: string; qty_remaining: number; purchase_price: number }
      | undefined;

    if (!supplier || !batch || qty <= 0 || qty > batch.qty_remaining) {
      return res.status(400).json({ error: 'بيانات مرتجع المشتريات غير صالحة أو الكمية تتجاوز رصيد التشغيلة' });
    }

    const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(batch.medicine_id, pharmId) as { id: number; name: string };
    const unitCost = batch.purchase_price || 0;
    const totalAmount = Number((qty * unitCost).toFixed(2));

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.prepare('UPDATE medicine_batches SET qty_remaining = ROUND(qty_remaining - ?, 4) WHERE id = ?').run(qty, batch.id);
      const bal = syncMedicineFromBatches(batch.medicine_id);

      const info = sqlite
        .prepare(
          'INSERT INTO purchase_returns (supplier_id, supplier_name, medicine_id, medicine_name, batch_id, qty, unit_cost, total_amount, reason, user_id, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(supplier.id, supplier.name, med.id, med.name, batch.id, qty, unitCost, totalAmount, reason, user.id, pharmId, currentTimestamp());
      const retId = Number(info.lastInsertRowid);

      sqlite.prepare('UPDATE supplier SET balance = ROUND(MAX(0, balance - ?), 2) WHERE id = ? AND pharmacy_id = ?').run(totalAmount, supplier.id, pharmId);
      recordStockMovement({
        medicineId: med.id,
        medicineName: med.name,
        warehouseId: batch.warehouse_id,
        batchId: batch.id,
        batchNumber: batch.batch_number,
        movementType: 'purchase_return',
        qtyChange: -qty,
        balanceAfter: bal,
        referenceType: 'purchase_return',
        referenceId: retId,
        notes: reason,
        userId: user.id,
        pharmacyId: pharmId,
      });

      if (totalAmount > 0) {
        postJournalEntry({
          description: `مرتجع مشتريات إلى المورد ${supplier.name} (${med.name})`,
          referenceType: 'purchase_return',
          referenceId: retId,
          userId: user.id,
          pharmacyId: pharmId,
          lines: [
            { accountId: resolvePharmacyAccountId(pharmId, '2010'), debit: totalAmount, credit: 0 },
            { accountId: resolvePharmacyAccountId(pharmId, '1030'), debit: 0, credit: totalAmount },
          ],
        });
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'purchase_return',
        entityType: 'purchase_return',
        entityId: retId,
        details: `مرتجع مشتريات للمورد "${supplier.name}" - ${med.name} (${qty})`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ id: retId, totalAmount });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  // --- Supplier Price Comparison ---
  app.get('/api/purchases/price-comparison', requireAuth, requirePermission('managePurchases'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const rows = sqlite
      .prepare(
        `SELECT poi.medicine_id, poi.medicine_name, po.supplier_name,
                MIN(poi.purchase_price) AS min_price,
                MAX(poi.purchase_price) AS max_price,
                AVG(poi.purchase_price) AS avg_price,
                SUM(poi.qty) AS total_qty
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.po_id
         WHERE po.pharmacy_id = ?
         GROUP BY poi.medicine_id, po.supplier_name
         ORDER BY poi.medicine_name ASC, min_price ASC`,
      )
      .all(pharmId);
    return res.json({ comparison: rows });
  });
}
