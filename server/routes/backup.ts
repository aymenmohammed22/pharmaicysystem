import type { Express, Request, Response } from 'express';
import {
  sqlite,
  sessions,
  currentTimestamp,
  getSiteSettings,
  rowToUser,
  logAudit,
} from '../db.ts';
import { requireAuth, requirePermission, sanitizeUser, findUserById, getPharmacyId, type AuthedRequest } from '../middleware.ts';

export const BACKUP_FORMAT = 'limar-pharmacy-erp-backup';
export const BACKUP_VERSION = 2;

// Ordered parent-first so inserts preserve referential integrity cleanly
const BACKUP_TABLE_ORDER = [
  'pharmacies',
  'site',
  'users',
  'categories',
  'warehouses',
  'supplier',
  'customers',
  'doctors',
  'accounts',
  'cash_boxes',
  'inventeries',
  'medicine_batches',
  'product_barcodes',
  'barcode_history',
  'hardware_devices',
  'print_jobs',
  'hardware_audit_logs',
  'prescriptions',
  'prescription_items',
  'pos_shifts',
  'held_bills',
  'sold',
  'sold_items',
  'sales_returns',
  'sales_return_items',
  'purchase_orders',
  'purchase_order_items',
  'purchase_returns',
  'stock_transfers',
  'stock_transfer_items',
  'stock_counts',
  'stock_movements',
  'journal_entries',
  'journal_lines',
  'vouchers',
  'employees',
  'employee_attendance',
  'employee_transactions',
  'drug_interactions',
  'controlled_dispense_logs',
  'insurance_companies',
  'insurance_claims',
  'drug_recalls',
  'promotions',
  'loyalty_transactions',
  'operating_expenses',
  'integration_configs',
  'audit_logs',
];

const CHILD_TABLE_TENANT_FILTER: Record<string, string> = {
  medicine_batches: 'medicine_id IN (SELECT id FROM inventeries WHERE pharmacy_id = ?)',
  prescription_items: 'prescription_id IN (SELECT id FROM prescriptions WHERE pharmacy_id = ?)',
  sold_items: 'soldId IN (SELECT id FROM sold WHERE pharmacy_id = ?)',
  sales_return_items: 'return_id IN (SELECT id FROM sales_returns WHERE pharmacy_id = ?)',
  purchase_order_items: 'po_id IN (SELECT id FROM purchase_orders WHERE pharmacy_id = ?)',
  stock_transfer_items: 'transfer_id IN (SELECT id FROM stock_transfers WHERE pharmacy_id = ?)',
  journal_lines: 'journal_id IN (SELECT id FROM journal_entries WHERE pharmacy_id = ?)',
  employee_attendance: 'employee_id IN (SELECT id FROM employees WHERE pharmacy_id = ?)',
  employee_transactions: 'employee_id IN (SELECT id FROM employees WHERE pharmacy_id = ?)',
  loyalty_transactions: 'customer_id IN (SELECT id FROM customers WHERE pharmacy_id = ?)',
};

export function getAllUserTableNames(excludeTables: string[] = []): string[] {
  const exclude = new Set(excludeTables);
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all() as Array<{ name: string }>;
  const existing = new Set(rows.map((r) => r.name));
  const ordered = BACKUP_TABLE_ORDER.filter((t) => existing.has(t) && !exclude.has(t));
  for (const name of existing) {
    if (!ordered.includes(name) && !exclude.has(name)) ordered.push(name);
  }
  return ordered;
}

