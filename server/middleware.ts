import type { Request, Response, NextFunction } from 'express';
import {
  sqlite,
  sessions,
  blockedSessions,
  revokeUserSessions,
  daysUntilExpiry,
  rowToUser,
  checkPharmacyAccessStatus,
  generateInternalEan13,
  normalizeScannerInput,
} from './db.ts';
import type {
  InventoryRecord,
  PermissionKey,
  SessionData,
  UserRecord,
} from './db.ts';

export { normalizeScannerInput };

export const COOKIE_NAME = 'mms_sid';
const EXPIRING_SOON_DAYS = 30;

export type AuthedRequest = Request & {
  auth: { sid: string; session: SessionData; user: UserRecord };
};

export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = decodeURIComponent(part.slice(idx + 1).trim());
    result[key] = val;
  }
  return result;
}

export function getRawSid(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookies = parseCookies(req.headers.cookie);
  return cookies[COOKIE_NAME];
}

export function getSession(req: Request): { sid: string; session: SessionData } | null {
  const sid = getRawSid(req);
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  return { sid, session };
}

export function sanitizeUser(u: UserRecord) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    permissions: u.permissions,
    pic: u.pic,
    number: u.number,
    pharmacy_id: u.pharmacy_id || 1,
    date: u.date,
  };
}

export function getPharmacyId(req: Request): number {
  const authed = (req as Partial<AuthedRequest>).auth;
  if (!authed || !authed.user) return 1;
  const user = authed.user;
  if (user.role === 'developer') {
    const override = req.headers['x-pharmacy-id'] || req.query.pharmacyId;
    if (override && Number(override) > 0) {
      return Number(override);
    }
  }
  return user.pharmacy_id || 1;
}

export function findUserById(id: number): UserRecord | null {
  const row = sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const rawSid = getRawSid(req);
  if (rawSid && blockedSessions.has(rawSid)) {
    const reason = blockedSessions.get(rawSid)!;
    blockedSessions.delete(rawSid);
    return res.status(401).json({
      error: reason,
      accountBlocked: true,
      licenseExpired: reason.includes('انتهى ترخيص'),
    });
  }
  const found = getSession(req);
  if (!found) {
    return res.status(401).json({ error: 'غير مصرح، يرجى تسجيل الدخول' });
  }
  const user = findUserById(found.session.userId);
  if (!user) {
    sessions.delete(found.sid);
    return res.status(401).json({ error: 'انتهت صلاحية الجلسة' });
  }
  if (!user.isActive) {
    const reason = 'تم حظر هذا الحساب وإيقافه من قبل مدير النظام';
    revokeUserSessions(user.id, reason);
    blockedSessions.delete(found.sid);
    return res.status(401).json({ error: reason, accountBlocked: true });
  }
  if (user.role !== 'developer') {
    const access = checkPharmacyAccessStatus(user.pharmacy_id || 1);
    if (!access.allowed) {
      const reason = access.reason || 'تم إيقاف اشتراك الصيدلية من قبل إدارة المنصة';
      revokeUserSessions(user.id, reason);
      blockedSessions.delete(found.sid);
      return res.status(401).json({
        error: reason,
        accountBlocked: true,
        licenseExpired: access.licenseExpired,
        licenseExpiresAt: access.licenseExpiresAt,
      });
    }
  }
  (req as AuthedRequest).auth = {
    sid: found.sid,
    session: found.session,
    user,
  };
  next();
}

export function requirePermission(perm: PermissionKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (!auth) {
      return res.status(401).json({ error: 'غير مصرح، يرجى تسجيل الدخول' });
    }
    if (!auth.user.isActive) {
      return res.status(403).json({ error: 'حسابك موقوف من قبل الإدارة' });
    }
    if (!auth.user.permissions[perm]) {
      return res.status(403).json({
        error: 'ليس لديك الصلاحية الكافية لتنفيذ هذا الإجراء',
      });
    }
    next();
  };
}

export function generateBarcode(seed?: number): string {
  return generateInternalEan13(seed);
}

export function computeAlerts(pharmacyId = 1) {
  const allMeds = sqlite
    .prepare('SELECT * FROM inventeries WHERE pharmacy_id = ? ORDER BY id ASC')
    .all(pharmacyId) as unknown as InventoryRecord[];
  const lowStock: Array<{ id: number; name: string; quantity: number; minStock: number }> = [];
  const outOfStock: Array<{ id: number; name: string; quantity: number; minStock: number }> = [];
  const expired: Array<{ id: number; name: string; expiryDate: string; batchNumber: string; batchId?: number }> = [];
  const expiringSoon: Array<{
    id: number;
    name: string;
    expiryDate: string;
    batchNumber: string;
    daysLeft: number;
    qtyRemaining?: number;
  }> = [];

  for (const med of allMeds) {
    if (med.quantity <= 0) {
      outOfStock.push({ id: med.id, name: med.name, quantity: med.quantity, minStock: med.minStock });
    } else if (med.quantity <= med.minStock) {
      lowStock.push({ id: med.id, name: med.name, quantity: med.quantity, minStock: med.minStock });
    }
  }

  // Batch-level expiry tracking
  const batches = sqlite
    .prepare(
      `SELECT b.id AS batchId, b.medicine_id, i.name, b.expiry_date, b.batch_number, b.qty_remaining, b.status
       FROM medicine_batches b
       JOIN inventeries i ON i.id = b.medicine_id
       WHERE i.pharmacy_id = ? AND b.qty_remaining > 0 AND b.status IN ('active', 'expired')
       ORDER BY b.expiry_date ASC`,
    )
    .all(pharmacyId) as Array<{
    batchId: number;
    medicine_id: number;
    name: string;
    expiry_date: string;
    batch_number: string;
    qty_remaining: number;
    status: string;
  }>;

  for (const b of batches) {
    const days = daysUntilExpiry(b.expiry_date);
    if (days !== null) {
      if (days < 0 || b.status === 'expired') {
        expired.push({
          id: b.medicine_id,
          batchId: b.batchId,
          name: b.name,
          expiryDate: b.expiry_date,
          batchNumber: b.batch_number,
        });
      } else if (days <= EXPIRING_SOON_DAYS) {
        expiringSoon.push({
          id: b.medicine_id,
          name: b.name,
          expiryDate: b.expiry_date,
          batchNumber: b.batch_number,
          daysLeft: days,
          qtyRemaining: b.qty_remaining,
        });
      }
    }
  }

  return { lowStock, outOfStock, expired, expiringSoon };
}

