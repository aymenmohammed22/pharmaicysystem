import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Pill,
  PlusCircle,
  Tags,
  Receipt,
  BarChart3,
  Truck,
  Users,
  UserCircle,
  Settings,
  LogOut,
  Menu,
  X,
  Trash2,
  ChevronDown,
  Shield,
  Coins,
  Warehouse,
  ShoppingCart,
  Stethoscope,
  Landmark,
  Briefcase,
  ShieldCheck,
  ClipboardCheck,
  Cpu,
  Building2,
  AlertTriangle,
} from 'lucide-react';
import type { BillItem, PageKey, PermissionKey, SiteSettings, User } from '../types';
import { ROLE_LABELS, SYSTEM_LOGO_SRC, hasPermission, resolvePhotoSrc } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { PWAInstallButton } from './PWAInstallButton';

interface LayoutProps {
  user: User;
  site: SiteSettings;
  bill: BillItem[];
  activePage: PageKey;
  onNavigate: (page: PageKey) => void;
  onClearBill: () => Promise<void>;
  onLogout: () => void;
  children: React.ReactNode;
}

interface NavGroup {
  title: string;
  items: Array<{
    key: PageKey;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    perm?: PermissionKey;
  }>;
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'إدارة المنصة والسحابة',
    items: [
      { key: 'platformTenants', label: 'إدارة الصيدليات وملاك الأنظمة', icon: Building2, perm: 'viewDashboard' },
    ],
  },
  {
    title: 'الرئيسية ونقطة البيع',
    items: [
      { key: 'dashboard', label: 'لوحة التحكم والتنبيهات', icon: LayoutDashboard, perm: 'viewDashboard' },
      { key: 'billing', label: 'نقطة البيع والكاشير (POS)', icon: Receipt, perm: 'posBilling' },
    ],
  },
  {
    title: 'الأدوية والمخازن والتشغيلات',
    items: [
      { key: 'inventories', label: 'الأدوية والتشغيلات (FEFO)', icon: Pill, perm: 'viewInventories' },
      { key: 'addnew', label: 'إضافة دواء جديد', icon: PlusCircle, perm: 'manageMedicines' },
      { key: 'manageCat', label: 'التصنيفات الدوائية', icon: Tags, perm: 'manageCategories' },
      { key: 'warehouses', label: 'المستودعات والتحويلات والجرد', icon: Warehouse, perm: 'manageWarehouses' },
    ],
  },
  {
    title: 'المشتريات والموردون',
    items: [
      { key: 'purchases', label: 'طلبات وفواتير المشتريات', icon: ShoppingCart, perm: 'managePurchases' },
      { key: 'suppliers', label: 'دليل الموردين وكشوفهم', icon: Truck, perm: 'manageSuppliers' },
    ],
  },
  {
    title: 'العملاء والوصفات الطبية',
    items: [
      { key: 'customers', label: 'العملاء والأطباء والوصفات', icon: Stethoscope, perm: 'manageCustomers' },
    ],
  },
  {
    title: 'المالية وشؤون الموظفين',
    items: [
      { key: 'accounting', label: 'الحسابات والصندوق والقوائم', icon: Landmark, perm: 'manageAccounting' },
      { key: 'hr', label: 'الموارد البشرية والموظفين', icon: Briefcase, perm: 'manageHr' },
      { key: 'hrAudit', label: 'سجل التدقيق والعمليات الحساسة', icon: ShieldCheck, perm: 'viewAuditLog' },
    ],
  },
  {
    title: 'التقييم والتوسعات المتقدمة',
    items: [
      { key: 'systemEvaluation', label: 'تقييم النظام وسد الفجوات', icon: ClipboardCheck, perm: 'viewDashboard' },
      { key: 'enterpriseHub', label: 'المركز المتقدم (التأمين، الفروع، KPI)', icon: Cpu, perm: 'viewDashboard' },
    ],
  },
  {
    title: 'التقارير والأمان والإعدادات',
    items: [
      { key: 'reports', label: 'التقارير التحليلية والإحصائيات', icon: BarChart3, perm: 'viewReports' },
      { key: 'users', label: 'المستخدمين والصلاحيات والمنع', icon: Users, perm: 'manageUsers' },
      { key: 'profile', label: 'الملف الشخصي', icon: UserCircle },
      { key: 'accountSetting', label: 'إعدادات الحساب والعملة', icon: Settings },
    ],
  },
];

