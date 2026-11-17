import type { Express, Request, Response } from 'express';
import { sqlite, currentTimestamp, logAudit } from '../db.ts';
import { requireAuth, requirePermission, getPharmacyId, type AuthedRequest } from '../middleware.ts';

export function registerClinicalRoutes(app: Express): void {
  // --- Customers CRUD & Credit Statement ---
  app.get('/api/customers', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const customers = sqlite
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM sold s WHERE s.customer_id = c.id AND s.status = 'completed') AS invoiceCount,
                (SELECT COALESCE(SUM(CAST(s.amount AS REAL)), 0) FROM sold s WHERE s.customer_id = c.id AND s.status = 'completed') AS totalPurchases
         FROM customers c
         WHERE c.pharmacy_id = ?
         ORDER BY c.id ASC`,
      )
      .all(pharmId);
    return res.json({ customers });
  });

  app.post('/api/customers', requireAuth, requirePermission('manageCustomers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const address = String(req.body?.address ?? '').trim();
    const creditLimit = Math.max(0, Number(req.body?.creditLimit ?? 0));
    const notes = String(req.body?.notes ?? '').trim();
    const allergies = String(req.body?.allergies ?? '').trim();
    const chronicConditions = String(req.body?.chronicConditions ?? '').trim();
    const insuranceId = req.body?.insuranceId ? Number(req.body.insuranceId) : null;
    const policyNumber = String(req.body?.policyNumber ?? '').trim();

    if (!name) return res.status(400).json({ error: 'يرجى إدخال اسم العميل' });

    const createdAt = currentTimestamp();
    const info = sqlite
      .prepare(
        `INSERT INTO customers
          (name, phone, address, credit_limit, balance, notes, allergies, chronic_conditions, insurance_id, policy_number, pharmacy_id, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(name, phone, address, creditLimit, notes, allergies, chronicConditions, insuranceId, policyNumber, pharmId, createdAt);
    const id = Number(info.lastInsertRowid);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'customer',
      entityId: id,
      details: `إضافة عميل جديد: ${name}`,
      pharmacyId: pharmId,
    });

    const customer = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    return res.status(201).json({ customer });
  });

  app.put('/api/customers/:id', requireAuth, requirePermission('manageCustomers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM customers WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | {
          id: number;
          name: string;
          phone: string;
          address: string;
          credit_limit: number;
          notes: string;
          allergies?: string;
          chronic_conditions?: string;
          insurance_id?: number | null;
          policy_number?: string;
        }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'العميل غير موجود' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) return res.status(400).json({ error: 'اسم العميل مطلوب' });
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : existing.phone;
    const address = req.body?.address !== undefined ? String(req.body.address).trim() : existing.address;
    const creditLimit =
      req.body?.creditLimit !== undefined ? Math.max(0, Number(req.body.creditLimit)) : existing.credit_limit;
    const notes = req.body?.notes !== undefined ? String(req.body.notes).trim() : existing.notes;
    const allergies =
      req.body?.allergies !== undefined ? String(req.body.allergies).trim() : existing.allergies || '';
    const chronicConditions =
      req.body?.chronicConditions !== undefined
        ? String(req.body.chronicConditions).trim()
        : existing.chronic_conditions || '';
    const insuranceId =
      req.body?.insuranceId !== undefined
        ? req.body.insuranceId
          ? Number(req.body.insuranceId)
          : null
        : existing.insurance_id ?? null;
    const policyNumber =
      req.body?.policyNumber !== undefined ? String(req.body.policyNumber).trim() : existing.policy_number || '';

    sqlite
      .prepare(
        `UPDATE customers
         SET name = ?, phone = ?, address = ?, credit_limit = ?, notes = ?,
             allergies = ?, chronic_conditions = ?, insurance_id = ?, policy_number = ?
         WHERE id = ?`,
      )
      .run(name, phone, address, creditLimit, notes, allergies, chronicConditions, insuranceId, policyNumber, id);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update',
      entityType: 'customer',
      entityId: id,
      details: `تعديل بيانات العميل: ${name}`,
      pharmacyId: pharmId,
    });

    const customer = sqlite.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    return res.json({ customer });
  });

  app.delete('/api/customers/:id', requireAuth, requirePermission('manageCustomers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT name, balance FROM customers WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { name: string; balance: number }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'العميل غير موجود' });
    if (existing.name === 'عميل نقدي عام') {
      return res.status(400).json({ error: 'لا يمكن حذف حساب العميل النقدي الافتراضي' });
    }
    if (Math.abs(existing.balance) > 0.01) {
      return res.status(409).json({ error: 'لا يمكن حذف عميل عليه رصيد مالي مستحق قبل تسويته' });
    }
    const rxCount = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM prescriptions WHERE customer_id = ?').get(id) as { cnt: number }).cnt;
    if (rxCount > 0) {
      return res.status(409).json({ error: `لا يمكن حذف العميل لوجود (${rxCount}) وصفات طبية مسجلة باسمه` });
    }
    sqlite.prepare('DELETE FROM customers WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'customer',
      entityId: id,
      details: `حذف العميل: ${existing.name}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  app.get('/api/customers/:id/statement', requireAuth, requirePermission('manageCustomers'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const customer = sqlite.prepare('SELECT * FROM customers WHERE id = ? AND pharmacy_id = ?').get(id, pharmId);
    if (!customer) return res.status(404).json({ error: 'العميل غير موجود' });

    const invoices = sqlite
      .prepare(
        `SELECT id, amount, paid_amount, remaining_amount, payment_method, status, date
         FROM sold
         WHERE customer_id = ?
         ORDER BY id DESC`,
      )
      .all(id);
    const payments = sqlite
      .prepare(
        `SELECT id, amount, description, voucher_date, created_at
         FROM vouchers
         WHERE counterparty_type = 'customer' AND counterparty_id = ?
         ORDER BY id DESC`,
      )
      .all(id);
    const prescriptions = sqlite
      .prepare(
        `SELECT p.*, COALESCE(d.name, 'غير محدد') AS doctor_name
         FROM prescriptions p
         LEFT JOIN doctors d ON d.id = p.doctor_id
         WHERE p.customer_id = ?
         ORDER BY p.id DESC`,
      )
      .all(id);

    return res.json({ customer, invoices, payments, prescriptions });
  });

  // --- Doctors CRUD ---
  app.get('/api/doctors', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const doctors = sqlite
      .prepare(
        `SELECT d.*, (SELECT COUNT(*) FROM prescriptions p WHERE p.doctor_id = d.id) AS prescriptionCount
         FROM doctors d
         WHERE d.pharmacy_id = ?
         ORDER BY d.id ASC`,
      )
      .all(pharmId);
    return res.json({ doctors });
  });

  app.post('/api/doctors', requireAuth, requirePermission('managePrescriptions'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const specialty = String(req.body?.specialty ?? '').trim();
    const clinic = String(req.body?.clinic ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const licenseNumber = String(req.body?.licenseNumber ?? '').trim();

    if (!name) return res.status(400).json({ error: 'يرجى إدخال اسم الطبيب' });

    const info = sqlite
      .prepare(
        'INSERT INTO doctors (name, specialty, clinic, phone, license_number, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(name, specialty, clinic, phone, licenseNumber, pharmId, currentTimestamp());
    const id = Number(info.lastInsertRowid);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'doctor',
      entityId: id,
      details: `تسجيل طبيب: ${name}`,
      pharmacyId: pharmId,
    });

    const doctor = sqlite.prepare('SELECT * FROM doctors WHERE id = ?').get(id);
    return res.status(201).json({ doctor });
  });

  app.put('/api/doctors/:id', requireAuth, requirePermission('managePrescriptions'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM doctors WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { id: number; name: string; specialty: string; clinic: string; phone: string; license_number: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'الطبيب غير موجود' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) return res.status(400).json({ error: 'اسم الطبيب مطلوب' });
    const specialty = req.body?.specialty !== undefined ? String(req.body.specialty).trim() : existing.specialty;
    const clinic = req.body?.clinic !== undefined ? String(req.body.clinic).trim() : existing.clinic;
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : existing.phone;
    const licenseNumber =
      req.body?.licenseNumber !== undefined ? String(req.body.licenseNumber).trim() : existing.license_number;

    sqlite
      .prepare('UPDATE doctors SET name = ?, specialty = ?, clinic = ?, phone = ?, license_number = ? WHERE id = ? AND pharmacy_id = ?')
      .run(name, specialty, clinic, phone, licenseNumber, id, pharmId);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update',
      entityType: 'doctor',
      entityId: id,
      details: `تحديث بيانات الطبيب: ${name}`,
      pharmacyId: pharmId,
    });

    const doctor = sqlite.prepare('SELECT * FROM doctors WHERE id = ? AND pharmacy_id = ?').get(id, pharmId);
    return res.json({ doctor });
  });

  app.delete('/api/doctors/:id', requireAuth, requirePermission('managePrescriptions'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT name FROM doctors WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as { name: string } | undefined;
    if (!existing) return res.status(404).json({ error: 'الطبيب غير موجود' });

    sqlite.prepare('UPDATE prescriptions SET doctor_id = NULL WHERE doctor_id = ? AND pharmacy_id = ?').run(id, pharmId);
    sqlite.prepare('DELETE FROM doctors WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'doctor',
      entityId: id,
      details: `حذف الطبيب: ${existing.name}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });

  // --- Medical Prescriptions (Reference record under pharmacist supervision) ---
  app.get('/api/prescriptions', requireAuth, requirePermission('managePrescriptions'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const rows = sqlite
      .prepare(
        `SELECT p.*,
                c.name AS customer_name,
                c.phone AS customer_phone,
                COALESCE(d.name, 'غير محدد') AS doctor_name,
                COALESCE(d.specialty, '') AS doctor_specialty,
                u.name AS created_by_name
         FROM prescriptions p
         JOIN customers c ON c.id = p.customer_id
         LEFT JOIN doctors d ON d.id = p.doctor_id
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.pharmacy_id = ?
         ORDER BY p.id DESC`,
      )
      .all(pharmId) as Array<Record<string, unknown>>;

    const getItems = sqlite.prepare('SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY id ASC');
    const prescriptions = rows.map((r) => ({
      ...r,
      items: getItems.all(Number(r.id)),
    }));
    return res.json({ prescriptions });
  });

  app.post('/api/prescriptions', requireAuth, requirePermission('managePrescriptions'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const customerId = Number(req.body?.customerId);
    const doctorId = req.body?.doctorId ? Number(req.body.doctorId) : null;
    const prescriptionDate = String(req.body?.prescriptionDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const referenceNotes = String(req.body?.referenceNotes ?? '').trim();
    const rxType = String(req.body?.rxType ?? 'standard').trim();
    const refillsAllowed = Math.max(0, Math.floor(Number(req.body?.refillsAllowed ?? 0)));
    const insuranceId = req.body?.insuranceId ? Number(req.body.insuranceId) : null;
    const policyNumber = String(req.body?.policyNumber ?? '').trim();
    const approvalCode = String(req.body?.approvalCode ?? '').trim();
    const validUntil = String(req.body?.validUntil ?? '').trim();
    const items = Array.isArray(req.body?.items) ? req.body.items : [];

    const customer = sqlite.prepare('SELECT id, name FROM customers WHERE id = ? AND pharmacy_id = ?').get(customerId, pharmId) as
      | { id: number; name: string }
      | undefined;
    if (!customer) return res.status(404).json({ error: 'المريض / العميل غير موجود' });
    if (doctorId) {
      const doc = sqlite.prepare('SELECT id FROM doctors WHERE id = ? AND pharmacy_id = ?').get(doctorId, pharmId);
      if (!doc) return res.status(404).json({ error: 'الطبيب المحدد غير موجود' });
    }
    if (insuranceId) {
      const ins = sqlite.prepare('SELECT id FROM insurance_companies WHERE id = ? AND pharmacy_id = ?').get(insuranceId, pharmId);
      if (!ins) return res.status(404).json({ error: 'شركة التأمين المحددة غير موجودة' });
    }
    if (items.length === 0) {
      return res.status(400).json({ error: 'يرجى إضافة دواء واحد على الأقل في الوصفة الطبية' });
    }

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const info = sqlite
        .prepare(
          `INSERT INTO prescriptions
            (customer_id, doctor_id, prescription_date, reference_notes, rx_type, refills_allowed, refills_used,
             insurance_id, policy_number, approval_code, valid_until, status, created_by, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          customerId,
          doctorId,
          prescriptionDate,
          referenceNotes,
          rxType,
          refillsAllowed,
          insuranceId,
          policyNumber,
          approvalCode,
          validUntil,
          user.id,
          pharmId,
          currentTimestamp(),
        );
      const rxId = Number(info.lastInsertRowid);

      const insItem = sqlite.prepare(
        `INSERT INTO prescription_items
          (prescription_id, medicine_id, medicine_name, dosage, frequency, duration, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const it of items) {
        const medId = it.medicineId ? Number(it.medicineId) : null;
        let medName = String(it.medicineName ?? '').trim();
        if (medId) {
          const med = sqlite.prepare('SELECT name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(medId, pharmId) as
            | { name: string }
            | undefined;
          if (!med) {
            sqlite.exec('ROLLBACK');
            return res.status(404).json({ error: 'أحد الأدوية المرتبطة بالوصفة غير موجود في مخزون الصيدلية' });
          }
          if (!medName) medName = med.name;
        }
        if (!medName) continue;
        insItem.run(
          rxId,
          medId,
          medName,
          String(it.dosage ?? '').trim(),
          String(it.frequency ?? '').trim(),
          String(it.duration ?? '').trim(),
          Math.max(1, Number(it.qty) || 1),
        );
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'prescription',
        entityId: rxId,
        details: `تسجيل وصفة طبية #${rxId} للمريض ${customer.name}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');

      const created = sqlite
        .prepare(
          `SELECT p.*, c.name AS customer_name, COALESCE(d.name, 'غير محدد') AS doctor_name
           FROM prescriptions p
           JOIN customers c ON c.id = p.customer_id
           LEFT JOIN doctors d ON d.id = p.doctor_id
           WHERE p.id = ? AND p.pharmacy_id = ?`,
        )
        .get(rxId, pharmId) as Record<string, unknown>;
      const rxItems = sqlite.prepare('SELECT * FROM prescription_items WHERE prescription_id = ?').all(rxId);
      return res.status(201).json({ prescription: { ...created, items: rxItems } });
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  });

  app.patch(
    '/api/prescriptions/:id/status',
    requireAuth,
    requirePermission('managePrescriptions'),
    (req: Request, res: Response) => {
      const { user } = (req as AuthedRequest).auth;
      const pharmId = getPharmacyId(req);
      const id = Number(req.params.id);
      const status = String(req.body?.status ?? '').trim();
      if (!['pending', 'dispensed', 'cancelled'].includes(status)) {
        return res.status(400).json({ error: 'حالة الوصفة غير صالحة' });
      }
      const existing = sqlite.prepare('SELECT * FROM prescriptions WHERE id = ? AND pharmacy_id = ?').get(id, pharmId);
      if (!existing) return res.status(404).json({ error: 'الوصفة غير موجودة' });

      sqlite.prepare('UPDATE prescriptions SET status = ? WHERE id = ? AND pharmacy_id = ?').run(status, id, pharmId);
      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'status_change',
        entityType: 'prescription',
        entityId: id,
        details: `تغيير حالة الوصفة #${id} إلى ${status}`,
        pharmacyId: pharmId,
      });
      return res.json({ ok: true });
    },
  );

  // Refill chronic/complex prescription
  app.post(
    '/api/prescriptions/:id/refill',
    requireAuth,
    requirePermission('managePrescriptions'),
    (req: Request, res: Response) => {
      const { user } = (req as AuthedRequest).auth;
      const pharmId = getPharmacyId(req);
      const id = Number(req.params.id);
      const rx = sqlite.prepare('SELECT * FROM prescriptions WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
        | { id: number; refills_allowed: number; refills_used: number; valid_until: string; status: string }
        | undefined;
      if (!rx) return res.status(404).json({ error: 'الوصفة غير موجودة' });
      if (rx.status === 'cancelled') {
        return res.status(400).json({ error: 'لا يمكن إعادة صرف وصفة ملغاة' });
      }
      if (rx.refills_allowed > 0 && rx.refills_used >= rx.refills_allowed) {
        return res.status(400).json({ error: `تم استنفاد عدد مرات إعادة الصرف المسموحة (${rx.refills_allowed})` });
      }
      const today = currentTimestamp().slice(0, 10);
      if (rx.valid_until && rx.valid_until < today) {
        return res.status(400).json({ error: `انتهت صلاحية الوصفة بتاريخ ${rx.valid_until}` });
      }

      sqlite.prepare("UPDATE prescriptions SET status = 'pending' WHERE id = ? AND pharmacy_id = ?").run(id, pharmId);
      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'update',
        entityType: 'prescription',
        entityId: id,
        details: `تجهيز إعادة صرف (Refill) للوصفة #${id}`,
        pharmacyId: pharmId,
      });
      return res.json({ ok: true });
    },
  );
}
