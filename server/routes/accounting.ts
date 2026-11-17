import type { Express, Request, Response } from 'express';
import { sqlite, currentTimestamp, postJournalEntry, resolvePharmacyAccountId, logAudit } from '../db.ts';
import { requireAuth, requirePermission, getPharmacyId, type AuthedRequest } from '../middleware.ts';

export function registerAccountingRoutes(app: Express): void {
  // --- Chart of Accounts & Cash Boxes ---
  app.get('/api/accounting/accounts', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const accounts = sqlite.prepare('SELECT * FROM accounts WHERE pharmacy_id = ? ORDER BY code ASC').all(pharmId);
    const cashBoxes = sqlite
      .prepare(
        `SELECT cb.*, a.code AS account_code, a.name AS account_name
         FROM cash_boxes cb
         JOIN accounts a ON a.id = cb.account_id
         WHERE cb.pharmacy_id = ?
         ORDER BY cb.id ASC`,
      )
      .all(pharmId);
    return res.json({ accounts, cashBoxes });
  });

  app.post('/api/accounting/accounts', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const code = String(req.body?.code ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const accountType = String(req.body?.accountType ?? 'expense').trim();
    if (!code || !name) return res.status(400).json({ error: 'رقم الحساب واسمه مطلوبان' });
    if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(accountType)) {
      return res.status(400).json({ error: 'نوع الحساب غير صالح' });
    }
    const storedCode = pharmId > 1 && !code.endsWith(`-${pharmId}`) ? `${code}-${pharmId}` : code;
    const clash = sqlite.prepare('SELECT id FROM accounts WHERE code = ?').get(storedCode);
    if (clash) return res.status(409).json({ error: 'رقم الحساب موجود مسبقاً في دليل الحسابات' });

    const info = sqlite
      .prepare('INSERT INTO accounts (code, name, account_type, balance, is_system, pharmacy_id) VALUES (?, ?, ?, 0, 0, ?)')
      .run(storedCode, name, accountType, pharmId);
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'account',
      entityId: id,
      details: `إضافة حساب محاسبي: ${storedCode} - ${name}`,
      pharmacyId: pharmId,
    });
    const account = sqlite.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
    return res.status(201).json({ account });
  });

  // --- Journal Entries (Auto & Manual Double-Entry) ---
  app.get('/api/accounting/journals', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();
    const conds: string[] = ['je.pharmacy_id = ?'];
    const params: Array<string | number> = [pharmId];
    if (from) {
      conds.push('je.entry_date >= ?');
      params.push(from);
    }
    if (to) {
      conds.push('je.entry_date <= ?');
      params.push(to);
    }
    const whereSql = `WHERE ${conds.join(' AND ')}`;
    const entries = sqlite
      .prepare(
        `SELECT je.*, COALESCE(u.name, 'النظام') AS user_name
         FROM journal_entries je
         LEFT JOIN users u ON u.id = je.user_id
         ${whereSql}
         ORDER BY je.id DESC
         LIMIT 150`,
      )
      .all(...params) as Array<Record<string, unknown>>;

    const getLines = sqlite.prepare(
      `SELECT jl.*, a.code AS account_code, a.name AS account_name, a.account_type
       FROM journal_lines jl
       JOIN accounts a ON a.id = jl.account_id
       WHERE jl.journal_id = ?
       ORDER BY jl.id ASC`,
    );

    return res.json({
      journals: entries.map((e) => ({ ...e, lines: getLines.all(Number(e.id)) })),
    });
  });

  app.post('/api/accounting/journals', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const description = String(req.body?.description ?? '').trim();
    const entryDate = String(req.body?.entryDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];

    if (!description || rawLines.length < 2) {
      return res.status(400).json({ error: 'يرجى إدخال وصف القيد وسطرين محاسبيين على الأقل (مدين ودائن)' });
    }

    const lines = rawLines.map((l: Record<string, unknown>) => ({
      accountId: Number(l.accountId),
      debit: Math.max(0, Number(l.debit) || 0),
      credit: Math.max(0, Number(l.credit) || 0),
      notes: String(l.notes ?? '').trim(),
    }));

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const journalId = postJournalEntry({
        description,
        referenceType: 'manual',
        userId: user.id,
        pharmacyId: pharmId,
        entryDate,
        lines,
      });
      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'journal_entry',
        entityId: journalId,
        details: `قيد يومية يدوي #${journalId}: ${description}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
      return res.status(201).json({ journalId });
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      return res.status(400).json({ error: err instanceof Error ? err.message : 'فشل تسجيل القيد المحاسبي' });
    }
  });

  // --- Vouchers (قبض / صرف / مصروفات / إيرادات / رأس مال) ---
  app.get('/api/accounting/vouchers', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const vouchers = sqlite
      .prepare(
        `SELECT v.*, cb.name AS cash_box_name, COALESCE(a.name, '') AS account_name, COALESCE(u.name, '') AS user_name
         FROM vouchers v
         LEFT JOIN cash_boxes cb ON cb.id = v.cash_box_id
         LEFT JOIN accounts a ON a.id = v.account_id
         LEFT JOIN users u ON u.id = v.user_id
         WHERE v.pharmacy_id = ?
         ORDER BY v.id DESC`,
      )
      .all(pharmId);
    return res.json({ vouchers });
  });

  app.post('/api/accounting/vouchers', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const voucherType = String(req.body?.voucherType ?? '').trim();
    const defaultBox = sqlite.prepare('SELECT id FROM cash_boxes WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId) as { id: number } | undefined;
    const cashBoxId = Number(req.body?.cashBoxId) || defaultBox?.id || 1;
    const amount = Number(req.body?.amount ?? 0);
    const description = String(req.body?.description ?? '').trim();
    const voucherDate = String(req.body?.voucherDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const counterpartyId = req.body?.counterpartyId ? Number(req.body.counterpartyId) : null;
    const targetAccountId = req.body?.accountId ? Number(req.body.accountId) : null;

    if (!['receipt', 'payment', 'expense', 'income', 'capital'].includes(voucherType)) {
      return res.status(400).json({ error: 'نوع السند غير صالح' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'يجب أن يكون مبلغ السند أكبر من صفر' });
    }

    const cashBox = sqlite.prepare('SELECT * FROM cash_boxes WHERE id = ? AND pharmacy_id = ?').get(cashBoxId, pharmId) as
      | { id: number; name: string; account_id: number; balance: number }
      | undefined;
    if (!cashBox) return res.status(404).json({ error: 'الصندوق أو الحساب البنكي غير موجود' });

    if ((voucherType === 'payment' || voucherType === 'expense') && cashBox.balance < amount) {
      return res.status(400).json({ error: `رصيد "${cashBox.name}" (${cashBox.balance}) لا يكفي لصرف مبلغ ${amount}` });
    }

    let counterpartyType = '';
    let counterpartyName = String(req.body?.counterpartyName ?? '').trim();
    let ledgerAccountId = targetAccountId || resolvePharmacyAccountId(pharmId, '5020');
    let journalDesc = description;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (voucherType === 'receipt') {
        counterpartyType = counterpartyId ? 'customer' : '';
        ledgerAccountId = resolvePharmacyAccountId(pharmId, '1040');
        if (counterpartyId) {
          const cust = sqlite.prepare('SELECT id, name FROM customers WHERE id = ? AND pharmacy_id = ?').get(counterpartyId, pharmId) as
            | { id: number; name: string }
            | undefined;
          if (!cust) {
            sqlite.exec('ROLLBACK');
            return res.status(404).json({ error: 'العميل غير موجود' });
          }
          counterpartyName = cust.name;
          sqlite.prepare('UPDATE customers SET balance = ROUND(balance - ?, 2) WHERE id = ?').run(amount, cust.id);
        }
        journalDesc = description || `سند قبض من ${counterpartyName || 'عميل'}`;
      } else if (voucherType === 'payment') {
        counterpartyType = counterpartyId ? 'supplier' : '';
        ledgerAccountId = resolvePharmacyAccountId(pharmId, '2010');
        if (counterpartyId) {
          const sup = sqlite.prepare('SELECT id, name FROM supplier WHERE id = ? AND pharmacy_id = ?').get(counterpartyId, pharmId) as
            | { id: number; name: string }
            | undefined;
          if (!sup) {
            sqlite.exec('ROLLBACK');
            return res.status(404).json({ error: 'المورد غير موجود' });
          }
          counterpartyName = sup.name;
          sqlite.prepare('UPDATE supplier SET balance = ROUND(balance - ?, 2) WHERE id = ?').run(amount, sup.id);
        }
        journalDesc = description || `سند صرف إلى ${counterpartyName || 'مورد'}`;
      } else if (voucherType === 'expense') {
        ledgerAccountId = targetAccountId || resolvePharmacyAccountId(pharmId, '5020');
        journalDesc = description || 'سند مصروفات تشغيلية';
      } else if (voucherType === 'income') {
        ledgerAccountId = targetAccountId || resolvePharmacyAccountId(pharmId, '4020');
        journalDesc = description || 'سند إيرادات أخرى';
      } else if (voucherType === 'capital') {
        ledgerAccountId = resolvePharmacyAccountId(pharmId, '3010');
        journalDesc = description || 'إيداع / زيادة رأس المال';
      }

      const info = sqlite
        .prepare(
          `INSERT INTO vouchers
            (voucher_type, cash_box_id, counterparty_type, counterparty_id, counterparty_name, account_id, amount, description, voucher_date, user_id, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          voucherType,
          cashBoxId,
          counterpartyType,
          counterpartyId,
          counterpartyName,
          ledgerAccountId,
          Number(amount.toFixed(2)),
          journalDesc,
          voucherDate,
          user.id,
          pharmId,
          currentTimestamp(),
        );
      const voucherId = Number(info.lastInsertRowid);

      const isInflow = voucherType === 'receipt' || voucherType === 'income' || voucherType === 'capital';
      postJournalEntry({
        description: `${journalDesc} (سند #${voucherId})`,
        referenceType: 'voucher',
        referenceId: voucherId,
        userId: user.id,
        pharmacyId: pharmId,
        entryDate: voucherDate,
        lines: isInflow
          ? [
              { accountId: cashBox.account_id, debit: amount, credit: 0, notes: cashBox.name },
              { accountId: ledgerAccountId, debit: 0, credit: amount, notes: counterpartyName || journalDesc },
            ]
          : [
              { accountId: ledgerAccountId, debit: amount, credit: 0, notes: counterpartyName || journalDesc },
              { accountId: cashBox.account_id, debit: 0, credit: amount, notes: cashBox.name },
            ],
      });

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'voucher',
        entityId: voucherId,
        details: `${journalDesc} بمبلغ ${amount}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');

      const voucher = sqlite.prepare('SELECT * FROM vouchers WHERE id = ?').get(voucherId);
      return res.status(201).json({ voucher });
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }
  });

  // --- Financial Statements: Trial Balance, P&L (Income Statement), Balance Sheet, Account Statement ---
  app.get('/api/accounting/statements', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const from = String(req.query.from ?? '').trim();
    const to = String(req.query.to ?? '').trim();

    const dateConds: string[] = [];
    const params: Array<string | number> = [];
    if (from) {
      dateConds.push('je.entry_date >= ?');
      params.push(from);
    }
    if (to) {
      dateConds.push('je.entry_date <= ?');
      params.push(to);
    }
    const joinCond = dateConds.length > 0 ? `AND ${dateConds.join(' AND ')}` : '';
    params.push(pharmId);

    const trialRows = sqlite
      .prepare(
        `SELECT a.id, a.code, a.name, a.account_type, a.balance AS current_balance,
                COALESCE(SUM(jl.debit), 0) AS total_debit,
                COALESCE(SUM(jl.credit), 0) AS total_credit
         FROM accounts a
         LEFT JOIN journal_lines jl ON jl.account_id = a.id
         LEFT JOIN journal_entries je ON je.id = jl.journal_id ${joinCond}
         WHERE a.pharmacy_id = ?
         GROUP BY a.id
         ORDER BY a.code ASC`,
      )
      .all(...params) as Array<{
      id: number;
      code: string;
      name: string;
      account_type: string;
      current_balance: number;
      total_debit: number;
      total_credit: number;
    }>;

    // Compute balance as of `to` date by subtracting any post-`to` journal movements from running account balance
    const postToDeltaMap = new Map<number, { debit: number; credit: number }>();
    if (to) {
      const postToRows = sqlite
        .prepare(
          `SELECT jl.account_id,
                  COALESCE(SUM(jl.debit), 0) AS post_debit,
                  COALESCE(SUM(jl.credit), 0) AS post_credit
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.journal_id
           WHERE je.pharmacy_id = ? AND je.entry_date > ?
           GROUP BY jl.account_id`,
        )
        .all(pharmId, to) as Array<{ account_id: number; post_debit: number; post_credit: number }>;
      for (const r of postToRows) {
        postToDeltaMap.set(Number(r.account_id), { debit: Number(r.post_debit), credit: Number(r.post_credit) });
      }
    }

    const withAsOf = trialRows.map((r) => {
      const post = postToDeltaMap.get(r.id) ?? { debit: 0, credit: 0 };
      const postNet =
        r.account_type === 'asset' || r.account_type === 'expense'
          ? post.debit - post.credit
          : post.credit - post.debit;
      const asOfBalance = Number((r.current_balance - postNet).toFixed(2));
      return {
        ...r,
        current_balance: asOfBalance,
      };
    });

    const revenues = withAsOf
      .filter((r) => r.account_type === 'revenue')
      .map((r) => ({ ...r, net: Number((r.total_credit - r.total_debit).toFixed(2)) }));
    const expenses = withAsOf
      .filter((r) => r.account_type === 'expense')
      .map((r) => ({ ...r, net: Number((r.total_debit - r.total_credit).toFixed(2)) }));

    const totalRevenue = Number(revenues.reduce((s, r) => s + r.net, 0).toFixed(2));
    const totalExpense = Number(expenses.reduce((s, r) => s + r.net, 0).toFixed(2));
    const netProfit = Number((totalRevenue - totalExpense).toFixed(2));

    // Cumulative retained earnings as of `to` date keeps Balance Sheet mathematically balanced even when `from` excludes earlier periods
    const cumulativeRetainedEarnings = Number(
      (
        withAsOf.filter((r) => r.account_type === 'revenue').reduce((s, r) => s + r.current_balance, 0) -
        withAsOf.filter((r) => r.account_type === 'expense').reduce((s, r) => s + r.current_balance, 0)
      ).toFixed(2),
    );

    const assets = withAsOf.filter((r) => r.account_type === 'asset');
    const liabilities = withAsOf.filter((r) => r.account_type === 'liability');
    const equity = withAsOf.filter((r) => r.account_type === 'equity');

    const totalAssets = Number(assets.reduce((s, r) => s + r.current_balance, 0).toFixed(2));
    const totalLiabilities = Number(liabilities.reduce((s, r) => s + r.current_balance, 0).toFixed(2));
    const totalEquity = Number((equity.reduce((s, r) => s + r.current_balance, 0) + cumulativeRetainedEarnings).toFixed(2));

    const trialTotals = {
      debit: Number(withAsOf.reduce((s, r) => s + r.total_debit, 0).toFixed(2)),
      credit: Number(withAsOf.reduce((s, r) => s + r.total_credit, 0).toFixed(2)),
    };

    const cashBoxes = sqlite.prepare('SELECT * FROM cash_boxes WHERE pharmacy_id = ? ORDER BY id ASC').all(pharmId);

    return res.json({
      trialBalance: withAsOf,
      trialTotals,
      incomeStatement: { revenues, expenses, totalRevenue, totalExpense, netProfit },
      balanceSheet: {
        assets,
        liabilities,
        equity,
        retainedEarnings: cumulativeRetainedEarnings,
        totalAssets,
        totalLiabilities,
        totalEquity,
      },
      cashBoxes,
    });
  });

  app.get(
    '/api/accounting/accounts/:id/statement',
    requireAuth,
    requirePermission('manageAccounting'),
    (req: Request, res: Response) => {
      const pharmId = getPharmacyId(req);
      const id = Number(req.params.id);
      const account = sqlite.prepare('SELECT * FROM accounts WHERE id = ? AND pharmacy_id = ?').get(id, pharmId);
      if (!account) return res.status(404).json({ error: 'الحساب غير موجود' });

      const movements = sqlite
        .prepare(
          `SELECT jl.*, je.entry_date, je.description, je.reference_type, je.reference_id
           FROM journal_lines jl
           JOIN journal_entries je ON je.id = jl.journal_id
           WHERE jl.account_id = ? AND je.pharmacy_id = ?
           ORDER BY je.entry_date DESC, jl.id DESC`,
        )
        .all(id, pharmId);
      return res.json({ account, movements });
    },
  );
}
