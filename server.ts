import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { Request, Response } from 'express';
import {
  sqlite,
  sessions,
  blockedSessions,
  revokeUserSessions,
  getSiteSettings,
  currentTimestamp,
  hashPassword,
  verifyPassword,
  rowToUser,
  normalizeRole,
  normalizePermissions,
  logAudit,
  logPlatformAudit,
  findUsersForLogin,
  generateUniqueUsername,
  provisionNewPharmacyTenant,
  computeLicenseStatus,
  checkPharmacyAccessStatus,
  deletePharmacyTenant,
} from './server/db.ts';
import {
  COOKIE_NAME,
  getRawSid,
  getSession,
  sanitizeUser,
  findUserById,
  requireAuth,
  requirePermission,
  computeAlerts,
  getPharmacyId,
  type AuthedRequest,
} from './server/middleware.ts';
import { registerPharmacyRoutes } from './server/routes/pharmacy.ts';
import { registerPosRoutes } from './server/routes/pos.ts';
import { registerPurchasingRoutes } from './server/routes/purchasing.ts';
import { registerClinicalRoutes } from './server/routes/clinical.ts';
import { registerAccountingRoutes } from './server/routes/accounting.ts';
import { registerHrAndReportsRoutes } from './server/routes/hrAndReports.ts';
import { registerBackupRoutes, buildBackupPayload, restoreTenantScopedTables } from './server/routes/backup.ts';
import { registerEnterpriseRoutes } from './server/routes/enterprise.ts';
import { registerHardwareAndBarcodeRoutes } from './server/routes/hardwareAndBarcodes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // --- Auth Routes ---
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const identifier = String(
      req.body?.identifier ?? req.body?.email ?? req.body?.username ?? '',
    ).trim();
    const password = String(req.body?.password ?? '');
    if (!identifier || !password) {
      return res.status(400).json({
        error: 'يرجى إدخال البريد الإلكتروني أو اسم المستخدم أو رقم المستخدم مع كلمة المرور',
      });
    }

    const candidates = findUsersForLogin(identifier);
    const user = candidates.find((candidate) => verifyPassword(password, candidate.passwordHash)) ?? null;

    if (!user) {
      logPlatformAudit({
        actorId: 0,
        actorName: identifier,
        action: 'failed_login',
        targetType: 'auth',
        targetId: null,
        details: `محاولة تسجيل دخول فاشلة للمعرف: ${identifier}`,
      });
      return res.status(401).json({
        error: 'خطأ في بيانات الدخول (البريد الإلكتروني أو اسم المستخدم أو رقم المستخدم أو كلمة المرور)! حاول مرة أخرى.',
      });
    }
    if (!user.isActive) {
      return res.status(403).json({
        error: 'تم إيقاف/منع هذا الحساب من الدخول بواسطة مدير النظام. يرجى مراجعة الإدارة.',
      });
    }

    if (user.role !== 'developer') {
      const access = checkPharmacyAccessStatus(user.pharmacy_id || 1);
      if (!access.allowed) {
        logPlatformAudit({
          actorId: user.id,
          actorName: user.name,
          action: access.licenseExpired ? 'expired_license_login_blocked' : 'suspended_pharmacy_login_blocked',
          targetType: 'pharmacy',
          targetId: user.pharmacy_id || 1,
          details: `منع دخول المستخدم (@${user.username}) - ${access.reason}`,
        });
        return res.status(403).json({
          error: access.reason || 'تم إيقاف حساب الصيدلية من قبل إدارة النظام',
          accountBlocked: true,
          licenseExpired: access.licenseExpired,
          licenseExpiresAt: access.licenseExpiresAt,
        });
      }
    }

    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { userId: user.id, bill: [] });
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie(COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: isHttps ? 'none' : 'lax',
      secure: isHttps,
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    const loginTime = currentTimestamp();
    if (user.role === 'developer') {
      logPlatformAudit({
        actorId: user.id,
        actorName: user.name,
        action: 'platform_login',
        targetType: 'platform',
        targetId: user.id,
        details: `دخول مالك ومطور المنصة (@${user.username})`,
      });
    } else {
      sqlite.prepare('UPDATE pharmacies SET last_login_at = ? WHERE id = ?').run(loginTime, user.pharmacy_id || 1);
    }
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'login',
      entityType: 'user',
      entityId: user.id,
      details: `تسجيل دخول ناجح (${user.role}) عبر (${identifier}) لصيدلية #${user.pharmacy_id || 1}`,
    });
    return res.json({
      token: sid,
      user: sanitizeUser(user),
      site: getSiteSettings(user.pharmacy_id || 1),
      bill: [],
    });
  });

  app.get('/api/auth/session', (req: Request, res: Response) => {
    const rawSid = getRawSid(req);
    if (rawSid && blockedSessions.has(rawSid)) {
      const reason = blockedSessions.get(rawSid)!;
      blockedSessions.delete(rawSid);
      return res.status(401).json({
        authenticated: false,
        user: null,
        accountBlocked: true,
        licenseExpired: reason.includes('انتهى ترخيص'),
        error: reason,
      });
    }
    const found = getSession(req);
    const user = found ? findUserById(found.session.userId) : null;
    if (!found || !user || !user.isActive) {
      return res.status(401).json({ authenticated: false, user: null, error: 'غير مصرح، يرجى تسجيل الدخول' });
    }
    let targetPharmId = user.pharmacy_id || 1;
    if (user.role !== 'developer') {
      const access = checkPharmacyAccessStatus(targetPharmId);
      if (!access.allowed) {
        const reason = access.reason || 'تم إيقاف اشتراك الصيدلية من قبل إدارة المنصة';
        revokeUserSessions(user.id, reason);
        blockedSessions.delete(found.sid);
        return res.status(401).json({
          authenticated: false,
          user: null,
          accountBlocked: true,
          licenseExpired: access.licenseExpired,
          licenseExpiresAt: access.licenseExpiresAt,
          error: reason,
        });
      }
    } else {
      const override = Number(req.headers['x-pharmacy-id'] || req.query.pharmacyId);
      if (Number.isInteger(override) && override > 0) targetPharmId = override;
    }
    return res.json({
      authenticated: true,
      user: sanitizeUser(user),
      site: getSiteSettings(targetPharmId),
    });
  });

  app.post('/api/auth/change-password', requireAuth, (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');
    if (!currentPassword || !newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية وكلمة المرور الجديدة (4 خانات على الأقل)' });
    }
    if (!verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'change_password',
      entityType: 'user',
      entityId: user.id,
      details: `تغيير كلمة مرور الحساب (@${user.username})`,
    });
    return res.json({ ok: true });
  });

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const found = getSession(req);
    if (found) {
      const user = findUserById(found.session.userId);
      if (user) {
        logAudit({
          userId: user.id,
          userName: user.name,
          action: 'logout',
          entityType: 'user',
          entityId: user.id,
          details: 'تسجيل خروج من النظام',
        });
      }
      sessions.delete(found.sid);
    }
    res.clearCookie(COOKIE_NAME, { path: '/' });
    return res.json({ ok: true });
  });

  // --- Bootstrap ---
  app.get('/api/bootstrap', (req: Request, res: Response) => {
    const rawSid = getRawSid(req);
    if (rawSid && blockedSessions.has(rawSid)) {
      const reason = blockedSessions.get(rawSid)!;
      blockedSessions.delete(rawSid);
      return res.json({
        authenticated: false,
        user: null,
        site: getSiteSettings(),
        bill: [],
        blockedReason: reason,
        licenseExpired: reason.includes('انتهى ترخيص'),
      });
    }
    const found = getSession(req);
    const user = found ? findUserById(found.session.userId) : null;
    let targetPharmId = user?.pharmacy_id || 1;
    if (user && user.role === 'developer') {
      const headerScope = Number(req.headers['x-pharmacy-id']);
      if (Number.isInteger(headerScope) && headerScope > 0) {
        targetPharmId = headerScope;
      }
    }

    if (found && user && !user.isActive) {
      revokeUserSessions(user.id, 'تم إيقاف/حظر حسابك من قبل مدير النظام');
      blockedSessions.delete(found.sid);
      return res.json({
        authenticated: false,
        user: null,
        site: getSiteSettings(targetPharmId),
        bill: [],
        blockedReason: 'تم إيقاف/حظر حسابك من قبل مدير النظام',
      });
    }

    if (found && user && user.role !== 'developer') {
      const access = checkPharmacyAccessStatus(targetPharmId);
      if (!access.allowed) {
        const reason = access.reason || 'تم إيقاف اشتراك الصيدلية من قبل إدارة المنصة';
        revokeUserSessions(user.id, reason);
        blockedSessions.delete(found.sid);
        return res.json({
          authenticated: false,
          user: null,
          site: getSiteSettings(targetPharmId),
          bill: [],
          blockedReason: reason,
          licenseExpired: access.licenseExpired,
          licenseExpiresAt: access.licenseExpiresAt,
        });
      }
    }

    return res.json({
      authenticated: Boolean(user && user.isActive),
      user: user && user.isActive ? sanitizeUser(user) : null,
      site: getSiteSettings(targetPharmId),
      bill: found && user && user.isActive ? found.session.bill : [],
    });
  });

  // --- Alerts ---
  app.get('/api/alerts', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    return res.json(computeAlerts(pharmId));
  });

  // --- Users Management & 7 Roles & Granular Permissions & Allow/Block ---
  app.get('/api/users', requireAuth, requirePermission('manageUsers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const rows =
      user.role === 'developer' && req.query.all === 'true'
        ? (sqlite.prepare('SELECT * FROM users ORDER BY id ASC').all() as Array<Record<string, unknown>>)
        : (sqlite
            .prepare('SELECT * FROM users WHERE pharmacy_id = ? ORDER BY id ASC')
            .all(pharmId) as Array<Record<string, unknown>>);
    return res.json({ users: rows.map((r) => sanitizeUser(rowToUser(r))) });
  });

  app.post('/api/users', requireAuth, requirePermission('manageUsers'), (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const targetPharmacyId =
      actor.role === 'developer' && req.body?.pharmacyId
        ? Number(req.body.pharmacyId)
        : getPharmacyId(req);
    const email = String(req.body?.email ?? '').trim();
    const rawUsername = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '').trim();
    const name = String(req.body?.name ?? '').trim();
    const number = String(req.body?.number ?? '').trim();
    const pic = String(req.body?.pic ?? '').trim() || 'png.png';
    const role = normalizeRole(String(req.body?.role ?? 'pharmacist'));
    if (role === 'developer' && actor.role !== 'developer') {
      return res.status(403).json({ error: 'لا يمكن إنشاء حساب مطور منصة من داخل صيدلية' });
    }
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;
    const permissions = normalizePermissions(role, req.body?.permissions);

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة' });
    }
    const existing = sqlite.prepare('SELECT id FROM users WHERE lower(email) = lower(?)').get(email);
    if (existing) {
      return res.status(409).json({ error: 'البريد الإلكتروني مسجل مسبقاً' });
    }

    let username = rawUsername.replace(/\s+/g, '_');
    if (username) {
      const existingUsername = sqlite
        .prepare("SELECT id FROM users WHERE username != '' AND lower(username) = lower(?)")
        .get(username);
      if (existingUsername) {
        return res.status(409).json({ error: 'اسم المستخدم مسجل مسبقاً، يرجى اختيار اسم آخر' });
      }
    } else {
      username = generateUniqueUsername(email.split('@')[0] || name);
    }

    const date = currentTimestamp();
    const info = sqlite
      .prepare(
        'INSERT INTO users (email, username, password_hash, name, role, is_active, permissions, pic, number, pharmacy_id, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        email,
        username,
        hashPassword(password),
        name,
        role,
        isActive ? 1 : 0,
        JSON.stringify(permissions),
        pic,
        number,
        targetPharmacyId,
        date,
      );
    const newId = Number(info.lastInsertRowid);

    // Auto-create linked HR profile
    const roleTitles: Record<string, string> = {
      developer: 'مطور النظام',
      admin: 'المدير العام',
      pharmacy_owner: 'مالك الصيدلية',
      pharmacy_manager: 'مدير الصيدلية',
      pharmacist: 'صيدلاني مرخص',
      cashier: 'كاشير نقطة البيع',
      storekeeper: 'أمين المستودع',
      accountant: 'محاسب مالي',
      purchasing_officer: 'مسؤول المشتريات',
    };
    sqlite
      .prepare(
        `INSERT OR IGNORE INTO employees (user_id, full_name, job_title, specialty, phone, base_salary, commission_rate, hire_date, is_active, pharmacy_id)
         VALUES (?, ?, ?, '', ?, 4000, 0, ?, ?, ?)`,
      )
      .run(newId, name, roleTitles[role] || 'موظف', number, date.slice(0, 10), isActive ? 1 : 0, targetPharmacyId);

    logAudit({
      userId: actor.id,
      userName: actor.name,
      action: 'create',
      entityType: 'user',
      entityId: newId,
      details: `إنشاء حساب مستخدم: ${name} (@${username} / #${newId} - ${role}) لصيدلية #${targetPharmacyId}`,
    });

    return res.status(201).json({
      user: {
        id: newId,
        email,
        username,
        name,
        role,
        isActive,
        permissions,
        pic,
        number,
        pharmacy_id: targetPharmacyId,
        date,
      },
    });
  });

  app.put('/api/users/:id', requireAuth, requirePermission('manageUsers'), (req: Request, res: Response) => {
    const { user: currentUser } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const target = findUserById(id);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (currentUser.role !== 'developer' && (target.pharmacy_id || 1) !== (currentUser.pharmacy_id || 1)) {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل مستخدم تابع لصيدلية أخرى' });
    }

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : target.name;
    const email = req.body?.email !== undefined ? String(req.body.email).trim() : target.email;
    const username =
      req.body?.username !== undefined
        ? String(req.body.username).trim().replace(/\s+/g, '_') || target.username
        : target.username;
    const number = req.body?.number !== undefined ? String(req.body.number).trim() : target.number;
    const pic =
      req.body?.pic !== undefined && String(req.body.pic).trim() ? String(req.body.pic).trim() : target.pic;

    const role = req.body?.role !== undefined ? normalizeRole(String(req.body.role)) : target.role;
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : target.isActive;
    const permissions =
      req.body?.permissions !== undefined
        ? normalizePermissions(role, req.body.permissions)
        : target.permissions;

    if (id === currentUser.id && !isActive) {
      return res.status(400).json({ error: 'لا يمكنك حظر أو إيقاف حسابك الحالي' });
    }
    if (id === currentUser.id && !permissions.manageUsers) {
      return res.status(400).json({ error: 'لا يمكنك سحب صلاحية إدارة المستخدمين من حسابك الحالي' });
    }

    if (email !== target.email) {
      const clash = sqlite
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?')
        .get(email, id);
      if (clash) return res.status(409).json({ error: 'البريد الإلكتروني مستخدم لحساب آخر' });
    }

    if (username && username.toLowerCase() !== target.username.toLowerCase()) {
      const uClash = sqlite
        .prepare("SELECT id FROM users WHERE username != '' AND lower(username) = lower(?) AND id != ?")
        .get(username, id);
      if (uClash) return res.status(409).json({ error: 'اسم المستخدم مسجل لحساب آخر' });
    }

    const passwordHash =
      req.body?.password !== undefined && String(req.body.password).trim()
        ? hashPassword(String(req.body.password).trim())
        : target.passwordHash;

    sqlite
      .prepare(
        'UPDATE users SET name = ?, email = ?, username = ?, number = ?, role = ?, is_active = ?, permissions = ?, pic = ?, password_hash = ? WHERE id = ?',
      )
      .run(
        name,
        email,
        username,
        number,
        role,
        isActive ? 1 : 0,
        JSON.stringify(permissions),
        pic,
        passwordHash,
        id,
      );

    sqlite
      .prepare('UPDATE employees SET full_name = ?, phone = ?, is_active = ? WHERE user_id = ?')
      .run(name, number, isActive ? 1 : 0, id);

    if (!isActive) {
      revokeUserSessions(id, 'تم إيقاف/حظر حسابك من قبل مدير النظام');
    }

    logAudit({
      userId: currentUser.id,
      userName: currentUser.name,
      action: 'update',
      entityType: 'user',
      entityId: id,
      details: `تعديل حساب وصلاحيات: ${name} (@${username} / #${id} - ${role}) - الحالة: ${isActive ? 'مفعل' : 'محظور'}`,
    });

    return res.json({
      user: {
        id,
        email,
        username,
        name,
        role,
        isActive,
        permissions,
        pic,
        number,
        date: target.date,
      },
    });
  });

  app.patch('/api/users/:id/status', requireAuth, requirePermission('manageUsers'), (req: Request, res: Response) => {
    const { user: currentUser } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const target = findUserById(id);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (currentUser.role !== 'developer' && (target.pharmacy_id || 1) !== (currentUser.pharmacy_id || 1)) {
      return res.status(403).json({ error: 'غير مصرح لك بتعديل حالة مستخدم تابع لصيدلية أخرى' });
    }

    const isActive = Boolean(req.body?.isActive);
    if (id === currentUser.id && !isActive) {
      return res.status(400).json({ error: 'لا يمكنك حظر أو إيقاف حسابك أثناء تسجيل الدخول' });
    }

    sqlite.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    sqlite.prepare('UPDATE employees SET is_active = ? WHERE user_id = ?').run(isActive ? 1 : 0, id);
    if (!isActive) {
      revokeUserSessions(id, 'تم إيقاف/حظر حسابك من قبل مدير النظام');
    }

    logAudit({
      userId: currentUser.id,
      userName: currentUser.name,
      action: isActive ? 'allow_user' : 'block_user',
      entityType: 'user',
      entityId: id,
      details: `${isActive ? 'سماح وتفعيل' : 'منع وحظر'} المستخدم: ${target.name}`,
    });

    const updated = findUserById(id);
    return res.json({ user: updated ? sanitizeUser(updated) : null });
  });

  app.delete('/api/users/:id', requireAuth, requirePermission('manageUsers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    if (id === user.id) {
      return res.status(400).json({ error: 'لا يمكنك حذف حسابك أثناء تسجيل الدخول' });
    }
    const target = findUserById(id);
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (user.role !== 'developer' && (target.pharmacy_id || 1) !== (user.pharmacy_id || 1)) {
      return res.status(403).json({ error: 'غير مصرح لك بحذف مستخدم تابع لصيدلية أخرى' });
    }
    const info = sqlite.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (info.changes === 0) return res.status(404).json({ error: 'المستخدم غير موجود' });
    revokeUserSessions(id);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete',
      entityType: 'user',
      entityId: id,
      details: `حذف المستخدم: ${target?.name || id}`,
    });
    return res.json({ ok: true });
  });

  // --- Profile & Account & Site / Currency Settings ---
  app.put('/api/profile', requireAuth, (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const name = String(req.body?.name ?? '').trim();
    const number = String(req.body?.number ?? '').trim();
    const pic = String(req.body?.pic ?? '').trim() || user.pic;
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });

    sqlite.prepare('UPDATE users SET name = ?, number = ?, pic = ? WHERE id = ?').run(name, number, pic, user.id);
    return res.json({
      user: sanitizeUser({ ...user, name, number, pic }),
    });
  });

  app.put('/api/account', requireAuth, (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const email = String(req.body?.email ?? '').trim() || user.email;
    const username =
      req.body?.username !== undefined
        ? String(req.body.username).trim().replace(/\s+/g, '_') || user.username
        : user.username;
    const currentPassword = String(req.body?.currentPassword ?? '');
    const newPassword = String(req.body?.newPassword ?? '');

    if (currentPassword && !verifyPassword(currentPassword, user.passwordHash)) {
      return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    if (email !== user.email) {
      const clash = sqlite
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?')
        .get(email, user.id);
      if (clash) return res.status(409).json({ error: 'البريد الإلكتروني مستخدم لحساب آخر' });
    }
    if (username && username.toLowerCase() !== user.username.toLowerCase()) {
      const uClash = sqlite
        .prepare("SELECT id FROM users WHERE username != '' AND lower(username) = lower(?) AND id != ?")
        .get(username, user.id);
      if (uClash) return res.status(409).json({ error: 'اسم المستخدم مسجل لحساب آخر' });
    }
    let passwordHash = user.passwordHash;
    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'يرجى إدخال كلمة المرور الحالية لتغيير كلمة المرور' });
      }
      passwordHash = hashPassword(newPassword);
    }

    sqlite
      .prepare('UPDATE users SET email = ?, username = ?, password_hash = ? WHERE id = ?')
      .run(email, username, passwordHash, user.id);
    return res.json({
      user: sanitizeUser({ ...user, email, username, passwordHash }),
    });
  });

  const handleUpdatePharmacySite = (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const currentSite = getSiteSettings(pharmId);
    const title = req.body?.title !== undefined ? String(req.body.title).trim() : currentSite.title;
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : currentSite.name;
    const logo = req.body?.logo !== undefined ? String(req.body.logo).trim() : (currentSite.logo || '');
    const currencyCode =
      req.body?.currencyCode !== undefined
        ? String(req.body.currencyCode).trim().toUpperCase()
        : currentSite.currencyCode;
    const currencySymbol =
      req.body?.currencySymbol !== undefined ? String(req.body.currencySymbol).trim() : currentSite.currencySymbol;
    const currencyName =
      req.body?.currencyName !== undefined ? String(req.body.currencyName).trim() : currentSite.currencyName;
    const currencyDecimals =
      req.body?.currencyDecimals !== undefined
        ? Math.min(4, Math.max(0, Number(req.body.currencyDecimals) || 2))
        : (currentSite.currencyDecimals ?? 2);
    const convertPrices = Boolean(req.body?.convertPrices);
    const exchangeMultiplier = Number(req.body?.exchangeMultiplier ?? 1);

    if (!title || !name) {
      return res.status(400).json({ error: 'عنوان النظام واسم الصيدلية مطلوبان' });
    }
    if (!currencyCode || !currencySymbol || !currencyName) {
      return res.status(400).json({ error: 'اسم العملة ورمزها والاختصار مطلوبون' });
    }
    if (convertPrices && (!Number.isFinite(exchangeMultiplier) || exchangeMultiplier <= 0)) {
      return res.status(400).json({ error: 'معامل تحويل العملة يجب أن يكون رقماً موجباً أكبر من الصفر' });
    }

    const prevRates = new Map<string, number>();
    for (const c of currentSite.additionalCurrencies || []) {
      prevRates.set(c.code.toUpperCase(), Number(c.rateToBase));
    }

    // Sanitize & normalize additional currencies
    const rawAdditional = Array.isArray(req.body?.additionalCurrencies)
      ? (req.body.additionalCurrencies as Array<Record<string, unknown>>)
      : (currentSite.additionalCurrencies || []);
    const seenCodes = new Set<string>([currencyCode]);
    const sanitizedAdditional = rawAdditional
      .map((c) => ({
        code: String(c.code ?? '').trim().toUpperCase(),
        symbol: String(c.symbol ?? c.code ?? '').trim(),
        name: String(c.name ?? c.code ?? '').trim(),
        rateToBase: Number(c.rateToBase),
        enabled: c.enabled !== false,
      }))
      .filter((c) => {
        if (!c.code || !c.symbol || !c.name) return false;
        if (!Number.isFinite(c.rateToBase) || c.rateToBase <= 0) return false;
        if (seenCodes.has(c.code)) return false;
        seenCodes.add(c.code);
        return true;
      })
      .map((c) => ({
        ...c,
        rateToBase:
          convertPrices && exchangeMultiplier !== 1
            ? Number((c.rateToBase / exchangeMultiplier).toFixed(6))
            : Number(c.rateToBase.toFixed(6)),
      }));

    const autoConvertCurrencies =
      req.body?.autoConvertCurrencies !== undefined
        ? Boolean(req.body.autoConvertCurrencies)
        : currentSite.autoConvertCurrencies;

    const reqDefaultDisplay =
      req.body?.defaultDisplayCurrency !== undefined
        ? String(req.body.defaultDisplayCurrency).trim().toUpperCase()
        : currentSite.defaultDisplayCurrency;

    const validDefaultCurrency =
      reqDefaultDisplay &&
      (reqDefaultDisplay === currencyCode ||
        sanitizedAdditional.some((c) => c.enabled && c.code === reqDefaultDisplay))
        ? reqDefaultDisplay
        : currencyCode;

    const reqSalesCurr =
      req.body?.salesCurrencyCode !== undefined
        ? String(req.body.salesCurrencyCode).trim().toUpperCase()
        : (currentSite.salesCurrencyCode || validDefaultCurrency);
    const salesCurrencyCode =
      reqSalesCurr === currencyCode || sanitizedAdditional.some((c) => c.enabled && c.code === reqSalesCurr)
        ? reqSalesCurr
        : validDefaultCurrency;

    const reqPurchasesCurr =
      req.body?.purchasesCurrencyCode !== undefined
        ? String(req.body.purchasesCurrencyCode).trim().toUpperCase()
        : (currentSite.purchasesCurrencyCode || currencyCode);
    const purchasesCurrencyCode =
      reqPurchasesCurr === currencyCode || sanitizedAdditional.some((c) => c.enabled && c.code === reqPurchasesCurr)
        ? reqPurchasesCurr
        : currencyCode;

    const ownerName =
      req.body?.ownerName !== undefined ? String(req.body.ownerName).trim() : (currentSite.ownerName || '');
    const ownerEmail =
      req.body?.ownerEmail !== undefined ? String(req.body.ownerEmail).trim() : (currentSite.ownerEmail || '');
    const phone =
      req.body?.phone !== undefined ? String(req.body.phone).trim() : (currentSite.phone || '');
    const address =
      req.body?.address !== undefined ? String(req.body.address).trim() : (currentSite.address || '');
    const tradeName =
      req.body?.tradeName !== undefined ? String(req.body.tradeName).trim() : (currentSite.tradeName || '');
    const city =
      req.body?.city !== undefined ? String(req.body.city).trim() : (currentSite.city || '');
    const country =
      req.body?.country !== undefined ? String(req.body.country).trim() : (currentSite.country || '');
    const taxNumber =
      req.body?.taxNumber !== undefined ? String(req.body.taxNumber).trim() : (currentSite.taxNumber || '');
    const licenseNumber =
      req.body?.licenseNumber !== undefined
        ? String(req.body.licenseNumber).trim()
        : (currentSite.licenseNumber || '');
    const notes =
      req.body?.notes !== undefined ? String(req.body.notes).trim() : (currentSite.notes || '');

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      if (pharmId > 1) {
        sqlite
          .prepare(
            `UPDATE pharmacies
             SET title = ?, name = ?, logo = ?, currency_code = ?, currency_symbol = ?, currency_name = ?,
                 currency_decimals = ?, additional_currencies = ?, auto_convert_currencies = ?, default_display_currency = ?,
                 sales_currency_code = ?, purchases_currency_code = ?,
                 owner_name = ?, owner_email = ?, phone = ?, address = ?, trade_name = ?, city = ?, country = ?,
                 tax_number = ?, license_number = ?, notes = ?
             WHERE id = ?`,
          )
          .run(
            title,
            name,
            logo,
            currencyCode,
            currencySymbol,
            currencyName,
            currencyDecimals,
            JSON.stringify(sanitizedAdditional),
            autoConvertCurrencies ? 1 : 0,
            validDefaultCurrency,
            salesCurrencyCode,
            purchasesCurrencyCode,
            ownerName,
            ownerEmail,
            phone,
            address,
            tradeName,
            city,
            country,
            taxNumber,
            licenseNumber,
            notes,
            pharmId,
          );
      } else {
        sqlite
          .prepare(
            `UPDATE site
             SET title = ?, name = ?, logo = ?, currency_code = ?, currency_symbol = ?, currency_name = ?,
                 additional_currencies = ?, auto_convert_currencies = ?, default_display_currency = ?
             WHERE id = 1`,
          )
          .run(
            title,
            name,
            logo,
            currencyCode,
            currencySymbol,
            currencyName,
            JSON.stringify(sanitizedAdditional),
            autoConvertCurrencies ? 1 : 0,
            validDefaultCurrency,
          );
        sqlite
          .prepare(
            `UPDATE pharmacies
             SET title = ?, name = ?, logo = ?, currency_code = ?, currency_symbol = ?, currency_name = ?,
                 currency_decimals = ?, additional_currencies = ?, auto_convert_currencies = ?, default_display_currency = ?,
                 sales_currency_code = ?, purchases_currency_code = ?,
                 owner_name = ?, owner_email = ?, phone = ?, address = ?, trade_name = ?, city = ?, country = ?,
                 tax_number = ?, license_number = ?, notes = ?
             WHERE id = 1`,
          )
          .run(
            title,
            name,
            logo,
            currencyCode,
            currencySymbol,
            currencyName,
            currencyDecimals,
            JSON.stringify(sanitizedAdditional),
            autoConvertCurrencies ? 1 : 0,
            validDefaultCurrency,
            salesCurrencyCode,
            purchasesCurrencyCode,
            ownerName,
            ownerEmail,
            phone,
            address,
            tradeName,
            city,
            country,
            taxNumber,
            licenseNumber,
            notes,
          );
      }

      // Log exchange rate changes in currency_rate_history
      const insHist = sqlite.prepare(
        `INSERT INTO currency_rate_history
          (currency_code, currency_symbol, currency_name, old_rate, new_rate, changed_by, changed_by_name, pharmacy_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const now = currentTimestamp();
      for (const c of sanitizedAdditional) {
        const oldR = prevRates.get(c.code);
        if (oldR === undefined || Math.abs(oldR - c.rateToBase) > 0.000001) {
          insHist.run(c.code, c.symbol, c.name, oldR ?? 0, c.rateToBase, user.id, user.name, pharmId, now);
        }
      }

      if (convertPrices && exchangeMultiplier !== 1) {
        const meds = sqlite
          .prepare('SELECT id, price, purchase_price, strip_price, piece_price FROM inventeries WHERE pharmacy_id = ?')
          .all(pharmId) as Array<{
          id: number;
          price: string;
          purchase_price: number;
          strip_price: number;
          piece_price: number;
        }>;
        const updateMedPrice = sqlite.prepare(
          'UPDATE inventeries SET price = ?, purchase_price = ?, strip_price = ?, piece_price = ? WHERE id = ?',
        );
        for (const med of meds) {
          const oldSell = Number(med.price) || 0;
          const nextSell = Number((oldSell * exchangeMultiplier).toFixed(currencyDecimals));
          const nextPurch = Number(((Number(med.purchase_price) || 0) * exchangeMultiplier).toFixed(currencyDecimals));
          const nextStrip = Number(((Number(med.strip_price) || 0) * exchangeMultiplier).toFixed(currencyDecimals));
          const nextPiece = Number(((Number(med.piece_price) || 0) * exchangeMultiplier).toFixed(currencyDecimals));
          updateMedPrice.run(String(nextSell), nextPurch, nextStrip, nextPiece, med.id);
        }

        // Convert batch purchase costs for this pharmacy (historical sold invoices & journal entries are NEVER mutated)
        sqlite
          .prepare(
            `UPDATE medicine_batches
             SET purchase_price = ROUND(purchase_price * ?, ?)
             WHERE medicine_id IN (SELECT id FROM inventeries WHERE pharmacy_id = ?)`,
          )
          .run(exchangeMultiplier, currencyDecimals, pharmId);

        for (const sess of sessions.values()) {
          for (const billItem of sess.bill) {
            billItem.price = Number((billItem.price * exchangeMultiplier).toFixed(currencyDecimals));
          }
        }
      }

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'update_site',
        entityType: 'site',
        entityId: pharmId,
        details: `تحديث إعدادات الصيدلية والعملة لصيدلية #${pharmId}: ${currencyName} (${currencySymbol}) | عملات إضافية: ${sanitizedAdditional.length} | التحويل التلقائي: ${autoConvertCurrencies ? `مفعل (${validDefaultCurrency})` : 'معطل'}${convertPrices ? ` × ${exchangeMultiplier}` : ''}`,
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

    return res.json({
      site: getSiteSettings(pharmId),
      convertedPrices: convertPrices && exchangeMultiplier !== 1,
    });
  };

  app.put('/api/site', requireAuth, requirePermission('manageSiteSettings'), handleUpdatePharmacySite);

  // Pharmacy Settings, Branding & Currencies REST API
  app.get('/api/pharmacy/settings', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    return res.json({ settings: getSiteSettings(pharmId) });
  });

  app.put('/api/pharmacy/settings', requireAuth, requirePermission('manageSiteSettings'), handleUpdatePharmacySite);

  app.get('/api/pharmacy/branding', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const s = getSiteSettings(pharmId);
    return res.json({
      name: s.name,
      tradeName: s.tradeName || s.name,
      title: s.title,
      logo: s.logo || '',
      ownerName: s.ownerName || '',
      ownerEmail: s.ownerEmail || '',
      phone: s.phone || '',
      address: s.address || '',
      city: s.city || '',
      country: s.country || '',
      taxNumber: s.taxNumber || '',
      licenseNumber: s.licenseNumber || '',
      notes: s.notes || '',
    });
  });

  app.post('/api/pharmacy/settings/logo', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const logo = String(req.body?.logo ?? '').trim();
    if (!logo) {
      return res.status(400).json({ error: 'بيانات الشعار مطلوبة' });
    }
    if (logo.startsWith('data:') && !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(logo)) {
      return res.status(400).json({ error: 'نوع ملف الشعار غير مدعوم (PNG, JPG, JPEG, WebP فقط)' });
    }
    if (logo.length > 3_500_000) {
      return res.status(400).json({ error: 'حجم صورة الشعار يتجاوز الحد المسموح (2 ميغابايت)' });
    }
    sqlite.prepare('UPDATE pharmacies SET logo = ? WHERE id = ?').run(logo, pharmId);
    if (pharmId === 1) {
      sqlite.prepare('UPDATE site SET logo = ? WHERE id = 1').run(logo);
    }
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update_logo',
      entityType: 'site',
      entityId: pharmId,
      details: `تحديث شعار الصيدلية الرئيسي لصيدلية #${pharmId}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true, site: getSiteSettings(pharmId) });
  });

  app.delete('/api/pharmacy/settings/logo', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    sqlite.prepare("UPDATE pharmacies SET logo = '' WHERE id = ?").run(pharmId);
    if (pharmId === 1) {
      sqlite.prepare("UPDATE site SET logo = '' WHERE id = 1").run();
    }
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'delete_logo',
      entityType: 'site',
      entityId: pharmId,
      details: `حذف شعار الصيدلية والعودة إلى الشعار الافتراضي لصيدلية #${pharmId}`,
      pharmacyId: pharmId,
    });
    return res.json({ ok: true, site: getSiteSettings(pharmId) });
  });

  app.get('/api/pharmacy/currencies', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const s = getSiteSettings(pharmId);
    const rateHistory = sqlite
      .prepare('SELECT * FROM currency_rate_history WHERE pharmacy_id = ? ORDER BY id DESC LIMIT 50')
      .all(pharmId);
    return res.json({
      baseCurrency: {
        code: s.currencyCode,
        symbol: s.currencySymbol,
        name: s.currencyName,
        decimals: s.currencyDecimals ?? 2,
      },
      additionalCurrencies: s.additionalCurrencies || [],
      autoConvertCurrencies: s.autoConvertCurrencies,
      defaultDisplayCurrency: s.defaultDisplayCurrency,
      salesCurrencyCode: s.salesCurrencyCode || s.defaultDisplayCurrency,
      purchasesCurrencyCode: s.purchasesCurrencyCode || s.currencyCode,
      rateHistory,
    });
  });

  // --- Platform Super Admin / Multi-Tenant Management API ---
  const requirePlatformAdmin = (req: Request, res: Response, next: express.NextFunction) => {
    const auth = (req as AuthedRequest).auth;
    if (!auth || !auth.user || auth.user.role !== 'developer') {
      return res.status(403).json({ error: 'صلاحية محظورة: هذه الواجهة مخصصة لمالك ومطور منصة إتقان سوفت فقط' });
    }
    next();
  };

  app.get(['/api/platform/dashboard', '/api/developer/dashboard'], requireAuth, requirePlatformAdmin, (_req: Request, res: Response) => {
    const countOf = (sql: string, ...args: Array<string | number>) =>
      Number((sqlite.prepare(sql).get(...args) as { cnt: number } | undefined)?.cnt ?? 0);
    const sumOf = (sql: string, ...args: Array<string | number>) =>
      Number((sqlite.prepare(sql).get(...args) as { total: number } | undefined)?.total ?? 0);

    const totalPharmacies = countOf('SELECT COUNT(*) AS cnt FROM pharmacies');
    const activePharmacies = countOf('SELECT COUNT(*) AS cnt FROM pharmacies WHERE is_active = 1');
    const suspendedPharmacies = countOf('SELECT COUNT(*) AS cnt FROM pharmacies WHERE is_active = 0');
    const totalUsers = countOf("SELECT COUNT(*) AS cnt FROM users WHERE role != 'developer'");
    const totalMedicines = countOf('SELECT COUNT(*) AS cnt FROM inventeries');
    const totalSales = countOf("SELECT COUNT(*) AS cnt FROM sold WHERE status = 'completed'");
    const totalRevenue = sumOf("SELECT SUM(CAST(amount AS REAL)) AS total FROM sold WHERE status = 'completed'");
    const totalLogins = countOf("SELECT COUNT(*) AS cnt FROM audit_logs WHERE action = 'login'");
    const totalBackups = countOf('SELECT COUNT(*) AS cnt FROM backup_snapshots');

    const recentPharmacies = sqlite
      .prepare('SELECT id, name, code, logo, currency_symbol, owner_name, owner_username, owner_email, is_active, last_login_at, created_at FROM pharmacies ORDER BY id DESC LIMIT 5')
      .all();

    return res.json({
      metrics: {
        totalPharmacies,
        activePharmacies,
        suspendedPharmacies,
        totalUsers,
        totalMedicines,
        totalSales,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalLogins,
        totalBackups,
      },
      recentPharmacies,
      serverStatus: {
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryRssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        platform: 'itQAN Soft Cloud Engine',
        dbMode: 'Multi-Tenant Isolated SQLite (pharmacy_id + WAL)',
      },
    });
  });

  const serializeTenantRow = (r: Record<string, unknown>) => {
    const pId = Number(r.id);
    const userCount = Number(
      (sqlite.prepare("SELECT COUNT(*) AS cnt FROM users WHERE pharmacy_id = ? AND role != 'developer'").get(pId) as { cnt: number })?.cnt ?? 0,
    );
    const medicineCount = Number(
      (sqlite.prepare('SELECT COUNT(*) AS cnt FROM inventeries WHERE pharmacy_id = ?').get(pId) as { cnt: number })?.cnt ?? 0,
    );
    const salesCount = Number(
      (sqlite.prepare("SELECT COUNT(*) AS cnt FROM sold WHERE pharmacy_id = ? AND status = 'completed'").get(pId) as { cnt: number })?.cnt ?? 0,
    );
    const revenue = Number(
      (sqlite.prepare("SELECT SUM(CAST(amount AS REAL)) AS total FROM sold WHERE pharmacy_id = ? AND status = 'completed'").get(pId) as { total: number })?.total ?? 0,
    );

    const lic = computeLicenseStatus(r.license_expires_at as string | undefined);

    return {
      id: pId,
      name: String(r.name || ''),
      tradeName: String(r.trade_name || ''),
      code: String(r.code || `PHARM-${pId}`),
      logo: String(r.logo || ''),
      currencyCode: String(r.currency_code || 'SAR'),
      currencySymbol: String(r.currency_symbol || 'ر.س'),
      currencyName: String(r.currency_name || 'ريال سعودي'),
      currencyDecimals: Number(r.currency_decimals ?? 2),
      ownerName: String(r.owner_name || ''),
      ownerUsername: String(r.owner_username || ''),
      ownerEmail: String(r.owner_email || ''),
      phone: String(r.phone || ''),
      address: String(r.address || ''),
      city: String(r.city || ''),
      country: String(r.country || 'السعودية'),
      taxNumber: String(r.tax_number || ''),
      licenseNumber: String(r.license_number || ''),
      isActive: Number(r.is_active ?? 1) === 1,
      subscriptionStart: String(r.subscription_start || String(r.created_at || '').slice(0, 10)),
      subscriptionMonths: Number(r.subscription_months ?? 12),
      licenseExpiresAt: lic.licenseExpiresAt,
      licenseDaysRemaining: lic.daysRemaining,
      licenseExpiringSoon: lic.expiringSoon,
      licenseExpired: lic.expired,
      lastLoginAt: String(r.last_login_at || ''),
      notes: String(r.notes || ''),
      createdAt: String(r.created_at || ''),
      userCount,
      medicineCount,
      salesCount,
      revenue: Number(revenue.toFixed(2)),
    };
  };

  app.get(['/api/platform/tenants', '/api/developer/pharmacies'], requireAuth, requirePlatformAdmin, (_req: Request, res: Response) => {
    const rows = sqlite.prepare('SELECT * FROM pharmacies ORDER BY id ASC').all() as Array<Record<string, unknown>>;
    return res.json({ pharmacies: rows.map(serializeTenantRow) });
  });

  app.get('/api/platform/tenants/:id', requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const row = sqlite.prepare('SELECT * FROM pharmacies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ error: 'الصيدلية غير موجودة' });
    return res.json({ pharmacy: serializeTenantRow(row) });
  });

  app.put(['/api/platform/tenants/:id', '/api/developer/pharmacies/:id'], requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM pharmacies WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'الصيدلية غير موجودة' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name || '');
    const tradeName = req.body?.tradeName !== undefined ? String(req.body.tradeName).trim() : String(existing.trade_name || '');
    const logo = req.body?.logo !== undefined ? String(req.body.logo).trim() : String(existing.logo || '');
    const currencyCode =
      req.body?.currencyCode !== undefined
        ? String(req.body.currencyCode).trim().toUpperCase() || String(existing.currency_code || 'SAR')
        : String(existing.currency_code || 'SAR');
    const currencySymbol =
      req.body?.currencySymbol !== undefined
        ? String(req.body.currencySymbol).trim() || String(existing.currency_symbol || 'ر.س')
        : String(existing.currency_symbol || 'ر.س');
    const currencyName =
      req.body?.currencyName !== undefined
        ? String(req.body.currencyName).trim() || String(existing.currency_name || 'ريال سعودي')
        : String(existing.currency_name || 'ريال سعودي');
    const currencyDecimals =
      req.body?.currencyDecimals !== undefined
        ? Math.min(4, Math.max(0, Number(req.body.currencyDecimals) || 2))
        : Number(existing.currency_decimals ?? 2);

    const ownerName = req.body?.ownerName !== undefined ? String(req.body.ownerName).trim() : String(existing.owner_name || '');
    const ownerUsername =
      req.body?.ownerUsername !== undefined
        ? String(req.body.ownerUsername).trim().toLowerCase().replace(/\s+/g, '_')
        : String(existing.owner_username || '');
    const ownerEmail =
      req.body?.ownerEmail !== undefined
        ? String(req.body.ownerEmail).trim().toLowerCase()
        : String(existing.owner_email || '');

    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : String(existing.phone || '');
    const address = req.body?.address !== undefined ? String(req.body.address).trim() : String(existing.address || '');
    const city = req.body?.city !== undefined ? String(req.body.city).trim() : String(existing.city || '');
    const country = req.body?.country !== undefined ? String(req.body.country).trim() : String(existing.country || '');
    const taxNumber = req.body?.taxNumber !== undefined ? String(req.body.taxNumber).trim() : String(existing.tax_number || '');
    const licenseNumber = req.body?.licenseNumber !== undefined ? String(req.body.licenseNumber).trim() : String(existing.license_number || '');
    const subscriptionStart = req.body?.subscriptionStart !== undefined ? String(req.body.subscriptionStart).trim() : String(existing.subscription_start || '');
    const subscriptionMonths = req.body?.subscriptionMonths !== undefined ? Math.max(1, Number(req.body.subscriptionMonths) || 12) : Number(existing.subscription_months ?? 12);

    let licenseExpiresAt = String(existing.license_expires_at || '');
    if (req.body?.licenseExpiresAt !== undefined) {
      const cleanExp = String(req.body.licenseExpiresAt).trim().slice(0, 10);
      if (cleanExp !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(cleanExp)) {
        return res.status(400).json({ error: 'صيغة تاريخ انتهاء الترخيص غير صالحة (YYYY-MM-DD)' });
      }
      licenseExpiresAt = cleanExp;
    }

    const nextIsActive =
      req.body?.isActive !== undefined ? Boolean(req.body.isActive) : Number(existing.is_active ?? 1) === 1;
    if (id === 1 && !nextIsActive) {
      return res.status(400).json({ error: 'لا يمكن إيقاف الصيدلية الرئيسية التأسيسية' });
    }
    const notes = req.body?.notes !== undefined ? String(req.body.notes).trim() : String(existing.notes || '');

    if (!name) return res.status(400).json({ error: 'اسم الصيدلية مطلوب' });

    // Resolve owner user record if any
    let ownerUserId = Number(existing.owner_user_id || 0);
    if (!ownerUserId) {
      const foundOwner = sqlite
        .prepare("SELECT id FROM users WHERE pharmacy_id = ? AND (role = 'pharmacy_owner' OR role = 'admin') ORDER BY id ASC LIMIT 1")
        .get(id) as { id: number } | undefined;
      ownerUserId = foundOwner?.id || 0;
    }

    if (ownerUsername && ownerUserId) {
      const uClash = sqlite
        .prepare("SELECT id FROM users WHERE username != '' AND lower(username) = lower(?) AND id != ?")
        .get(ownerUsername, ownerUserId);
      if (uClash) {
        return res.status(409).json({ error: 'اسم المستخدم لمالك الصيدلية مسجل لحساب آخر' });
      }
    }
    if (ownerEmail && ownerUserId) {
      const eClash = sqlite
        .prepare('SELECT id FROM users WHERE lower(email) = lower(?) AND id != ?')
        .get(ownerEmail, ownerUserId);
      if (eClash) {
        return res.status(409).json({ error: 'البريد الإلكتروني لمالك الصيدلية مسجل لحساب آخر' });
      }
    }

    const baseCurrencyChanged = currencyCode !== String(existing.currency_code || 'SAR');

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite
        .prepare(
          `UPDATE pharmacies
           SET name = ?, trade_name = ?, logo = ?,
               currency_code = ?, currency_symbol = ?, currency_name = ?, currency_decimals = ?,
               default_display_currency = CASE WHEN ? THEN ? ELSE default_display_currency END,
               sales_currency_code = CASE WHEN ? THEN ? ELSE sales_currency_code END,
               purchases_currency_code = CASE WHEN ? THEN ? ELSE purchases_currency_code END,
               owner_name = ?, owner_username = ?, owner_email = ?,
               phone = ?, address = ?, city = ?, country = ?,
               tax_number = ?, license_number = ?,
               subscription_start = ?, subscription_months = ?, license_expires_at = ?,
               is_active = ?, notes = ?
           WHERE id = ?`,
        )
        .run(
          name,
          tradeName,
          logo,
          currencyCode,
          currencySymbol,
          currencyName,
          currencyDecimals,
          baseCurrencyChanged ? 1 : 0,
          currencyCode,
          baseCurrencyChanged ? 1 : 0,
          currencyCode,
          baseCurrencyChanged ? 1 : 0,
          currencyCode,
          ownerName,
          ownerUsername,
          ownerEmail,
          phone,
          address,
          city,
          country,
          taxNumber,
          licenseNumber,
          subscriptionStart,
          subscriptionMonths,
          licenseExpiresAt,
          nextIsActive ? 1 : 0,
          notes,
          id,
        );

      if (id === 1) {
        sqlite
          .prepare(
            `UPDATE site
             SET name = ?, logo = ?, currency_code = ?, currency_symbol = ?, currency_name = ?,
                 default_display_currency = CASE WHEN ? THEN ? ELSE default_display_currency END
             WHERE id = 1`,
          )
          .run(name, logo, currencyCode, currencySymbol, currencyName, baseCurrencyChanged ? 1 : 0, currencyCode);
      }

      if (ownerUserId) {
        sqlite
          .prepare(
            `UPDATE users
             SET name = ?,
                 username = CASE WHEN ? != '' THEN ? ELSE username END,
                 email = CASE WHEN ? != '' THEN ? ELSE email END,
                 number = CASE WHEN ? != '' THEN ? ELSE number END,
                 is_active = CASE WHEN ? > 1 THEN ? ELSE is_active END
             WHERE id = ?`,
          )
          .run(
            ownerName || String(existing.owner_name || ''),
            ownerUsername,
            ownerUsername,
            ownerEmail,
            ownerEmail,
            phone,
            phone,
            id,
            nextIsActive ? 1 : 0,
            ownerUserId,
          );
        sqlite
          .prepare(
            `UPDATE employees
             SET full_name = ?,
                 phone = CASE WHEN ? != '' THEN ? ELSE phone END,
                 is_active = CASE WHEN ? > 1 THEN ? ELSE is_active END
             WHERE user_id = ?`,
          )
          .run(
            ownerName || String(existing.owner_name || ''),
            phone,
            phone,
            id,
            nextIsActive ? 1 : 0,
            ownerUserId,
          );
      }

      if (id > 1 && req.body?.isActive !== undefined) {
        sqlite.prepare('UPDATE users SET is_active = ? WHERE pharmacy_id = ?').run(nextIsActive ? 1 : 0, id);
      }

      sqlite.exec('COMMIT');
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      return res.status(500).json({ error: err instanceof Error ? err.message : 'فشل تحديث بيانات الصيدلية' });
    }

    const updatedLic = computeLicenseStatus(licenseExpiresAt);
    if (!nextIsActive || updatedLic.expired) {
      const reason = !nextIsActive
        ? 'تم إيقاف اشتراك الصيدلية من قبل إدارة المنصة'
        : `انتهى ترخيص استخدام النظام لصيدلية "${name}" بتاريخ ${licenseExpiresAt}. يجب التواصل مع إدارة النظام من أجل تجديد الترخيص والسماح لك باستخدام النظام.`;
      const pharmUsers = sqlite
        .prepare("SELECT id FROM users WHERE pharmacy_id = ? AND role != 'developer'")
        .all(id) as Array<{ id: number }>;
      for (const u of pharmUsers) {
        revokeUserSessions(u.id, reason);
      }
    }

    logPlatformAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'update_pharmacy_tenant',
      targetType: 'pharmacy',
      targetId: id,
      details: `تعديل بيانات وترخيص الصيدلية: ${name} (#${id}) | الانتهاء: ${licenseExpiresAt || 'مفتوح'} | الحالة: ${nextIsActive ? 'نشط' : 'موقوف'}`,
    });

    const updated = sqlite.prepare('SELECT * FROM pharmacies WHERE id = ?').get(id) as Record<string, unknown>;
    return res.json({ ok: true, pharmacy: serializeTenantRow(updated) });
  });

  app.post(['/api/platform/tenants', '/api/developer/pharmacies'], requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const name = String(req.body?.name ?? '').trim();
    const ownerName = String(req.body?.ownerName ?? '').trim();
    const ownerUsername = String(req.body?.ownerUsername ?? '').trim();
    const ownerEmail = String(req.body?.ownerEmail ?? '').trim();
    const ownerPassword = String(req.body?.ownerPassword ?? '').trim();

    if (!name || !ownerName || !ownerUsername || !ownerEmail || !ownerPassword) {
      return res.status(400).json({ error: 'اسم الصيدلية، اسم المالك، اسم المستخدم، البريد الإلكتروني، وكلمة المرور كلها حقول إلزامية' });
    }

    try {
      const result = provisionNewPharmacyTenant({
        name,
        tradeName: req.body?.tradeName ? String(req.body.tradeName).trim() : undefined,
        code: req.body?.code ? String(req.body.code).trim() : undefined,
        logo: req.body?.logo ? String(req.body.logo).trim() : undefined,
        currencyCode: req.body?.currencyCode ? String(req.body.currencyCode).trim() : 'SAR',
        currencySymbol: req.body?.currencySymbol ? String(req.body.currencySymbol).trim() : 'ر.س',
        currencyName: req.body?.currencyName ? String(req.body.currencyName).trim() : 'ريال سعودي',
        currencyDecimals: req.body?.currencyDecimals !== undefined ? Number(req.body.currencyDecimals) : 2,
        ownerName,
        ownerUsername,
        ownerEmail,
        ownerPassword,
        phone: req.body?.phone ? String(req.body.phone).trim() : undefined,
        address: req.body?.address ? String(req.body.address).trim() : undefined,
        city: req.body?.city ? String(req.body.city).trim() : undefined,
        country: req.body?.country ? String(req.body.country).trim() : undefined,
        notes: req.body?.notes ? String(req.body.notes).trim() : undefined,
        taxNumber: req.body?.taxNumber ? String(req.body.taxNumber).trim() : undefined,
        licenseNumber: req.body?.licenseNumber ? String(req.body.licenseNumber).trim() : undefined,
        isActive: req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true,
        subscriptionStart: req.body?.subscriptionStart ? String(req.body.subscriptionStart).trim() : undefined,
        subscriptionMonths: req.body?.subscriptionMonths !== undefined ? Number(req.body.subscriptionMonths) : 12,
        licenseExpiresAt: req.body?.licenseExpiresAt !== undefined ? String(req.body.licenseExpiresAt).trim() : undefined,
      });

      logPlatformAudit({
        actorId: actor.id,
        actorName: actor.name,
        action: 'create_pharmacy_tenant',
        targetType: 'pharmacy',
        targetId: result.pharmacyId,
        details: `إنشاء صيدلية جديدة (${name} - #${result.pharmacyId}) وتخصيص حساب المالك (${ownerName} / @${ownerUsername}) ببيانات مصفّرة ومعزولة تماماً`,
      });

      return res.status(201).json({
        ok: true,
        pharmacy: serializeTenantRow(result.pharmacy),
        owner: sanitizeUser(result.owner),
        defaultCredentials: {
          username: ownerUsername,
          password: ownerPassword,
        },
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'فشل إنشاء الصيدلية' });
    }
  });

  app.delete(['/api/platform/tenants/:id', '/api/developer/pharmacies/:id'], requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    try {
      const deleted = deletePharmacyTenant(id);
      logPlatformAudit({
        actorId: actor.id,
        actorName: actor.name,
        action: 'delete_pharmacy_tenant',
        targetType: 'pharmacy',
        targetId: id,
        details: `حذف حساب الصيدلية نهائياً: ${deleted.deletedName} (${deleted.deletedCode} / #${id}) مع جميع بياناتها المعزولة`,
      });
      return res.json({ ok: true, deletedPharmacyId: id });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر حذف الصيدلية' });
    }
  });

  app.patch(['/api/platform/tenants/:id/status', '/api/developer/pharmacies/:id/status'], requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    if (id === 1) {
      return res.status(400).json({ error: 'لا يمكن إيقاف الصيدلية الرئيسية التأسيسية' });
    }
    const target = sqlite.prepare('SELECT id, name FROM pharmacies WHERE id = ?').get(id) as { id: number; name: string } | undefined;
    if (!target) return res.status(404).json({ error: 'الصيدلية غير موجودة' });

    const isActive = Boolean(req.body?.isActive);
    sqlite.prepare('UPDATE pharmacies SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
    sqlite.prepare('UPDATE users SET is_active = ? WHERE pharmacy_id = ?').run(isActive ? 1 : 0, id);

    if (!isActive) {
      const pharmUsers = sqlite.prepare('SELECT id FROM users WHERE pharmacy_id = ?').all(id) as Array<{ id: number }>;
      for (const u of pharmUsers) {
        revokeUserSessions(u.id, 'تم إيقاف اشتراك الصيدلية من قبل إدارة المنصة');
      }
    }

    logPlatformAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: isActive ? 'activate_pharmacy' : 'suspend_pharmacy',
      targetType: 'pharmacy',
      targetId: id,
      details: `${isActive ? 'تفعيل' : 'إيقاف وتعليق'} الصيدلية: ${target.name} (#${id}) وكافة مستخدميها`,
    });

    return res.json({ ok: true, isActive });
  });

  app.post(['/api/platform/tenants/:id/reset-password', '/api/developer/pharmacies/:id/reset-owner-password'], requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const newPassword = String(req.body?.newPassword ?? '').trim();
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن لا تقل عن 4 خانات' });
    }

    const pharm = sqlite.prepare('SELECT id, name, owner_user_id FROM pharmacies WHERE id = ?').get(id) as
      | { id: number; name: string; owner_user_id?: number }
      | undefined;
    if (!pharm) return res.status(404).json({ error: 'الصيدلية غير موجودة' });

    let ownerUser = pharm.owner_user_id
      ? (sqlite.prepare('SELECT id, username, name FROM users WHERE id = ?').get(pharm.owner_user_id) as { id: number; username: string; name: string } | undefined)
      : undefined;

    if (!ownerUser) {
      ownerUser = sqlite
        .prepare("SELECT id, username, name FROM users WHERE pharmacy_id = ? AND (role = 'pharmacy_owner' OR role = 'admin') ORDER BY id ASC LIMIT 1")
        .get(id) as { id: number; username: string; name: string } | undefined;
    }

    if (!ownerUser) {
      return res.status(404).json({ error: 'لم يتم العثور على حساب المالك المرتبط بهذه الصيدلية' });
    }

    const newHash = hashPassword(newPassword);
    sqlite.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, ownerUser.id);
    revokeUserSessions(ownerUser.id, 'تمت إعادة تعيين كلمة المرور من قبل مطور النظام، يرجى تسجيل الدخول مجدداً');

    logPlatformAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'reset_pharmacy_owner_password',
      targetType: 'user',
      targetId: ownerUser.id,
      details: `إعادة تعيين كلمة مرور مالك الصيدلية (${pharm.name}) للمستخدم @${ownerUser.username}`,
    });

    return res.json({ ok: true, username: ownerUser.username });
  });

  app.post('/api/platform/tenants/:id/backup', requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const pharm = sqlite.prepare('SELECT id, name FROM pharmacies WHERE id = ?').get(id) as { id: number; name: string } | undefined;
    if (!pharm) return res.status(404).json({ error: 'الصيدلية غير موجودة' });

    const payload = buildBackupPayload(actor.name, true, id);
    const payloadJson = JSON.stringify(payload);
    const checksum = crypto.createHash('sha256').update(payloadJson).digest('hex');
    const fileName = `tenant_${id}_backup_${new Date().toISOString().slice(0, 10)}.json`;

    sqlite
      .prepare(
        `INSERT INTO backup_snapshots
          (snapshot_type, file_name, table_count, row_count, checksum_sha256, payload_json, created_by, created_by_name, pharmacy_id, created_at)
         VALUES ('platform_tenant_backup', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(fileName, payload.tableCount, payload.totalRows, checksum, payloadJson, actor.id, actor.name, id, currentTimestamp());

    logPlatformAudit({
      actorId: actor.id,
      actorName: actor.name,
      action: 'backup_pharmacy_tenant',
      targetType: 'pharmacy',
      targetId: id,
      details: `إنشاء نسخة احتياطية معزولة لصيدلية ${pharm.name} (#${id}) - SHA256: ${checksum.slice(0, 12)}...`,
    });

    return res.json({ ok: true, fileName, checksum, backup: payload });
  });

  app.post('/api/platform/tenants/:id/restore', requireAuth, requirePlatformAdmin, (req: Request, res: Response) => {
    const { user: actor } = (req as AuthedRequest).auth;
    const id = Number(req.params.id);
    const pharm = sqlite.prepare('SELECT id, name FROM pharmacies WHERE id = ?').get(id) as { id: number; name: string } | undefined;
    if (!pharm) return res.status(404).json({ error: 'الصيدلية غير موجودة' });

    const backup = req.body?.backup || req.body;
    if (!backup || typeof backup !== 'object' || !backup.tables || typeof backup.tables !== 'object') {
      return res.status(400).json({ error: 'ملف النسخة الاحتياطية غير صالح' });
    }
    if (backup.pharmacyId && Number(backup.pharmacyId) !== id) {
      return res.status(403).json({ error: 'مرفوض: لا يمكن استعادة نسخة تابعة لصيدلية أخرى فوق هذه الصيدلية' });
    }

    sqlite.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
    try {
      const result = restoreTenantScopedTables({
        tablesPayload: backup.tables as Record<string, unknown>,
        targetPharmId: id,
        excludeTables: ['backup_snapshots'],
      });
      sqlite.exec('COMMIT; PRAGMA foreign_keys = ON;');
      logPlatformAudit({
        actorId: actor.id,
        actorName: actor.name,
        action: 'restore_pharmacy_tenant',
        targetType: 'pharmacy',
        targetId: id,
        details: `استعادة نسخة احتياطية لصيدلية ${pharm.name} (#${id}): ${result.restoredTables} جدول، ${result.restoredRows} سجل`,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
      } catch {
        // ignore
      }
      return res.status(500).json({ error: err instanceof Error ? err.message : 'فشل استعادة النسخة' });
    }
  });

  app.get('/api/platform/audit-logs', requireAuth, requirePlatformAdmin, (_req: Request, res: Response) => {
    const logs = sqlite.prepare('SELECT * FROM platform_audit_logs ORDER BY id DESC LIMIT 150').all();
    return res.json({ logs });
  });

  // --- Register Modular ERP Routes ---
  registerPharmacyRoutes(app);
  registerPosRoutes(app);
  registerPurchasingRoutes(app);
  registerClinicalRoutes(app);
  registerAccountingRoutes(app);
  registerHrAndReportsRoutes(app);
  registerBackupRoutes(app);
  registerEnterpriseRoutes(app);
  registerHardwareAndBarcodeRoutes(app);

  // --- Global JSON Error Handler for /api (translates unexpected SQLite / payload errors to clear Arabic reasons) ---
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
    const anyErr = err as { status?: number; type?: string; code?: string; message?: string };
    const rawMsg = String(anyErr?.message || '');
    if (anyErr?.type === 'entity.too.large' || anyErr?.status === 413) {
      return res.status(413).json({
        error: 'حجم البيانات أو الصورة المرفوعة كبير جداً يتجاوز الحد المسموح به للخادم',
      });
    }
    if (anyErr?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({
        error: 'صيغة البيانات المرسلة (JSON) غير صالحة أو تالفة',
      });
    }
    if (/UNIQUE constraint failed/i.test(rawMsg)) {
      return res.status(409).json({
        error: 'تعذر الحفظ: توجد قيمة مكررة مسجلة مسبقاً (مثل رقم الباركود أو اسم المستخدم أو البريد الإلكتروني أو رمز الحساب)',
      });
    }
    if (/FOREIGN KEY constraint failed/i.test(rawMsg)) {
      return res.status(409).json({
        error: 'تعذر تنفيذ العملية لوجود سجلات أو حركات مرتبطة بهذا السجل في قاعدة البيانات',
      });
    }
    if (/NOT NULL constraint failed/i.test(rawMsg)) {
      return res.status(400).json({
        error: 'تعذر الحفظ: هناك حقل إلزامي مفقود أو فارغ في البيانات المدخلة',
      });
    }
    if (anyErr?.status && anyErr.status >= 400 && anyErr.status < 500) {
      return res.status(anyErr.status).json({
        error: rawMsg || 'البيانات المرسلة غير صالحة أو غير مكتملة',
      });
    }
    console.error('[API Error]', err);
    return res.status(500).json({
      error: rawMsg && !/^SQLITE_/i.test(rawMsg) ? rawMsg : 'حدث خطأ داخلي في الخادم أثناء معالجة الطلب، يرجى التحقق من البيانات والمحاولة مرة أخرى',
    });
  });

  // --- Vite dev middleware or production static build ---
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Medical Management System ERP running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