function getTableColumns(tableName: string): string[] {
  const rows = sqlite.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

export function buildBackupPayload(userName: string, excludeSnapshots = false, pharmacyId?: number) {
  const isTenantScoped = Boolean(pharmacyId && pharmacyId > 0);
  const targetPharmId = pharmacyId || 1;
  const site = getSiteSettings(targetPharmId);
  const excluded = new Set<string>(excludeSnapshots ? ['backup_snapshots'] : []);
  if (isTenantScoped) excluded.add('platform_audit_logs');
  const tableNames = getAllUserTableNames([...excluded]);
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  const tableCounts: Record<string, number> = {};
  let totalRows = 0;

  for (const table of tableNames) {
    let rows: Array<Record<string, unknown>> = [];
    if (!isTenantScoped) {
      rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
    } else if (table === 'pharmacies') {
      rows = sqlite.prepare('SELECT * FROM pharmacies WHERE id = ?').all(targetPharmId) as Array<Record<string, unknown>>;
    } else if (table === 'site') {
      rows = sqlite.prepare('SELECT * FROM site WHERE id = 1').all() as Array<Record<string, unknown>>;
    } else if (table === 'users') {
      rows = sqlite
        .prepare("SELECT * FROM users WHERE pharmacy_id = ? AND role != 'developer'")
        .all(targetPharmId) as Array<Record<string, unknown>>;
    } else if (CHILD_TABLE_TENANT_FILTER[table]) {
      rows = sqlite
        .prepare(`SELECT * FROM "${table}" WHERE ${CHILD_TABLE_TENANT_FILTER[table]}`)
        .all(targetPharmId) as Array<Record<string, unknown>>;
    } else {
      const cols = new Set(getTableColumns(table));
      if (cols.has('pharmacy_id')) {
        rows = sqlite
          .prepare(`SELECT * FROM "${table}" WHERE pharmacy_id = ?`)
          .all(targetPharmId) as Array<Record<string, unknown>>;
      } else {
        rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Array<Record<string, unknown>>;
      }
    }
    tables[table] = rows;
    tableCounts[table] = rows.length;
    totalRows += rows.length;
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    pharmacyId: isTenantScoped ? targetPharmId : null,
    exportedAt: currentTimestamp(),
    exportedBy: userName,
    siteName: site.name,
    siteTitle: site.title,
    tableCount: tableNames.length,
    totalRows,
    tableCounts,
    tables,
  };
}

export function restoreTenantScopedTables(params: {
  tablesPayload: Record<string, unknown>;
  targetPharmId: number;
  excludeTables?: string[];
}): { restoredTables: number; restoredRows: number } {
  const { tablesPayload, targetPharmId, excludeTables = [] } = params;
  const existingTables = getAllUserTableNames(excludeTables);
  const sharedReadOnlyTables = new Set(['site', 'drug_interactions', 'integration_configs', 'platform_audit_logs']);
  let restoredTables = 0;
  let restoredRows = 0;

  // Delete tenant's existing rows in reverse dependency order
  for (const table of [...existingTables].reverse()) {
    if (sharedReadOnlyTables.has(table) || table === 'pharmacies') continue;
    if (table === 'users') {
      sqlite.prepare("DELETE FROM users WHERE pharmacy_id = ? AND role != 'developer'").run(targetPharmId);
    } else if (CHILD_TABLE_TENANT_FILTER[table]) {
      sqlite.prepare(`DELETE FROM "${table}" WHERE ${CHILD_TABLE_TENANT_FILTER[table]}`).run(targetPharmId);
    } else {
      const cols = new Set(getTableColumns(table));
      if (cols.has('pharmacy_id')) {
        sqlite.prepare(`DELETE FROM "${table}" WHERE pharmacy_id = ?`).run(targetPharmId);
      }
    }
  }

  // Insert restored rows for this tenant
  for (const table of existingTables) {
    if (sharedReadOnlyTables.has(table) || table === 'pharmacies') continue;
    const rawRows = tablesPayload[table];
    if (!Array.isArray(rawRows) || rawRows.length === 0) continue;

    const validCols = getTableColumns(table);
    const validColSet = new Set(validCols);
    const firstRow = rawRows[0];
    if (!firstRow || typeof firstRow !== 'object') continue;

    const insertCols = validCols.filter((c) => c in (firstRow as Record<string, unknown>));
    if (insertCols.length === 0) continue;

    const colList = insertCols.map((c) => `"${c}"`).join(', ');
    const placeholders = insertCols.map(() => '?').join(', ');
    const stmt = sqlite.prepare(`INSERT OR REPLACE INTO "${table}" (${colList}) VALUES (${placeholders})`);

    for (const r of rawRows) {
      if (!r || typeof r !== 'object') continue;
      const rowObj = r as Record<string, unknown>;
      if (table === 'users' && String(rowObj.role || '') === 'developer') continue;
      if (validColSet.has('pharmacy_id') && Number(rowObj.pharmacy_id || targetPharmId) !== targetPharmId) {
        continue;
      }
      const values = insertCols.map((c) => {
        if (!validColSet.has(c)) return null;
        if (c === 'pharmacy_id') return targetPharmId;
        const val = rowObj[c];
        return val === undefined ? null : (val as string | number | null);
      });
      stmt.run(...values);
      restoredRows += 1;
    }
    restoredTables += 1;
  }

  return { restoredTables, restoredRows };
}

export function registerBackupRoutes(app: Express): void {
  // --- Export Complete Database as JSON (Tenant-Scoped) ---
  app.get('/api/database/export', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'export_database',
      entityType: 'database',
      entityId: pharmId,
      details: `تصدير نسخة احتياطية كاملة للصيدلية #${pharmId} بصيغة JSON`,
      pharmacyId: pharmId,
    });

    return res.json(buildBackupPayload(user.name, false, pharmId));
  });

  // --- Import & Restore Complete Database from JSON (Strict Tenant Isolation) ---
  app.post('/api/database/import', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { session, sid, user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const payload = req.body as Record<string, unknown> | undefined;

    if (!payload || typeof payload !== 'object' || !payload.tables || typeof payload.tables !== 'object') {
      return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح أو لا يحتوي على بيانات الجداول (tables)' });
    }

    if (payload.format && payload.format !== BACKUP_FORMAT) {
      return res.status(400).json({ error: 'صيغة الملف غير مدعومة، يرجى اختيار ملف نسخة احتياطية صادر من هذا النظام' });
    }

    const payloadPharmId = payload.pharmacyId ? Number(payload.pharmacyId) : null;
    if (payloadPharmId && payloadPharmId !== pharmId && user.role !== 'developer') {
      return res.status(403).json({
        error: 'غير مصرح باستعادة نسخة احتياطية خاصة بصيدلية أخرى فوق قاعدة بيانات صيدليتك',
      });
    }
    if (!payloadPharmId && user.role !== 'developer' && pharmId > 1) {
      return res.status(403).json({
        error: 'غير مصرح باستعادة نسخة منصة عامة داخل حساب صيدلية فرعية',
      });
    }

    const tablesPayload = payload.tables as Record<string, unknown>;
    const requiredCoreTables = ['users', 'categories', 'inventeries'];
    for (const reqTable of requiredCoreTables) {
      if (!Array.isArray(tablesPayload[reqTable])) {
        return res.status(400).json({ error: `النسخة الاحتياطية تفتقر إلى الجدول الأساسي: ${reqTable}` });
      }
    }

    const userRows = tablesPayload.users as Array<Record<string, unknown>>;
    if (userRows.length === 0) {
      return res.status(400).json({ error: 'جدول المستخدمين (users) فارغ في النسخة الاحتياطية' });
    }

    const isFullPlatformRestore = !payloadPharmId && user.role === 'developer' && !req.headers['x-pharmacy-id'];
    const existingTables = getAllUserTableNames();
    let restoredTables = 0;
    let restoredRows = 0;

    sqlite.exec('PRAGMA foreign_keys = OFF;');
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (isFullPlatformRestore) {
        for (const table of [...existingTables].reverse()) {
          sqlite.exec(`DELETE FROM "${table}"`);
        }
        for (const table of existingTables) {
          const rawRows = tablesPayload[table];
          if (!Array.isArray(rawRows) || rawRows.length === 0) continue;
          const validCols = getTableColumns(table);
          const validColSet = new Set(validCols);
          const firstRow = rawRows[0];
          if (!firstRow || typeof firstRow !== 'object') continue;
          const insertCols = validCols.filter((c) => c in (firstRow as Record<string, unknown>));
          if (insertCols.length === 0) continue;
          const colList = insertCols.map((c) => `"${c}"`).join(', ');
          const placeholders = insertCols.map(() => '?').join(', ');
          const stmt = sqlite.prepare(`INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`);
          for (const r of rawRows) {
            if (!r || typeof r !== 'object') continue;
            const rowObj = r as Record<string, unknown>;
            const values = insertCols.map((c) => {
              if (!validColSet.has(c)) return null;
              const val = rowObj[c];
              return val === undefined ? null : (val as string | number | null);
            });
            stmt.run(...values);
            restoredRows += 1;
          }
          restoredTables += 1;
        }
      } else {
        const resCounts = restoreTenantScopedTables({
          tablesPayload,
          targetPharmId: pharmId,
        });
        restoredTables = resCounts.restoredTables;
        restoredRows = resCounts.restoredRows;
      }

      // Verify foreign key integrity across restored database
      const fkViolations = sqlite.prepare('PRAGMA foreign_key_check').all() as Array<Record<string, unknown>>;
      if (fkViolations.length > 0) {
        throw new Error(`تم اكتشاف تعارض في العلاقات المرجعية (${fkViolations.length} سجل غير مترابط)`);
      }

      const actorInRestored = sqlite
        .prepare('SELECT id, name FROM users WHERE id = ? OR lower(email) = lower(?) LIMIT 1')
        .get(user.id, user.email) as { id: number; name: string } | undefined;

      logAudit({
        userId: actorInRestored?.id ?? user.id,
        userName: actorInRestored?.name ?? user.name,
        action: 'import_database',
        entityType: 'database',
        entityId: pharmId,
        details: `استيراد واستعادة بيانات الصيدلية #${pharmId} (${restoredTables} جدول، ${restoredRows} سجل)`,
        pharmacyId: pharmId,
      });

      sqlite.exec('COMMIT');
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      sqlite.exec('PRAGMA foreign_keys = ON;');
      return res.status(400).json({
        error: err instanceof Error ? `فشل استيراد قاعدة البيانات: ${err.message}` : 'تعذر استيراد قاعدة البيانات',
      });
    }
    sqlite.exec('PRAGMA foreign_keys = ON;');

    for (const [otherSid, otherSession] of Array.from(sessions.entries())) {
      if (otherSid !== sid) {
        const otherU = findUserById(otherSession.userId);
        if (isFullPlatformRestore || !otherU || otherU.pharmacy_id === pharmId) {
          sessions.delete(otherSid);
        }
      }
    }
    session.bill = [];

    let activeRestored = findUserById(user.id);
    if (!activeRestored || activeRestored.email.toLowerCase() !== user.email.toLowerCase()) {
      const byEmail = sqlite
        .prepare('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1')
        .get(user.email) as Record<string, unknown> | undefined;
      if (byEmail) {
        activeRestored = rowToUser(byEmail);
      } else {
        const firstActiveAdmin = sqlite
          .prepare("SELECT * FROM users WHERE pharmacy_id = ? AND is_active = 1 ORDER BY CASE WHEN role IN ('pharmacy_owner','admin') THEN 0 ELSE 1 END, id ASC LIMIT 1")
          .get(pharmId) as Record<string, unknown> | undefined;
        if (firstActiveAdmin) {
          activeRestored = rowToUser(firstActiveAdmin);
        }
      }
    }
    if (activeRestored) {
      session.userId = activeRestored.id;
    }

    return res.json({
      ok: true,
      restoredTables,
      restoredRows,
      site: getSiteSettings(pharmId),
      user: activeRestored ? sanitizeUser(activeRestored) : sanitizeUser(user),
    });
  });
}