export const Layout: React.FC<LayoutProps> = ({
  user,
  site,
  bill,
  activePage,
  onNavigate,
  onClearBill,
  onLogout,
  children,
}) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [licenseAlertDismissed, setLicenseAlertDismissed] = useState(false);

  const showLicensePreExpiry =
    user.role !== 'developer' && Boolean(site.licenseExpiringSoon) && !site.licenseExpired;
  const isOwnerOrAdmin =
    user.role === 'pharmacy_owner' || user.role === 'admin' || user.role === 'pharmacy_manager';

  useEffect(() => {
    setLicenseAlertDismissed(false);
  }, [site.id, site.licenseExpiresAt]);

  const totalBillItems = bill.reduce((sum, item) => sum + item.qty, 0);
  const canBill = hasPermission(user, 'posBilling');

  const isNavItemVisible = (item: NavGroup['items'][number]) => {
    if (item.key === 'platformTenants' || item.key === 'developerTenants') {
      return user.role === 'developer';
    }
    if (item.key === 'customers') {
      return hasPermission(user, 'manageCustomers') || hasPermission(user, 'managePrescriptions');
    }
    if (item.key === 'hr') {
      return hasPermission(user, 'manageHr') || hasPermission(user, 'viewAuditLog');
    }
    return !item.perm || hasPermission(user, item.perm);
  };

  const handleConfirmClear = async () => {
    setClearing(true);
    try {
      await onClearBill();
      setConfirmClearOpen(false);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div id="app-shell" className="min-h-screen bg-[#F3F6FA] text-slate-800">
      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b-2 border-[#F97316]/85 bg-gradient-to-l from-[#0B4F9C] via-[#0B4F9C] to-[#083D7A] px-4 text-white shadow-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="rounded p-1.5 text-white hover:bg-white/15 lg:hidden"
            aria-label="القائمة"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            className="flex items-center gap-2.5 text-right"
          >
            {site.logo ? (
              <span className="flex h-9 max-w-[150px] items-center justify-center">
                <img
                  src={resolvePhotoSrc(site.logo)}
                  alt={site.name}
                  className="h-8 w-auto max-w-full object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] drop-shadow-[0_0_1px_rgba(255,255,255,0.9)]"
                />
              </span>
            ) : (
              <span className="flex h-9 items-center justify-center">
                <img
                  src={SYSTEM_LOGO_SRC}
                  alt="شعار النظام - إتقان سوفت (itQAN Soft)"
                  referrerPolicy="no-referrer"
                  className="h-8 w-auto object-contain filter drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)] drop-shadow-[0_0_1px_rgba(255,255,255,0.9)]"
                />
              </span>
            )}
            <div>
              <div className="text-sm font-bold leading-tight text-white sm:text-base">{site.name}</div>
              <div className="hidden text-[11px] text-sky-100/90 sm:block">
                {site.logo ? site.title : `${site.title} · إتقان سوفت`}
              </div>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <PWAInstallButton />
          {hasPermission(user, 'manageSiteSettings') ? (
            <button
              type="button"
              onClick={() => onNavigate('accountSetting')}
              title="ضبط وتجديد العملة"
              className="hidden items-center gap-1.5 rounded border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-white/20 md:inline-flex"
            >
              <Coins className="h-3.5 w-3.5 text-[#FFD700]" />
              <span>
                {site.currencyName} ({site.currencySymbol})
              </span>
            </button>
          ) : (
            <span className="hidden items-center gap-1.5 rounded border border-white/20 bg-white/10 px-2.5 py-1 text-xs font-semibold text-sky-100 md:inline-flex">
              <Coins className="h-3.5 w-3.5 text-[#FFD700]" />
              <span>
                {site.currencyName} ({site.currencySymbol})
              </span>
            </span>
          )}

          {canBill && bill.length > 0 && (
            <div className="flex items-center gap-2 rounded border border-slate-200 bg-[#F9F9F9] px-2.5 py-1 text-xs text-slate-800 shadow">
              <span className="inline-flex min-w-[26px] items-center justify-center rounded bg-slate-800 px-1.5 py-0.5 font-bold text-white">
                {totalBillItems}
              </span>
              <span className="hidden font-medium sm:inline">محدد</span>
                <button
                  type="button"
                  onClick={() => onNavigate('billing')}
                  className="rounded bg-[#0B4F9C] px-2 py-1 font-semibold text-white hover:bg-[#083D7A]"
                >
                  عرض الفاتورة
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  title="إلغاء / مسح الفاتورة"
                  className="inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 font-semibold text-white hover:bg-red-700"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>إلغاء</span>
                </button>
              </div>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => setAccountMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded px-2.5 py-1.5 text-sm font-medium text-white transition hover:bg-[#083D7A]"
              >
                <img
                  src={resolvePhotoSrc(user.pic, 'png.png')}
                  alt={user.name}
                  className="h-8 w-8 rounded-full border border-white/50 bg-white object-cover"
                />
                <span className="hidden sm:inline">{user.name}</span>
                <ChevronDown className="h-4 w-4 opacity-80" />
              </button>

              {accountMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setAccountMenuOpen(false)} />
                  <div className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-[#F9F9F9] text-slate-800 shadow-xl">
                    <div className="bg-gradient-to-br from-[#0B4F9C] to-[#083D7A] px-4 py-3 text-center text-white">
                      <img
                        src={resolvePhotoSrc(user.pic, 'png.png')}
                        alt={user.name}
                        className="mx-auto mb-2 h-16 w-16 rounded-full border-2 border-white bg-white object-cover"
                      />
                      <div className="font-bold">{user.name}</div>
                      <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-white/15 px-2 py-0.5 text-[11px]">
                        <Shield className="h-3 w-3 text-[#F97316]" />
                        <span>{ROLE_LABELS[user.role]}</span>
                      </div>
                      <div className="mt-1 text-xs text-sky-100" dir="ltr">
                        {user.email}
                      </div>
                    </div>
                    <div className="divide-y divide-slate-200 p-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onNavigate('profile');
                        }}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-right text-sm hover:bg-slate-200/70"
                      >
                        <UserCircle className="h-4 w-4 text-[#0B4F9C]" />
                        <span>الملف الشخصي</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onNavigate('accountSetting');
                        }}
                        className="flex w-full items-center gap-2 rounded px-3 py-2 text-right text-sm hover:bg-slate-200/70"
                      >
                        <Settings className="h-4 w-4 text-[#0B4F9C]" />
                        <span>إعدادات الحساب والعملة</span>
                      </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAccountMenuOpen(false);
                        onLogout();
                      }}
                      className="flex w-full items-center gap-2 rounded px-3 py-2 text-right text-sm text-red-600 hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>تسجيل الخروج</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        {sidebarOpen && (
          <div
            className="no-print fixed inset-0 z-20 bg-black/40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <aside
          className={`no-print fixed right-0 top-14 z-20 flex h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col bg-[#0F1F38] text-slate-300 transition-transform duration-200 lg:static lg:translate-x-0 ${
            sidebarOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
          }`}
        >
          <div className="flex items-center gap-3 border-b border-slate-700/60 bg-[#0A1629] px-4 py-3">
            <img
              src={resolvePhotoSrc(user.pic, 'png.png')}
              alt={user.name}
              className="h-10 w-10 rounded-full border border-slate-500 bg-white object-cover"
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-white">{user.name}</div>
              <div className="mt-0.5 text-[11px] font-semibold text-sky-300">{ROLE_LABELS[user.role]}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400" />
                <span>مسموح بالدخول</span>
              </div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-1">
            {NAV_GROUPS.map((group) => {
              const visibleItems = group.items.filter(isNavItemVisible);
              if (visibleItems.length === 0) return null;
              return (
                <div key={group.title} className="mb-1">
                  <div className="bg-[#091324] px-4 py-1.5 text-[11px] font-bold text-slate-400">
                    {group.title}
                  </div>
                  <div className="space-y-0.5 py-1">
                    {visibleItems.map((item) => {
                      const Icon = item.icon;
                      const isActive = activePage === item.key;
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            onNavigate(item.key);
                            setSidebarOpen(false);
                          }}
                          className={`flex w-full items-center justify-between border-r-4 px-4 py-2 text-right text-[13px] transition ${
                            isActive
                              ? 'border-[#F97316] bg-[#162B4D] font-bold text-white'
                              : 'border-transparent text-slate-300 hover:bg-[#152847] hover:text-white'
                          }`}
                        >
                          <span className="flex items-center gap-2.5">
                            <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#F97316]' : ''}`} />
                            <span>{item.label}</span>
                          </span>
                          {item.key === 'billing' && bill.length > 0 && (
                            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                              {totalBillItems}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>

          <div className="border-t border-slate-700/60 bg-[#0A1629] p-3">
            <div className="mb-2 flex items-center justify-center gap-2 text-center text-[11px] text-slate-400">
              {site.logo ? (
                <>
                  <img
                    src={resolvePhotoSrc(site.logo)}
                    alt={site.name}
                    className="h-5 w-auto max-w-[60px] rounded bg-white/90 px-1 py-0.5 object-contain"
                  />
                  <span className="truncate font-semibold text-slate-200">{site.name}</span>
                </>
              ) : (
                <>
                  <img
                    src={SYSTEM_LOGO_SRC}
                    alt="itQAN Soft"
                    className="h-6 w-auto rounded bg-white/95 px-1 py-0.5 object-contain"
                  />
                  <span>إتقان سوفت لإدارة الصيدليات · itQAN Soft</span>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600/90 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
            >
              <LogOut className="h-4 w-4" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          {showLicensePreExpiry && (
            <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-gradient-to-l from-amber-50 to-orange-50 px-4 py-3 text-amber-950 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-sm font-black text-amber-900">
                    تنبيه هام: اقترب موعد انتهاء ترخيص استخدام النظام (
                    {site.licenseDaysRemaining === 0
                      ? 'ينتهي اليوم!'
                      : `متبقي ${site.licenseDaysRemaining} ${site.licenseDaysRemaining === 1 ? 'يوم' : 'أيام'}`}
                    )
                  </div>
                  <div className="text-xs font-medium text-amber-800">
                    سينتهي الترخيص بتاريخ{' '}
                    <span className="font-mono font-bold" dir="ltr">
                      {site.licenseExpiresAt}
                    </span>{' '}
                    وسيتم إيقاف الدخول للحساب تلقائياً بعد الانتهاء. يرجى التواصل مع إدارة المنصة للتجديد.
                  </div>
                </div>
              </div>
              <span className="rounded-lg bg-amber-200/80 px-3 py-1 font-mono text-xs font-black text-amber-950" dir="ltr">
                EXP: {site.licenseExpiresAt}
              </span>
            </div>
          )}
          {children}
        </main>
      </div>

      {showLicensePreExpiry && isOwnerOrAdmin && !licenseAlertDismissed && (
        <div
          className="no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-amber-300 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-gradient-to-l from-amber-600 to-orange-600 px-5 py-4 text-white">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="h-6 w-6 shrink-0" />
                <h3 className="text-base font-black">تنبيه بقرب انتهاء ترخيص النظام</h3>
              </div>
              <button
                type="button"
                onClick={() => setLicenseAlertDismissed(true)}
                className="rounded-lg p-1 text-white/80 hover:bg-white/15 hover:text-white"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-6 text-right">
              <p className="text-sm font-bold leading-relaxed text-slate-800">
                مرحباً {user.name}، تبقى{' '}
                <span className="font-black text-orange-600">
                  {site.licenseDaysRemaining === 0
                    ? 'أقل من يوم واحد (ينتهي اليوم)'
                    : `${site.licenseDaysRemaining} ${site.licenseDaysRemaining === 1 ? 'يوم واحد' : 'أيام'}`}
                </span>{' '}
                على انتهاء ترخيص استخدام النظام لصيدلية <span className="font-black">{site.name}</span>.
              </p>
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs">
                <span className="font-semibold text-amber-900">تاريخ انتهاء الترخيص:</span>
                <span className="font-mono font-black text-orange-700" dir="ltr">
                  {site.licenseExpiresAt}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-600">
                بعد انتهاء هذا التاريخ سيتوقف النظام تلقائياً عن السماح بالدخول. يرجى التواصل مع إدارة النظام (إتقان سوفت) لتجديد الترخيص وتجنب انقطاع العمل.
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setLicenseAlertDismissed(true)}
                  className="rounded-xl bg-[#0B4F9C] px-5 py-2 text-xs font-bold text-white shadow hover:bg-[#083D7A]"
                >
                  حسناً، تم الإطلاع
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmClearOpen}
        title="تأكيد مسح الفاتورة"
        message="هل أنت متأكد من رغبتك في إلغاء ومسح جميع الأصناف من الفاتورة الحالية؟"
        confirmLabel="نعم، مسح السلة"
        busy={clearing}
        onConfirm={handleConfirmClear}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </div>
  );
};
