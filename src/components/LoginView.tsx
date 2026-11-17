import React, { useEffect, useState } from 'react';
import { Lock, UserCheck, LogIn, ShieldAlert, AlertTriangle, X, PhoneCall } from 'lucide-react';
import { api, ApiError } from '../api';
import { SYSTEM_LOGO_SRC, type BillItem, type SiteSettings, type User } from '../types';
import { showErrorPopup, validationError } from '../lib/errorPopup';

interface LoginViewProps {
  site: SiteSettings;
  blockedMessage?: string;
  blockedLicenseExpired?: boolean;
  blockedLicenseExpiresAt?: string;
  onSuccess: (payload: { user: User; site: SiteSettings; bill: BillItem[] }) => void;
}

export const LoginView: React.FC<LoginViewProps> = ({
  site,
  blockedMessage,
  blockedLicenseExpired,
  blockedLicenseExpiresAt,
  onSuccess,
}) => {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(blockedMessage || '');
  const [loading, setLoading] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const [licenseModal, setLicenseModal] = useState<{
    open: boolean;
    message: string;
    expiresAt?: string;
  }>({
    open: Boolean(blockedLicenseExpired),
    message:
      blockedMessage ||
      'انتهى ترخيص استخدام النظام لهذه الصيدلية. يجب التواصل مع إدارة النظام من أجل السماح لك باستخدام النظام.',
    expiresAt: blockedLicenseExpiresAt,
  });

  useEffect(() => {
    if (blockedMessage) {
      setError(blockedMessage);
    }
    if (blockedLicenseExpired) {
      setLicenseModal({
        open: true,
        message:
          blockedMessage ||
          'انتهى ترخيص استخدام النظام لهذه الصيدلية. يجب التواصل مع إدارة النظام من أجل السماح لك باستخدام النظام.',
        expiresAt: blockedLicenseExpiresAt,
      });
    }
  }, [blockedMessage, blockedLicenseExpired, blockedLicenseExpiresAt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!identifier.trim()) {
      validationError(
        'يرجى إدخال البريد الإلكتروني أو اسم المستخدم أو رقم المستخدم للدخول.',
        'تسجيل الدخول للنظام',
        ['حقل اسم المستخدم / البريد الإلكتروني فارغ.'],
      );
      return;
    }
    if (!password) {
      validationError(
        'يرجى إدخال كلمة المرور الخاصة بحسابك.',
        'تسجيل الدخول للنظام',
        ['حقل كلمة المرور فارغ.'],
      );
      return;
    }
    setLoading(true);
    try {
      const res = await api.login(identifier.trim(), password);
      await onSuccess(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'تعذر تسجيل الدخول! يرجى المحاولة مرة أخرى.';
      if (err instanceof ApiError && err.licenseExpired) {
        setLicenseModal({
          open: true,
          message: msg,
          expiresAt: err.licenseExpiresAt,
        });
      } else {
        showErrorPopup(err, 'تسجيل الدخول للنظام');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4"
      style={{ backgroundImage: `url('/photo/login.jpg')` }}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#071D3B]/90 via-[#0B4F9C]/80 to-[#0F1F38]/92 backdrop-blur-[2px]" />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-white/25 bg-white shadow-2xl">
        {/* Transparent Background itQAN Soft Logo Showcase */}
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="mx-auto mb-3 flex items-center justify-center">
            {!logoFailed ? (
              <img
                src={SYSTEM_LOGO_SRC}
                alt="شعار النظام - منصة إتقان سوفت (itQAN Soft)"
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(true)}
                className="h-20 w-auto max-w-[240px] object-contain"
              />
            ) : (
              <div className="text-2xl font-extrabold tracking-tight text-[#0B4F9C]">
                <span className="text-[#F97316]">it</span>QAN <span className="text-[#F97316]">S</span>oft
              </div>
            )}
          </div>
          <h1 className="text-xl font-bold text-[#0B4F9C]">
            {site.title || 'نظام ادارة الصيدلية المتكامل'}
          </h1>
          <p className="mt-0.5 text-sm font-semibold text-slate-600">
            منصة إتقان سوفت السحابية لإدارة الصيدليات{' '}
            <span aria-hidden="true" className="text-slate-300">·</span>{' '}
            <span className="text-[#EA580C]">itQAN Soft</span>
          </p>
        </div>

        {/* Dual-tone itQAN Accent Bar */}
        <div className="h-1 w-full bg-gradient-to-l from-[#0B4F9C] via-[#F97316] to-[#0B4F9C]" />

        <form onSubmit={handleSubmit} noValidate className="space-y-4 p-6">
          <h2 className="border-b border-slate-200 pb-2 text-center text-base font-bold text-slate-800">
            تسجيل الدخول إلى النظام
          </h2>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              البريد الإلكتروني أو اسم المستخدم أو رقم المستخدم
            </label>
            <div className="relative">
              <UserCheck className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                required
                autoComplete="username"
                dir="ltr"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="username  أو  user@pharmacy.com"
                className="w-full rounded-lg border border-slate-300 py-2 pr-9 pl-3 text-left text-sm transition focus:border-[#0B4F9C] focus:outline-none"
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-500">
              يمكنك الدخول بالبريد الإلكتروني، أو اسم المستخدم، أو رقم المستخدم / رقم الهاتف.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              كلمة المرور
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="password"
                required
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 py-2 pr-9 pl-3 text-left text-sm transition focus:border-[#0B4F9C] focus:outline-none"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0B4F9C] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-[#083D7A] disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            <span>{loading ? 'جاري التحقق...' : 'دخول'}</span>
          </button>

          <div className="pt-1 text-center text-[11px] text-slate-400">
            نظام إدارة الصيدليات المتكامل · إتقان سوفت (itQAN Soft)
          </div>
        </form>
      </div>

      {/* License Expired Blocking Modal */}
      {licenseModal.open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="license-expired-modal-title"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-red-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-l from-red-700 to-red-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-6 w-6 shrink-0 text-amber-200" />
                <h3 id="license-expired-modal-title" className="text-base font-black">
                  انتهاء ترخيص استخدام النظام
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setLicenseModal((m) => ({ ...m, open: false }))}
                className="rounded-lg p-1 text-white/80 transition hover:bg-white/15 hover:text-white"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-6 text-right">
              <p className="text-sm font-bold leading-relaxed text-slate-800">
                {licenseModal.message}
              </p>
              {licenseModal.expiresAt && (
                <div className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3.5 py-2.5 text-xs">
                  <span className="font-semibold text-red-800">تاريخ انتهاء الترخيص المسجل:</span>
                  <span className="font-mono font-black text-red-700" dir="ltr">
                    {licenseModal.expiresAt}
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-relaxed text-amber-900">
                <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  تم إيقاف الدخول لهذا الحساب تلقائياً لحين تجديد الاشتراك. يرجى التواصل مع إدارة منصة{' '}
                  <span className="font-bold">إتقان سوفت (itQAN Soft)</span> لتفعيل الترخيص والسماح لك باستخدام النظام.
                </div>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setLicenseModal((m) => ({ ...m, open: false }))}
                  className="rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white shadow transition hover:bg-red-700"
                >
                  فهمت ذلك
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
