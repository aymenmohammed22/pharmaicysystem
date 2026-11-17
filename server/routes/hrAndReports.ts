import type { Express, Request, Response } from 'express';
import {
  sqlite,
  currentTimestamp,
  getSiteSettings,
  resolveSiteCurrency,
  getAdminName,
  postJournalEntry,
  logAudit,
  resolvePharmacyAccountId,
} from '../db.ts';
import type { BillItem } from '../db.ts';
import { requireAuth, requirePermission, computeAlerts, getPharmacyId, type AuthedRequest } from '../middleware.ts';

export function registerHrAndReportsRoutes(app: Express): void {
  // --- Employees HR Profiles ---
  app.get('/api/hr/employees', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const employees = sqlite
      .prepare(
        `SELECT e.*, u.email AS user_email, u.role AS user_role
         FROM employees e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE e.pharmacy_id = ?
         ORDER BY e.id ASC`,
      )
      .all(pharmId);
    return res.json({ employees });
  });

  app.post('/api/hr/employees', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const fullName = String(req.body?.fullName ?? '').trim();
    const jobTitle = String(req.body?.jobTitle ?? '').trim();
    const specialty = String(req.body?.specialty ?? '').trim();
    const phone = String(req.body?.phone ?? '').trim();
    const baseSalary = Math.max(0, Number(req.body?.baseSalary ?? 0));
    const commissionRate = Math.max(0, Number(req.body?.commissionRate ?? 0));
    const hireDate = String(req.body?.hireDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const linkedUserId = req.body?.userId ? Number(req.body.userId) : null;

    if (!fullName || !jobTitle) {
      return res.status(400).json({ error: 'اسم الموظف والمسمى الوظيفي مطلوبان' });
    }
    if (linkedUserId) {
      const targetUser = sqlite
        .prepare('SELECT id FROM users WHERE id = ? AND pharmacy_id = ?')
        .get(linkedUserId, pharmId);
      if (!targetUser) {
        return res.status(404).json({ error: 'المستخدم المحدد غير تابع لهذه الصيدلية' });
      }
      const clash = sqlite.prepare('SELECT id FROM employees WHERE user_id = ?').get(linkedUserId);
      if (clash) return res.status(409).json({ error: 'المستخدم المحدد مرتبط مسبقاً بملف موظف آخر' });
    }

    const info = sqlite
      .prepare(
        `INSERT INTO employees
          (user_id, full_name, job_title, specialty, phone, base_salary, commission_rate, hire_date, is_active, pharmacy_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(linkedUserId, fullName, jobTitle, specialty, phone, baseSalary, commissionRate, hireDate, pharmId);
    const id = Number(info.lastInsertRowid);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'employee',
      entityId: id,
      details: `إضافة ملف موظف: ${fullName} (${jobTitle})`,
      pharmacyId: pharmId,
    });

    const employee = sqlite.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    return res.status(201).json({ employee });
  });

  app.put('/api/hr/employees/:id', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM employees WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'الموظف غير موجود' });

    const fullName = req.body?.fullName !== undefined ? String(req.body.fullName).trim() : String(existing.full_name);
    const jobTitle = req.body?.jobTitle !== undefined ? String(req.body.jobTitle).trim() : String(existing.job_title);
    const specialty = req.body?.specialty !== undefined ? String(req.body.specialty).trim() : String(existing.specialty);
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : String(existing.phone);
    const baseSalary =
      req.body?.baseSalary !== undefined ? Math.max(0, Number(req.body.baseSalary)) : Number(existing.base_salary);
    const commissionRate =
      req.body?.commissionRate !== undefined
        ? Math.max(0, Number(req.body.commissionRate))
        : Number(existing.commission_rate);
    const isActive = req.body?.isActive !== undefined ? (req.body.isActive ? 1 : 0) : Number(existing.is_active);

    if (!fullName || !jobTitle) return res.status(400).json({ error: 'الاسم والمسمى الوظيفي مطلوبان' });

    sqlite
      .prepare(
        `UPDATE employees
         SET full_name = ?, job_title = ?, specialty = ?, phone = ?, base_salary = ?, commission_rate = ?, is_active = ?
         WHERE id = ? AND pharmacy_id = ?`,
      )
      .run(fullName, jobTitle, specialty, phone, baseSalary, commissionRate, isActive, id, pharmId);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update',
      entityType: 'employee',
      entityId: id,
      details: `تحديث بيانات الموظف: ${fullName}`,
      pharmacyId: pharmId,
    });

    const employee = sqlite.prepare('SELECT * FROM employees WHERE id = ?').get(id);
    return res.json({ employee });
  });

  // --- Attendance Check-in / Check-out ---
  app.get('/api/hr/attendance', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const workDate = String(req.query.date ?? '').trim();
    const rows = workDate
      ? sqlite
          .prepare(
            `SELECT a.*, e.full_name, e.job_title
             FROM employee_attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE e.pharmacy_id = ? AND a.work_date = ?
             ORDER BY a.id DESC`,
          )
          .all(pharmId, workDate)
      : sqlite
          .prepare(
            `SELECT a.*, e.full_name, e.job_title
             FROM employee_attendance a
             JOIN employees e ON e.id = a.employee_id
             WHERE e.pharmacy_id = ?
             ORDER BY a.work_date DESC, a.id DESC
             LIMIT 100`,
          )
          .all(pharmId);
    return res.json({ attendance: rows });
  });

  app.post('/api/hr/attendance', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const employeeId = Number(req.body?.employeeId);
    const workDate = String(req.body?.workDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const checkIn = String(req.body?.checkIn ?? '').trim();
    const checkOut = String(req.body?.checkOut ?? '').trim();
    const status = String(req.body?.status ?? 'present').trim();
    const notes = String(req.body?.notes ?? '').trim();

    const emp = sqlite.prepare('SELECT id, full_name FROM employees WHERE id = ? AND pharmacy_id = ?').get(employeeId, pharmId) as
      | { id: number; full_name: string }
      | undefined;
    if (!emp) return res.status(404).json({ error: 'الموظف غير موجود' });

    const existing = sqlite
      .prepare('SELECT id FROM employee_attendance WHERE employee_id = ? AND work_date = ?')
      .get(employeeId, workDate) as { id: number } | undefined;

    if (existing) {
      sqlite
        .prepare(
          `UPDATE employee_attendance
           SET check_in = COALESCE(NULLIF(?, ''), check_in),
               check_out = COALESCE(NULLIF(?, ''), check_out),
               status = ?, notes = ?
           WHERE id = ?`,
        )
        .run(checkIn, checkOut, status, notes, existing.id);
      return res.json({ id: existing.id });
    }

    const info = sqlite
      .prepare(
        'INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(employeeId, workDate, checkIn || currentTimestamp().slice(11, 16), checkOut, status, notes);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'attendance',
      entityType: 'employee',
      entityId: employeeId,
      details: `تسجيل حضور/انصراف للموظف ${emp.full_name} بتاريخ ${workDate} (${status})`,
      pharmacyId: pharmId,
    });
    return res.status(201).json({ id: Number(info.lastInsertRowid) });
  });

  // --- Employee Financial Transactions (Salary, Advance, Commission, Bonus, Deduction) ---
  app.get('/api/hr/transactions', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const empId = req.query.employeeId ? Number(req.query.employeeId) : null;
    const rows = empId
      ? sqlite
          .prepare(
            `SELECT t.*, e.full_name, e.job_title
             FROM employee_transactions t
             JOIN employees e ON e.id = t.employee_id
             WHERE e.pharmacy_id = ? AND t.employee_id = ?
             ORDER BY t.id DESC`,
          )
          .all(pharmId, empId)
      : sqlite
          .prepare(
            `SELECT t.*, e.full_name, e.job_title
             FROM employee_transactions t
             JOIN employees e ON e.id = t.employee_id
             WHERE e.pharmacy_id = ?
             ORDER BY t.id DESC
             LIMIT 150`,
          )
          .all(pharmId);
    return res.json({ transactions: rows });
  });

  app.post('/api/hr/transactions', requireAuth, requirePermission('manageHr'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const employeeId = Number(req.body?.employeeId);
    const txType = String(req.body?.txType ?? '').trim();
    const amount = Number(req.body?.amount ?? 0);
    const notes = String(req.body?.notes ?? '').trim();
    const txDate = String(req.body?.txDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const payFromCashBox = Boolean(req.body?.payFromCashBox);
    const reqCashBoxId = req.body?.cashBoxId ? Number(req.body.cashBoxId) : 0;

    if (!['salary', 'advance', 'commission', 'bonus', 'deduction'].includes(txType)) {
      return res.status(400).json({ error: 'نوع الحركة المالية للموظف غير صالح' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'يجب أن يكون المبلغ أكبر من صفر' });
    }

    const emp = sqlite.prepare('SELECT id, full_name FROM employees WHERE id = ? AND pharmacy_id = ?').get(employeeId, pharmId) as
      | { id: number; full_name: string }
      | undefined;
    if (!emp) return res.status(404).json({ error: 'الموظف غير موجود' });

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const info = sqlite
        .prepare(
          `INSERT INTO employee_transactions
            (employee_id, tx_type, amount, notes, tx_date, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(employeeId, txType, Number(amount.toFixed(2)), notes, txDate, user.id, currentTimestamp());
      const txId = Number(info.lastInsertRowid);

      if (payFromCashBox && txType !== 'deduction') {
        const cashBox = (
          reqCashBoxId
            ? sqlite.prepare('SELECT * FROM cash_boxes WHERE id = ? AND pharmacy_id = ?').get(reqCashBoxId, pharmId)
            : sqlite.prepare('SELECT * FROM cash_boxes WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId)
        ) as
          | { id: number; name: string; account_id: number; balance: number }
          | undefined;
        if (!cashBox) {
          sqlite.exec('ROLLBACK');
          return res.status(404).json({ error: 'الصندوق المحدد غير موجود' });
        }
        if (cashBox.balance < amount) {
          sqlite.exec('ROLLBACK');
          return res.status(400).json({ error: `رصيد "${cashBox.name}" (${cashBox.balance}) لا يكفي لصرف المستحق` });
        }
        const salaryAccId = resolvePharmacyAccountId(pharmId, '5030');
        postJournalEntry({
          description: `صرف ${txType} للموظف ${emp.full_name}`,
          referenceType: 'hr_tx',
          referenceId: txId,
          userId: user.id,
          pharmacyId: pharmId,
          entryDate: txDate,
          lines: [
            { accountId: salaryAccId, debit: amount, credit: 0, notes: emp.full_name },
            { accountId: cashBox.account_id, debit: 0, credit: amount, notes: cashBox.name },
          ],
        });
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'employee_tx',
        entityId: txId,
        details: `حركة مالية (${txType}) للموظف ${emp.full_name} بمبلغ ${amount}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ id: txId });
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  });

  // --- Audit Log ---
  app.get('/api/audit-logs', requireAuth, requirePermission('viewAuditLog'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const limit = Math.min(1000, Math.max(20, Number(req.query.limit) || 200));
    const action = String(req.query.action ?? '').trim();
    const entityType = String(req.query.entityType ?? '').trim();
    const userId = req.query.userId ? Number(req.query.userId) : 0;
    const fromDate = String(req.query.from ?? '').trim();
    const toDate = String(req.query.to ?? '').trim();
    const search = String(req.query.search ?? '').trim();
    const sensitiveOnly = req.query.sensitiveOnly === '1' || req.query.sensitiveOnly === 'true';

    const where: string[] = ['pharmacy_id = ?'];
    const params: Array<string | number> = [pharmId];

    if (action) {
      where.push('action = ?');
      params.push(action);
    }
    if (entityType) {
      where.push('entity_type = ?');
      params.push(entityType);
    }
    if (userId > 0) {
      where.push('user_id = ?');
      params.push(userId);
    }
    if (fromDate) {
      where.push('substr(created_at, 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      where.push('substr(created_at, 1, 10) <= ?');
      params.push(toDate);
    }
    if (search) {
      const like = `%${search}%`;
      where.push('(details LIKE ? OR user_name LIKE ? OR action LIKE ? OR entity_type LIKE ?)');
      params.push(like, like, like, like);
    }
    if (sensitiveOnly) {
      where.push(
        `(action IN ('delete','cancel','block_user','import_database','export_database','update_site','sales_return','purchase_return','stocktake','status_change','close_shift')
          OR (entity_type = 'user' AND action IN ('create','update'))
          OR entity_type IN ('site','database'))`,
      );
    }

    const whereSql = `WHERE ${where.join(' AND ')}`;
    const logs = sqlite
      .prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY id DESC LIMIT ?`)
      .all(...params, limit);

    const totalRow = sqlite
      .prepare(`SELECT COUNT(*) AS cnt FROM audit_logs ${whereSql}`)
      .get(...params) as { cnt: number };

    const sensitiveWhere = `${whereSql} AND (action IN ('delete','cancel','block_user','import_database','export_database','update_site','sales_return','purchase_return','stocktake','status_change','close_shift') OR (entity_type = 'user' AND action IN ('create','update')) OR entity_type IN ('site','database'))`;
    const sensitiveRow = sqlite
      .prepare(`SELECT COUNT(*) AS cnt FROM audit_logs ${sensitiveWhere}`)
      .get(...params) as { cnt: number };

    const actors = sqlite
      .prepare('SELECT DISTINCT user_id, user_name FROM audit_logs WHERE pharmacy_id = ? AND user_id IS NOT NULL ORDER BY user_name ASC')
      .all(pharmId) as Array<{ user_id: number; user_name: string }>;

    return res.json({
      logs,
      totalCount: Number(totalRow?.cnt || 0),
      sensitiveCount: Number(sensitiveRow?.cnt || 0),
      actors,
    });
  });

  // --- Comprehensive ERP Reports & Analytics ---
  app.get('/api/reports', requireAuth, requirePermission('viewReports'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const fromDate = String(req.query.from ?? '').trim();
    const toDate = String(req.query.to ?? '').trim();
    const reqCurrency = String(req.query.currency ?? '').trim();
    const site = getSiteSettings(pharmId);
    const targetCode = reqCurrency || (site.autoConvertCurrencies ? site.defaultDisplayCurrency : site.currencyCode);
    const displayCurr = resolveSiteCurrency(site, targetCode);
    const rate = displayCurr.rateToBase;
    const autoConverted =
      Boolean(reqCurrency && displayCurr.code !== site.currencyCode) ||
      (site.autoConvertCurrencies && displayCurr.code !== site.currencyCode);

    const scaleBase = (val: number) => (rate === 1 ? Number(val.toFixed(2)) : Number((val * rate).toFixed(2)));

    const conditions: string[] = ['s.pharmacy_id = ?'];
    const params: Array<string | number> = [pharmId];
    if (fromDate) {
      conditions.push('substr(s.date, 1, 10) >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push('substr(s.date, 1, 10) <= ?');
      params.push(toDate);
    }
    const whereSql = `WHERE ${conditions.join(' AND ')}`;
    const soldRows = sqlite
      .prepare(`SELECT s.* FROM sold s ${whereSql} ORDER BY s.date DESC, s.id DESC`)
      .all(...params) as Array<{
      id: number;
      name: string;
      contact: string;
      discount: string;
      item: string;
      amount: string;
      currency_code?: string;
      currency_symbol?: string;
      exchange_rate?: number;
      base_amount?: number | null;
      payment_method?: string;
      paid_amount?: number;
      remaining_amount?: number;
      customer_id?: number | null;
      prescription_id?: number | null;
      shift_id?: number | null;
      warehouse_id?: number;
      status?: string;
      userId: number;
      date: string;
    }>;

    const getItemsStmt = sqlite.prepare(
      `SELECT medicineId AS id, name, price, discount_pct AS discountPct, unit,
              sale_unit AS saleUnit, unit_factor AS unitFactor, company, barcode, batchNumber, qty
       FROM sold_items WHERE soldId = ?`,
    );
    const sales = soldRows.map((row) => {
      const invRate = Number(row.exchange_rate) || 1;
      const invAmt = Number(row.amount) || 0;
      const baseAmt =
        row.base_amount !== null && row.base_amount !== undefined
          ? Number(row.base_amount)
          : Number((invAmt / invRate).toFixed(2));
      const convertedAmt = scaleBase(baseAmt);
      return {
        id: row.id,
        name: row.name,
        contact: row.contact,
        discount: row.discount,
        item: row.item,
        amount: row.amount,
        currencyCode: row.currency_code || site.currencyCode,
        currencySymbol: row.currency_symbol || site.currencySymbol,
        exchangeRate: invRate,
        baseAmount: baseAmt,
        convertedAmount: convertedAmt,
        convertedCurrencyCode: displayCurr.code,
        convertedCurrencySymbol: displayCurr.symbol,
        paymentMethod: row.payment_method || 'cash',
        paidAmount: Number(row.paid_amount ?? row.amount ?? 0),
        remainingAmount: Number(row.remaining_amount ?? 0),
        customerId: row.customer_id ?? null,
        prescriptionId: row.prescription_id ?? null,
        shiftId: row.shift_id ?? null,
        warehouseId: row.warehouse_id ?? 1,
        status: row.status || 'completed',
        userId: row.userId,
        date: row.date,
        adminName: getAdminName(row.userId),
        itemsDetail: getItemsStmt.all(row.id) as unknown as BillItem[],
      };
    });

    const completedSales = sales.filter((s) => s.status !== 'cancelled');
    const totalBaseRevenue = completedSales.reduce((sum, s) => sum + (Number(s.baseAmount) || 0), 0);
    const totalRevenue = scaleBase(totalBaseRevenue);

    // Sales returns in range (stored in base currency)
    const retConds: string[] = ['sr.pharmacy_id = ?'];
    const retParams: Array<string | number> = [pharmId];
    if (fromDate) {
      retConds.push('substr(sr.created_at, 1, 10) >= ?');
      retParams.push(fromDate);
    }
    if (toDate) {
      retConds.push('substr(sr.created_at, 1, 10) <= ?');
      retParams.push(toDate);
    }
    const retWhere = `WHERE ${retConds.join(' AND ')}`;
    const salesReturns = sqlite
      .prepare(
        `SELECT sr.*, u.name AS user_name
         FROM sales_returns sr LEFT JOIN users u ON u.id = sr.user_id
         ${retWhere}
         ORDER BY sr.id DESC`,
      )
      .all(...retParams) as Array<Record<string, unknown>>;
    const totalBaseSalesReturns = salesReturns.reduce((s, r) => s + (Number(r.refund_amount) || 0), 0);
    const totalSalesReturns = scaleBase(totalBaseSalesReturns);

    // Purchases in range (stored in base currency)
    const poConds: string[] = ["po.status = 'received'", 'po.pharmacy_id = ?'];
    const poParams: Array<string | number> = [pharmId];
    if (fromDate) {
      poConds.push('substr(po.created_at, 1, 10) >= ?');
      poParams.push(fromDate);
    }
    if (toDate) {
      poConds.push('substr(po.created_at, 1, 10) <= ?');
      poParams.push(toDate);
    }
    const purchasesRaw = sqlite
      .prepare(
        `SELECT po.*, COALESCE(u.name, '') AS created_by_name
         FROM purchase_orders po
         LEFT JOIN users u ON u.id = po.created_by
         WHERE ${poConds.join(' AND ')}
         ORDER BY po.id DESC`,
      )
      .all(...poParams) as Array<Record<string, unknown>>;
    const totalBasePurchases = purchasesRaw.reduce((s, p) => s + (Number(p.total_amount) || 0), 0);
    const totalPurchases = scaleBase(totalBasePurchases);
    const purchases = purchasesRaw.map((p) => ({
      ...p,
      shipping_cost: scaleBase(Number(p.shipping_cost) || 0),
      total_amount: scaleBase(Number(p.total_amount) || 0),
      paid_amount: scaleBase(Number(p.paid_amount) || 0),
    }));

    // COGS & Gross Profit Estimate for completed sales in period (base currency -> display currency)
    const cogsRow = sqlite
      .prepare(
        `SELECT COALESCE(SUM(si.qty * si.unit_factor * COALESCE(NULLIF(b.purchase_price, 0), i.purchase_price, 0)), 0) AS totalCogs
         FROM sold_items si
         JOIN sold s ON s.id = si.soldId
         JOIN inventeries i ON i.id = si.medicineId
         LEFT JOIN medicine_batches b ON b.id = si.batch_id
         ${whereSql} AND s.status != 'cancelled'`,
      )
      .get(...params) as { totalCogs: number };
    const totalBaseCogs = Number(cogsRow?.totalCogs || 0);
    const totalCogs = scaleBase(totalBaseCogs);
    const netRevenue = Number((totalRevenue - totalSalesReturns).toFixed(2));
    const grossProfit = Number((netRevenue - totalCogs).toFixed(2));

    // Employee Performance (normalized to base amount then scaled)
    const empJoinConds: string[] = ['s.userId = u.id', 's.pharmacy_id = u.pharmacy_id'];
    const empParams: Array<string | number> = [];
    if (fromDate) {
      empJoinConds.push('substr(s.date, 1, 10) >= ?');
      empParams.push(fromDate);
    }
    if (toDate) {
      empJoinConds.push('substr(s.date, 1, 10) <= ?');
      empParams.push(toDate);
    }
    empParams.push(pharmId);

    const empRaw = sqlite
      .prepare(
        `SELECT u.id, u.name, u.role,
                COUNT(CASE WHEN s.status != 'cancelled' THEN 1 END) AS invoiceCount,
                COALESCE(SUM(CASE WHEN s.status != 'cancelled' THEN COALESCE(s.base_amount, CAST(s.amount AS REAL) / COALESCE(NULLIF(s.exchange_rate, 0), 1)) ELSE 0 END), 0) AS totalSales
         FROM users u
         LEFT JOIN sold s ON ${empJoinConds.join(' AND ')}
         WHERE u.pharmacy_id = ? AND u.role != 'developer'
         GROUP BY u.id
         ORDER BY totalSales DESC`,
      )
      .all(...empParams) as Array<{ id: number; name: string; role: string; invoiceCount: number; totalSales: number }>;
    const employeePerformance = empRaw.map((ep) => ({
      ...ep,
      totalSales: scaleBase(Number(ep.totalSales) || 0),
    }));

    // Inventory Valuation by Category (Sell & Cost)
    const invCatRaw = sqlite
      .prepare(
        `SELECT c.id, c.name, c.pic,
                COUNT(i.id) AS count,
                COALESCE(SUM(i.quantity), 0) AS totalUnits,
                COALESCE(SUM(CAST(i.price AS REAL) * i.quantity), 0) AS totalValue,
                COALESCE(SUM(i.purchase_price * i.quantity), 0) AS totalCostValue
         FROM categories c
         LEFT JOIN inventeries i ON i.catId = c.id AND i.pharmacy_id = ?
         WHERE c.pharmacy_id = ?
         GROUP BY c.id
         ORDER BY c.id ASC`,
      )
      .all(pharmId, pharmId) as Array<{
      id: number;
      name: string;
      pic: string;
      count: number;
      totalUnits: number;
      totalValue: number;
      totalCostValue: number;
    }>;
    const inventoryByCategory = invCatRaw.map((c) => ({
      ...c,
      totalValue: scaleBase(Number(c.totalValue) || 0),
      totalCostValue: scaleBase(Number(c.totalCostValue) || 0),
    }));

    // Stagnant Items (no sales in last 30 days)
    const stagnantItems = sqlite
      .prepare(
        `SELECT i.id, i.name, i.quantity, i.price, i.purchase_price, i.expiryDate,
                COALESCE(c.name, 'غير مصنف') AS categoryName
         FROM inventeries i
         LEFT JOIN categories c ON c.id = i.catId
         WHERE i.pharmacy_id = ? AND i.quantity > 0
           AND NOT EXISTS (
             SELECT 1 FROM sold_items si
             JOIN sold s ON s.id = si.soldId
             WHERE si.medicineId = i.id AND s.pharmacy_id = ? AND s.status = 'completed'
               AND substr(s.date, 1, 10) >= date('now', '-30 days')
           )
         ORDER BY i.quantity DESC`,
      )
      .all(pharmId, pharmId);

    const totals = sqlite
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM inventeries WHERE pharmacy_id = ?) AS totalMedicines,
          (SELECT COUNT(*) FROM categories WHERE pharmacy_id = ?) AS totalCategories,
          (SELECT COUNT(*) FROM supplier WHERE pharmacy_id = ?) AS totalSuppliers,
          (SELECT COUNT(*) FROM users WHERE pharmacy_id = ? AND role != 'developer') AS totalUsers,
          (SELECT COUNT(*) FROM customers WHERE pharmacy_id = ?) AS totalCustomers,
          (SELECT COUNT(*) FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id WHERE i.pharmacy_id = ? AND b.qty_remaining > 0 AND b.status = 'active') AS activeBatches,
          (SELECT COALESCE(SUM(balance), 0) FROM customers WHERE pharmacy_id = ?) AS totalReceivables,
          (SELECT COALESCE(SUM(balance), 0) FROM supplier WHERE pharmacy_id = ?) AS totalPayables`,
      )
      .get(pharmId, pharmId, pharmId, pharmId, pharmId, pharmId, pharmId, pharmId) as Record<string, number>;

    return res.json({
      displayCurrency: {
        ...displayCurr,
        autoConverted,
      },
      sales,
      salesReturns,
      purchases,
      employeePerformance,
      inventoryByCategory,
      stagnantItems,
      alerts: computeAlerts(pharmId),
      summary: {
        totalInvoices: completedSales.length,
        totalRevenue,
        totalSalesReturns,
        netRevenue,
        totalPurchases,
        totalCogs,
        grossProfit,
        ...totals,
        totalReceivables: scaleBase(Number(totals.totalReceivables) || 0),
        totalPayables: scaleBase(Number(totals.totalPayables) || 0),
      },
    });
  });

  app.delete('/api/reports/:id', requireAuth, requirePermission('deleteReports'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const info = sqlite.prepare('DELETE FROM sold WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    if (info.changes === 0) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'invoice',
      entityId: id,
      details: `حذف الفاتورة #${id} من السجل`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true });
  });
}
