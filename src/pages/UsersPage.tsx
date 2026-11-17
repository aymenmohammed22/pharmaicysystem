import React, { useState } from 'react';
import {
  Users,
  UserPlus,
  Edit3,
  Trash2,
  X,
  Shield,
  Ban,
  CheckCircle2,
  KeyRound,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type { PermissionKey, User, UserPermissions, UserRole } from '../types';
import {
  DEFAULT_PERMISSIONS_BY_ROLE,
  PERMISSION_DEFINITIONS,
  ROLE_LABELS,
  resolvePhotoSrc,
} from '../types';
import { ImagePickerField } from '../components/ImagePickerField';
import { ConfirmModal } from '../components/ConfirmModal';

interface UsersPageProps {
  users: User[];
  currentUser: User;
  onRefreshUsers: () => Promise<void>;
  onCurrentUserUpdated?: (u: User) => void;
}

export const UsersPage: React.FC<UsersPageProps> = ({
  users,
  currentUser,
  onRefreshUsers,
  onCurrentUserUpdated,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<User | null>(null);
  const [confirmBlockUser, setConfirmBlockUser] = useState<User | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('pharmacist');
  const [isActive, setIsActive] = useState(true);
  const [permissions, setPermissions] = useState<UserPermissions>({
    ...DEFAULT_PERMISSIONS_BY_ROLE.pharmacist,
  });
  const [number, setNumber] = useState('');
  const [pic, setPic] = useState('png.png');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const groupedPermissions = PERMISSION_DEFINITIONS.reduce<
    Record<string, typeof PERMISSION_DEFINITIONS>
  >((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const openNew = () => {
    setEditing(null);
    setName('');
    setUsername('');
    setEmail('');
    setPassword('');
    setRole('pharmacist');
    setIsActive(true);
    setPermissions({ ...DEFAULT_PERMISSIONS_BY_ROLE.pharmacist });
    setNumber('');
    setPic('png.png');
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setName(u.name);
    setUsername(u.username || '');
    setEmail(u.email);
    setPassword('');
    setRole(u.role);
    setIsActive(u.isActive);
    setPermissions({ ...DEFAULT_PERMISSIONS_BY_ROLE[u.role], ...u.permissions });
    setNumber(u.number);
    setPic(u.pic || 'png.png');
    setModalOpen(true);
  };

  const handleRoleChange = (nextRole: UserRole) => {
    setRole(nextRole);
    if (!editing) {
      setPermissions({ ...DEFAULT_PERMISSIONS_BY_ROLE[nextRole] });
    }
  };

  const togglePermission = (key: PermissionKey) => {
    setPermissions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setAllPermissions = (val: boolean) => {
    const next = { ...permissions };
    for (const def of PERMISSION_DEFINITIONS) {
      next[def.key] = val;
    }
    setPermissions(next);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const op = editing ? 'تعديل بيانات المستخدم وصلاحياته' : 'إضافة مستخدم جديد';
    if (!name.trim()) {
      validationError(
        'اسم المستخدم الكامل مطلوب ولا يمكن تركه فارغاً',
        op,
        ['لم يتم إدخال الاسم الكامل للموظف أو الصيدلاني في الحقل المخصص.'],
        'أدخل الاسم الكامل ثم أعد المحاولة.',
      );
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      validationError(
        'البريد الإلكتروني غير صالح أو فارغ',
        op,
        ['حقل البريد الإلكتروني مطلوب أو أن صيغته تفتقر إلى @ والنطاق الصحيح.'],
        'أدخل بريداً إلكترونياً صحيحاً مثل user@pharmacy.com.',
      );
      return;
    }
    if (!editing && !password.trim()) {
      validationError(
        'كلمة المرور مطلوبة عند إنشاء حساب مستخدم جديد',
        op,
        ['لم يتم إدخال كلمة المرور الأولية للحساب الجديد.'],
        'أدخل كلمة مرور من 4 أحرف على الأقل ثم اضغط حفظ.',
      );
      return;
    }
    if (password.trim() && password.trim().length < 4) {
      validationError(
        'كلمة المرور قصيرة جداً (يجب أن لا تقل عن 4 أحرف أو أرقام)',
        op,
        ['تم إدخال كلمة مرور أقل من الحد الأدنى المطلوب أمنياً (4 خانات).'],
        'أدخل كلمة مرور مكونة من 4 أحرف على الأقل.',
      );
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        const res = await api.updateUser(editing.id, {
          name: name.trim(),
          username: username.trim() || undefined,
          email: email.trim(),
          role,
          isActive,
          permissions,
          number: number.trim(),
          pic,
          ...(password ? { password } : {}),
        });
        if (editing.id === currentUser.id && onCurrentUserUpdated) {
          onCurrentUserUpdated(res.user);
        }
        setStatusMsg('تم تحديث بيانات المستخدم وصلاحياته بنجاح');
      } else {
        await api.createUser({
          name: name.trim(),
          username: username.trim() || undefined,
          email: email.trim(),
          password,
          role,
          isActive,
          permissions,
          number: number.trim(),
          pic,
        });
        setStatusMsg('تم إضافة المستخدم الجديد وصلاحياته بنجاح');
      }
      await onRefreshUsers();
      setModalOpen(false);
      setTimeout(() => setStatusMsg(''), 3500);
    } catch (err) {
      showErrorPopup(err, op);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleUserStatus = async (target: User, nextActive: boolean) => {
    setBusyAction(true);
    try {
      await api.toggleUserStatus(target.id, nextActive);
      await onRefreshUsers();
      setStatusMsg(
        nextActive
          ? `تم السماح للمستخدم "${target.name}" بالدخول والعمل`
          : `تم منع وحظر المستخدم "${target.name}" وإيقاف جلساته النشطة`,
      );
      setConfirmBlockUser(null);
      setTimeout(() => setStatusMsg(''), 3500);
    } catch (err) {
      showErrorPopup(err, nextActive ? 'تفعيل حساب المستخدم' : 'منع وحظر المستخدم');
      setConfirmBlockUser(null);
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteUser) return;
    setBusyAction(true);
    try {
      await api.deleteUser(confirmDeleteUser.id);
      await onRefreshUsers();
      setStatusMsg(`تم حذف المستخدم "${confirmDeleteUser.name}"`);
      setConfirmDeleteUser(null);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, 'حذف حساب المستخدم');
      setConfirmDeleteUser(null);
    } finally {
      setBusyAction(false);
    }
  };

  const countGranted = (perms: UserPermissions) =>
    PERMISSION_DEFINITIONS.filter((d) => perms?.[d.key]).length;

  return (
    <div className="space-y-4">
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">
              إدارة المستخدمين والصلاحيات (السماح والمنع)
            </h1>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-1.5 rounded bg-[#0B4F9C] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#083D7A]"
          >
            <UserPlus className="h-4 w-4" />
            <span>إضافة مستخدم جديد</span>
          </button>
        </div>

        <div className="space-y-3 p-4">
          {statusMsg && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {statusMsg}
            </div>
          )}

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-right text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5">رقم المستخدم</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الصورة</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الاسم واسم المستخدم</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الدور الوظيفي</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">حالة الدخول</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الصلاحيات الممنوحة</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">البريد والهاتف</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">التحكم والإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => {
                  const granted = countGranted(u.permissions);
                  return (
                    <tr
                      key={u.id}
                      className={u.isActive ? 'hover:bg-sky-50/40' : 'bg-red-50/40 hover:bg-red-50/70'}
                    >
                      <td className="px-3 py-2.5 font-mono text-xs font-bold text-slate-700">#{u.id}</td>
                      <td className="px-3 py-2.5">
                        <img
                          src={resolvePhotoSrc(u.pic, 'png.png')}
                          alt={u.name}
                          className={`h-10 w-10 rounded-full border object-cover ${
                            u.isActive ? 'border-slate-200' : 'border-red-300 opacity-60 grayscale'
                          }`}
                        />
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-800">
                        <div>
                          {u.name}
                          {u.id === currentUser.id && (
                            <span className="mr-2 rounded bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">
                              أنت
                            </span>
                          )}
                        </div>
                        {u.username && (
                          <div className="mt-0.5 font-mono text-[11px] font-semibold text-sky-700" dir="ltr">
                            @{u.username}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ${
                            u.role === 'admin' || u.role === 'pharmacy_manager'
                              ? 'bg-purple-100 text-purple-800'
                              : u.role === 'pharmacist'
                                ? 'bg-sky-100 text-sky-800'
                                : u.role === 'accountant'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : u.role === 'storekeeper'
                                    ? 'bg-indigo-100 text-indigo-800'
                                    : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          <Shield className="h-3 w-3" />
                          {ROLE_LABELS[u.role]}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        {u.isActive ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>مسموح</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                            <Ban className="h-3.5 w-3.5" />
                            <span>ممنوع / محظور</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          <KeyRound className="h-3 w-3 text-[#0B4F9C]" />
                          {granted} / {PERMISSION_DEFINITIONS.length} صلاحية
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <div className="font-mono text-slate-700" dir="ltr">
                          {u.email}
                        </div>
                        <div className="font-mono text-slate-500" dir="ltr">
                          {u.number || '-'}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEdit(u)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>تعديل / الصلاحيات</span>
                          </button>
                          {u.id !== currentUser.id && (
                            <>
                              {u.isActive ? (
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() => setConfirmBlockUser(u)}
                                  className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-amber-700"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  <span>منع</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() => handleToggleUserStatus(u, true)}
                                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  <span>سماح</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteUser(u)}
                                className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                <span>حذف</span>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">
                {editing ? `تعديل المستخدم وصلاحياته — ${editing.name}` : 'إضافة مستخدم جديد وتحديد صلاحياته'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} noValidate className="space-y-4 p-4">

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">الاسم الكامل</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    {`الدور الوظيفي (${Object.keys(ROLE_LABELS).length} أدوار)`}
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={role}
                      onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                      className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      {(Object.keys(ROLE_LABELS) as UserRole[]).map((rk) => (
                        <option key={rk} value={rk}>
                          {ROLE_LABELS[rk]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setPermissions({ ...DEFAULT_PERMISSIONS_BY_ROLE[role] })}
                      title="تطبيق صلاحيات الدور الافتراضية"
                      className="rounded border border-slate-300 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      تطبيق افتراضي
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">البريد الإلكتروني *</label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    اسم المستخدم (للدخول)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={editing ? editing.username : 'يُولد تلقائياً إن تُرك فارغاً'}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                  {editing && (
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      رقم المستخدم للدخول: <span className="font-mono font-bold">#{editing.id}</span>
                    </span>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">رقم الهاتف</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    كلمة المرور {editing ? '(اتركها فارغة للإبقاء)' : '*'}
                  </label>
                  <input
                    type="password"
                    required={!editing}
                    dir="ltr"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    حالة الحساب (السماح أو المنع)
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setIsActive(true)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-xs font-bold ${
                        isActive
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>مسموح بالدخول</span>
                    </button>
                    <button
                      type="button"
                      disabled={editing?.id === currentUser.id}
                      onClick={() => setIsActive(false)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded border px-3 py-2 text-xs font-bold disabled:opacity-50 ${
                        !isActive
                          ? 'border-red-600 bg-red-50 text-red-700'
                          : 'border-slate-300 bg-white text-slate-600'
                      }`}
                    >
                      <Ban className="h-4 w-4" />
                      <span>ممنوع / محظور</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Granular Permissions Matrix */}
              <div className="rounded border border-slate-200 bg-[#F3F6FA] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                    <KeyRound className="h-4 w-4 text-[#0B4F9C]" />
                    <span>تخصيص الصلاحيات ({countGranted(permissions)} / {PERMISSION_DEFINITIONS.length})</span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setAllPermissions(true)}
                      className="rounded border border-emerald-300 bg-white px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50"
                    >
                      تحديد الكل
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllPermissions(false)}
                      className="rounded border border-red-300 bg-white px-2 py-1 font-semibold text-red-700 hover:bg-red-50"
                    >
                      إلغاء الكل
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {Object.entries(groupedPermissions).map(([group, items]) => (
                    <div key={group} className="rounded border border-slate-200 bg-white p-2.5">
                      <div className="mb-1.5 text-xs font-bold text-[#0B4F9C]">{group}</div>
                      <div className="space-y-1.5">
                        {items.map((perm) => (
                          <label
                            key={perm.key}
                            className="flex cursor-pointer items-center gap-2 text-xs text-slate-700"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(permissions[perm.key])}
                              disabled={
                                editing?.id === currentUser.id && perm.key === 'manageUsers'
                              }
                              onChange={() => togglePermission(perm.key)}
                              className="h-4 w-4 rounded border-slate-300 text-[#0B4F9C]"
                            />
                            <span>{perm.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <ImagePickerField label="الصورة الشخصية" value={pic} onChange={setPic} fallback="png.png" />

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-[#0B4F9C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#083D7A]"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ المستخدم والصلاحيات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmBlockUser)}
        title="تأكيد منع / حظر المستخدم"
        message={`هل تريد منع المستخدم "${confirmBlockUser?.name ?? ''}" من الدخول للنظام؟ سيتم إغلاق جلساته المفتوحة فوراً.`}
        confirmLabel="نعم، منع المستخدم"
        busy={busyAction}
        onConfirm={() => {
          if (confirmBlockUser) {
            void handleToggleUserStatus(confirmBlockUser, false);
          }
        }}
        onCancel={() => setConfirmBlockUser(null)}
      />

      <ConfirmModal
        open={Boolean(confirmDeleteUser)}
        title="تأكيد حذف المستخدم"
        message={`هل أنت متأكد من حذف حساب "${confirmDeleteUser?.name ?? ''}" بشكل نهائي؟`}
        busy={busyAction}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteUser(null)}
      />
    </div>
  );
};
