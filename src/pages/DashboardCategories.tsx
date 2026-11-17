import React, { useMemo, useState } from 'react';
import {
  Plus,
  Pill,
  ArrowLeft,
  X,
  Package,
  Layers,
  AlertTriangle,
  Clock,
  FileDown,
  ShieldAlert,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type { Category, InventoryItem, PharmacyAlerts, SiteSettings, User } from '../types';
import { hasPermission, resolvePhotoSrc } from '../types';
import { ImagePickerField } from '../components/ImagePickerField';
import { PrintPreviewModal } from '../components/PrintPreviewModal';

interface DashboardCategoriesProps {
  user: User;
  site: SiteSettings;
  categories: Category[];
  inventories: InventoryItem[];
  alerts: PharmacyAlerts | null;
  onRefreshCategories: () => Promise<void>;
  onSelectCategory: (catId: number) => void;
  onGoInventories: () => void;
  onGoAlerts: () => void;
}

type AlertsFilter = 'all' | 'expiry' | 'stock';

export const DashboardCategories: React.FC<DashboardCategoriesProps> = ({
  user,
  site,
  categories,
  inventories,
  alerts,
  onRefreshCategories,
  onSelectCategory,
  onGoInventories,
  onGoAlerts,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [pic, setPic] = useState('cap.png');
  const [saving, setSaving] = useState(false);
  const [alertsFilter, setAlertsFilter] = useState<AlertsFilter>('all');
  const [pdfPreviewOpen, setPdfPreviewOpen] = useState(false);
  const [pdfScope, setPdfScope] = useState<AlertsFilter>('all');

  const canAddCategory = hasPermission(user, 'manageCategories');
  const canViewInventories = hasPermission(user, 'viewInventories');
  const canViewReports = hasPermission(user, 'viewReports');
  const totalMedicines = categories.reduce((sum, c) => sum + c.medicineCount, 0);

  const invById = useMemo(() => {
    const map = new Map<number, InventoryItem>();
    for (const item of inventories) {
      map.set(item.id, item);
    }
    return map;
  }, [inventories]);

  const expiryAlerts = useMemo(() => {
    const expiredList = (alerts?.expired ?? []).map((item) => ({
      id: item.id,
      batchId: item.batchId,
      name: item.name,
      expiryDate: item.expiryDate,
      batchNumber: item.batchNumber,
      daysLeft: -1,
      qtyRemaining: invById.get(item.id)?.quantity,
      isExpired: true,
      meta: invById.get(item.id),
    }));
    const soonList = (alerts?.expiringSoon ?? []).map((item) => ({
      id: item.id,
      batchId: undefined as number | undefined,
      name: item.name,
      expiryDate: item.expiryDate,
      batchNumber: item.batchNumber,
      daysLeft: item.daysLeft,
      qtyRemaining: item.qtyRemaining,
      isExpired: false,
      meta: invById.get(item.id),
    }));
    return [...expiredList, ...soonList].sort((a, b) => a.daysLeft - b.daysLeft);
  }, [alerts, invById]);

  const stockAlerts = useMemo(() => {
    const outList = (alerts?.outOfStock ?? []).map((item) => ({
      ...item,
      isOut: true,
      ratioPct: 0,
      meta: invById.get(item.id),
    }));
    const lowList = (alerts?.lowStock ?? []).map((item) => {
      const target = Math.max(1, item.minStock || 1);
      const ratioPct = Math.min(100, Math.max(4, Math.round((item.quantity / target) * 100)));
      return {
        ...item,
        isOut: false,
        ratioPct,
        meta: invById.get(item.id),
      };
    });
    return [...outList, ...lowList].sort((a, b) => a.quantity - b.quantity);
  }, [alerts, invById]);

  const expiredCount = alerts?.expired.length ?? 0;
  const expiringSoonCount = alerts?.expiringSoon.length ?? 0;
  const outOfStockCount = alerts?.outOfStock.length ?? 0;
  const lowStockCount = alerts?.lowStock.length ?? 0;
  const expiryAlertCount = expiredCount + expiringSoonCount;
  const stockAlertCount = outOfStockCount + lowStockCount;
  const totalAlertsCount = expiryAlertCount + stockAlertCount;

  const handleOpenPdfModal = (scope?: AlertsFilter) => {
    setPdfScope(scope ?? alertsFilter);
    setPdfPreviewOpen(true);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      validationError(
        'يرجى إدخال اسم التصنيف الدوائي قبل الحفظ.',
        'إضافة تصنيف دوائي جديد',
        ['حقل اسم التصنيف الإلزامي فارغ.'],
      );
      return;
    }
    setSaving(true);
    try {
      await api.createCategory({ name: name.trim(), details, pic });
      await onRefreshCategories();
      setName('');
      setDetails('');
      setPic('cap.png');
      setModalOpen(false);
    } catch (err) {
      showErrorPopup(err, 'إضافة تصنيف دوائي جديد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Visual Critical Alerts Panel (Expiry & Critical Stock + PDF Export) */}
      <section className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-[#DC2626]" />
              <h2 className="text-base font-bold text-slate-800 sm:text-lg">
                لوحة تنبيهات الصلاحية والمخزون الحرج
              </h2>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600 tabular-nums">
              <span>إجمالي التنبيهات: <strong className="text-slate-900">{totalAlertsCount}</strong></span>
              <span aria-hidden="true">·</span>
              <span>منتهي: <strong className="text-red-700">{expiredCount}</strong></span>
              <span aria-hidden="true">·</span>
              <span>قريب الانتهاء (≤ 30 يوم): <strong className="text-amber-700">{expiringSoonCount}</strong></span>
              <span aria-hidden="true">·</span>
              <span>نفاد: <strong className="text-red-700">{outOfStockCount}</strong></span>
              <span aria-hidden="true">·</span>
              <span>مخزون حرج: <strong className="text-amber-700">{lowStockCount}</strong></span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Segmented Interactive Filter */}
            <div className="flex items-center gap-1 rounded border border-slate-300 bg-white p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setAlertsFilter('all')}
                className={`whitespace-nowrap shrink-0 rounded px-2.5 py-1 font-semibold transition ${
                  alertsFilter === 'all'
                    ? 'bg-[#0B4F9C] text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                الكل ({totalAlertsCount})
              </button>
              <button
                type="button"
                onClick={() => setAlertsFilter('expiry')}
                className={`whitespace-nowrap shrink-0 rounded px-2.5 py-1 font-semibold transition ${
                  alertsFilter === 'expiry'
                    ? 'bg-red-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                الصلاحية ({expiryAlertCount})
              </button>
              <button
                type="button"
                onClick={() => setAlertsFilter('stock')}
                className={`whitespace-nowrap shrink-0 rounded px-2.5 py-1 font-semibold transition ${
                  alertsFilter === 'stock'
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                المخزون الحرج ({stockAlertCount})
              </button>
            </div>

            <button
              type="button"
              onClick={() => handleOpenPdfModal()}
              className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded bg-[#145632] px-3.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#0f4126]"
            >
              <FileDown className="h-4 w-4" />
              <span>توليد ملف PDF بالتنبيهات</span>
            </button>

            {canViewReports && (
              <button
                type="button"
                onClick={onGoAlerts}
                className="inline-flex items-center gap-1 whitespace-nowrap shrink-0 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-3.5 w-3.5 text-[#0B4F9C]" />
                <span>سجل التنبيهات الكامل</span>
              </button>
            )}
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="grid grid-cols-2 divide-x divide-x-reverse divide-slate-200 border-b border-slate-200 bg-slate-50/70 sm:grid-cols-4">
          <div className="px-4 py-3">
            <div className="text-xs font-semibold text-slate-500">تشغيلات منتهية الصلاحية</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xl font-bold text-red-700 tabular-nums">{expiredCount}</span>
              <span className="text-[11px] font-semibold text-red-600">موقوفة عن الصرف</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs font-semibold text-slate-500">قريبة من الانتهاء (≤ 30 يوم)</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xl font-bold text-amber-700 tabular-nums">{expiringSoonCount}</span>
              <span className="text-[11px] font-semibold text-amber-700">تحتاج متابعة FEFO</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs font-semibold text-slate-500">أدوية نافدة الرصيد (0)</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xl font-bold text-red-700 tabular-nums">{outOfStockCount}</span>
              <span className="text-[11px] font-semibold text-red-600">تحتاج طلب شراء فوري</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs font-semibold text-slate-500">أدوية بمستوى مخزون حرج</div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-xl font-bold text-amber-700 tabular-nums">{lowStockCount}</span>
              <span className="text-[11px] font-semibold text-amber-700">أقل أو يساوي حد الأمان</span>
            </div>
          </div>
        </div>

        {/* Detailed Visual Lists */}
        <div className="p-4">
          {totalAlertsCount === 0 ? (
            <div className="flex flex-col items-center justify-center rounded border border-emerald-200 bg-emerald-50/50 px-4 py-8 text-center">
              <CheckCircle2 className="mb-2 h-8 w-8 text-emerald-600" />
              <div className="text-sm font-bold text-emerald-900">
                الوضع المخزني والصلاحي سليم حالياً
              </div>
              <p className="mt-1 text-xs text-emerald-700">
                لا توجد تشغيلات منتهية أو قريبة من الانتهاء خلال 30 يوماً، وجميع الأصناف فوق الحد الأدنى الآمن.
              </p>
            </div>
          ) : (
            <div
              className={`grid grid-cols-1 gap-4 ${
                alertsFilter === 'all' ? 'lg:grid-cols-2' : ''
              }`}
            >
              {/* Column 1: Expiry Alerts */}
              {(alertsFilter === 'all' || alertsFilter === 'expiry') && (
                <div className="flex flex-col rounded border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-red-50/60 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-sm font-bold text-red-900">
                      <Clock className="h-4 w-4 text-red-600" />
                      <span>أدوية قريبة من تاريخ الانتهاء أو منتهية</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-red-700 tabular-nums">
                      {expiryAlerts.length} تشغيلة
                    </span>
                  </div>
                  {expiryAlerts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-slate-500">
                      لا توجد تشغيلات منتهية أو قريبة من الانتهاء حالياً.
                    </div>
                  ) : (
                    <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {expiryAlerts.map((item, idx) => {
                        const isCriticalDays = item.isExpired || item.daysLeft <= 7;
                        const progressPct = item.isExpired
                          ? 100
                          : Math.min(100, Math.max(10, Math.round(((30 - item.daysLeft) / 30) * 100)));
                        return (
                          <div
                            key={`${item.id}-${item.batchNumber}-${idx}`}
                            className="px-3.5 py-2.5 transition hover:bg-slate-50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold text-slate-900">
                                  {item.name}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums">
                                  <span>
                                    تشغيلة:{' '}
                                    <span className="font-mono font-semibold text-slate-700" dir="ltr">
                                      {item.batchNumber || '-'}
                                    </span>
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    الانتهاء:{' '}
                                    <span className="font-mono font-semibold text-slate-700" dir="ltr">
                                      {item.expiryDate}
                                    </span>
                                  </span>
                                  {item.qtyRemaining !== undefined && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>المتبقي: {item.qtyRemaining}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 text-left">
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${
                                    isCriticalDays ? 'text-red-700' : 'text-amber-700'
                                  }`}
                                >
                                  <Clock className="h-3.5 w-3.5" />
                                  {item.isExpired
                                    ? 'منتهي الصلاحية'
                                    : item.daysLeft === 0
                                      ? 'ينتهي اليوم'
                                      : `متبقي ${item.daysLeft} يوم`}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${
                                  isCriticalDays ? 'bg-red-600' : 'bg-amber-500'
                                }`}
                                style={{ width: `${progressPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Column 2: Critical / Out of Stock Alerts */}
              {(alertsFilter === 'all' || alertsFilter === 'stock') && (
                <div className="flex flex-col rounded border border-slate-200 bg-white">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-amber-50/70 px-3.5 py-2.5">
                    <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span>أدوية وصلت لمستوى مخزون حرج أو نافد</span>
                    </div>
                    <span className="font-mono text-xs font-bold text-amber-800 tabular-nums">
                      {stockAlerts.length} صنف
                    </span>
                  </div>
                  {stockAlerts.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-slate-500">
                      لا توجد أصناف بمستوى مخزون حرج أو نافد حالياً.
                    </div>
                  ) : (
                    <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                      {stockAlerts.map((item) => {
                        const deficit = Math.max(0, item.minStock - item.quantity);
                        return (
                          <div
                            key={item.id}
                            className="px-3.5 py-2.5 transition hover:bg-slate-50"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-bold text-slate-900">
                                  {item.name}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 tabular-nums">
                                  <span>
                                    الرصيد الحالي:{' '}
                                    <strong className={item.isOut ? 'text-red-700' : 'text-amber-700'}>
                                      {item.quantity}
                                    </strong>{' '}
                                    {item.meta?.packUnit || 'عبوة'}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span>الحد الأدنى الآمن: {item.minStock}</span>
                                  {deficit > 0 && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>العجز: {deficit}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 text-left">
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-bold ${
                                    item.isOut ? 'text-red-700' : 'text-amber-700'
                                  }`}
                                >
                                  <AlertTriangle className="h-3.5 w-3.5" />
                                  {item.isOut ? 'نفاد تام' : 'مخزون حرج'}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                              <div
                                className={`h-full rounded-full ${
                                  item.isOut ? 'bg-red-600' : 'bg-amber-500'
                                }`}
                                style={{ width: `${item.isOut ? 100 : item.ratioPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Header Panel */}
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">
              لوحة التحكم — تصنيفات الأدوية
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {canViewInventories && (
              <button
                type="button"
                onClick={onGoInventories}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Package className="h-4 w-4 text-[#0B4F9C]" />
                <span>عرض كل المخزون ({totalMedicines})</span>
              </button>
            )}
            {canAddCategory && (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-[#0B4F9C] px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-[#083D7A]"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة تصنيف جديد</span>
              </button>
            )}
          </div>
        </div>

        {/* Categories Grid */}
        <div className="p-4">
          {categories.length === 0 ? (
            <div className="py-12 text-center text-slate-500">
              لا توجد تصنيفات مضافة حتى الآن.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onSelectCategory(cat.id)}
                  className="group flex flex-col overflow-hidden rounded border-t-4 border-t-[#0B4F9C] bg-white text-right shadow transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="relative h-40 w-full overflow-hidden bg-slate-100">
                    <img
                      src={resolvePhotoSrc(cat.pic, 'cap.png')}
                      alt={cat.name}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded bg-[#0B4F9C]/90 px-2 py-0.5 text-xs font-bold text-white shadow">
                      <Pill className="h-3 w-3 text-[#F97316]" />
                      {cat.medicineCount} دواء
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-3.5">
                    <div>
                      <h3 className="text-base font-bold text-slate-800 group-hover:text-[#0B4F9C]">
                        {cat.name}
                      </h3>
                      {cat.details && (
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                          {cat.details}
                        </p>
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs font-semibold text-[#0B4F9C]">
                      <span>تصفح الأدوية</span>
                      <ArrowLeft className="h-3.5 w-3.5 transition group-hover:-translate-x-1" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Category Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">إضافة تصنيف دوائي جديد</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-white/70 hover:text-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddCategory} noValidate className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  اسم التصنيف
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: مضادات حيوية"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#0B4F9C] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  التفاصيل (اختياري)
                </label>
                <textarea
                  rows={2}
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  placeholder="وصف مختصر للتصنيف"
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm focus:border-[#0B4F9C] focus:outline-none"
                />
              </div>
              <ImagePickerField label="صورة التصنيف" value={pic} onChange={setPic} />
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-[#0B4F9C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#083D7A] disabled:opacity-60"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ التصنيف'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Alerts PDF Print Preview Modal */}
      <PrintPreviewModal
        open={pdfPreviewOpen}
        title={
          pdfScope === 'expiry'
            ? 'تقرير الأدوية المنتهية والقريبة من الانتهاء'
            : pdfScope === 'stock'
              ? 'تقرير الأدوية ذات المخزون الحرج والنافد'
              : 'تقرير تنبيهات الصلاحية والمخزون الحرج'
        }
        site={site}
        onClose={() => setPdfPreviewOpen(false)}
      >
        <div className="space-y-5 text-sm">
          {/* Scope Selector in Preview Toolbar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded border border-sky-200 bg-[#F3F6FA] p-3 text-xs">
            <span className="font-bold text-slate-700">محتوى ملف الـ PDF المراد حفظه:</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPdfScope('all')}
                className={`rounded px-3 py-1 font-bold ${
                  pdfScope === 'all' ? 'bg-[#0B4F9C] text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                التقرير الشامل ({totalAlertsCount})
              </button>
              <button
                type="button"
                onClick={() => setPdfScope('expiry')}
                className={`rounded px-3 py-1 font-bold ${
                  pdfScope === 'expiry' ? 'bg-red-600 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                الصلاحية فقط ({expiryAlertCount})
              </button>
              <button
                type="button"
                onClick={() => setPdfScope('stock')}
                className={`rounded px-3 py-1 font-bold ${
                  pdfScope === 'stock' ? 'bg-amber-600 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                المخزون الحرج فقط ({stockAlertCount})
              </button>
            </div>
          </div>

          {/* Executive Summary Strip */}
          <div className="grid grid-cols-2 gap-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-4">
            <div>
              <div className="text-slate-500">منتهي الصلاحية</div>
              <div className="mt-0.5 text-base font-bold text-red-700 tabular-nums">{expiredCount}</div>
            </div>
            <div>
              <div className="text-slate-500">قريب الانتهاء (≤ 30 يوم)</div>
              <div className="mt-0.5 text-base font-bold text-amber-700 tabular-nums">{expiringSoonCount}</div>
            </div>
            <div>
              <div className="text-slate-500">نفاد المخزون (0)</div>
              <div className="mt-0.5 text-base font-bold text-red-700 tabular-nums">{outOfStockCount}</div>
            </div>
            <div>
              <div className="text-slate-500">مخزون حرج</div>
              <div className="mt-0.5 text-base font-bold text-amber-700 tabular-nums">{lowStockCount}</div>
            </div>
          </div>

          {/* Table 1: Expiry Alerts */}
          {(pdfScope === 'all' || pdfScope === 'expiry') && (
            <div className="space-y-2">
              <h3 className="border-b border-red-200 pb-1 text-sm font-bold text-red-800">
                أولاً: قائمة الأدوية والتشغيلات المنتهية أو القريبة من انتهاء الصلاحية ({expiryAlerts.length})
              </h3>
              {expiryAlerts.length === 0 ? (
                <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  لا توجد تشغيلات منتهية أو قريبة من الانتهاء خلال 30 يوماً.
                </p>
              ) : (
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800">
                      <th className="border border-slate-300 px-2.5 py-2">#</th>
                      <th className="border border-slate-300 px-2.5 py-2">اسم الدواء</th>
                      <th className="border border-slate-300 px-2.5 py-2">الباركود</th>
                      <th className="border border-slate-300 px-2.5 py-2">رقم التشغيلة</th>
                      <th className="border border-slate-300 px-2.5 py-2">تاريخ الانتهاء</th>
                      <th className="border border-slate-300 px-2.5 py-2">الرصيد المتبقي</th>
                      <th className="border border-slate-300 px-2.5 py-2">الحالة والمدة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiryAlerts.map((item, idx) => (
                      <tr key={`${item.id}-${item.batchNumber}-${idx}`}>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono">{idx + 1}</td>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-bold text-slate-900">
                          {item.name}
                          {item.meta?.unit ? <span className="mr-1 font-normal text-slate-500">({item.meta.unit})</span> : null}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono" dir="ltr">
                          {item.meta?.barcode || '-'}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono" dir="ltr">
                          {item.batchNumber || '-'}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 font-mono font-bold" dir="ltr">
                          {item.expiryDate}
                        </td>
                        <td className="border border-slate-200 px-2.5 py-1.5 tabular-nums">
                          {item.qtyRemaining !== undefined ? item.qtyRemaining : '-'}
                        </td>
                        <td
                          className={`border border-slate-200 px-2.5 py-1.5 font-bold ${
                            item.isExpired || item.daysLeft <= 7 ? 'text-red-700' : 'text-amber-700'
                          }`}
                        >
                          {item.isExpired
                            ? 'منتهي الصلاحية'
                            : item.daysLeft === 0
                              ? 'ينتهي اليوم'
                              : `متبقي ${item.daysLeft} يوم`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Table 2: Critical Stock Alerts */}
          {(pdfScope === 'all' || pdfScope === 'stock') && (
            <div className="space-y-2">
              <h3 className="border-b border-amber-200 pb-1 text-sm font-bold text-amber-900">
                ثانياً: قائمة الأدوية التي وصلت لمستوى مخزون حرج أو نافد ({stockAlerts.length})
              </h3>
              {stockAlerts.length === 0 ? (
                <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  لا توجد أصناف بمستوى مخزون حرج أو نافد حالياً.
                </p>
              ) : (
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800">
                      <th className="border border-slate-300 px-2.5 py-2">#</th>
                      <th className="border border-slate-300 px-2.5 py-2">اسم الدواء</th>
                      <th className="border border-slate-300 px-2.5 py-2">الباركود</th>
                      <th className="border border-slate-300 px-2.5 py-2">الرصيد الحالي</th>
                      <th className="border border-slate-300 px-2.5 py-2">الحد الأدنى الآمن</th>
                      <th className="border border-slate-300 px-2.5 py-2">العجز المطلوب</th>
                      <th className="border border-slate-300 px-2.5 py-2">التقييم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stockAlerts.map((item, idx) => {
                      const deficit = Math.max(0, item.minStock - item.quantity);
                      return (
                        <tr key={item.id}>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-mono">{idx + 1}</td>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-bold text-slate-900">
                            {item.name}
                            {item.meta?.unit ? <span className="mr-1 font-normal text-slate-500">({item.meta.unit})</span> : null}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-mono" dir="ltr">
                            {item.meta?.barcode || '-'}
                          </td>
                          <td
                            className={`border border-slate-200 px-2.5 py-1.5 font-bold tabular-nums ${
                              item.isOut ? 'text-red-700' : 'text-amber-700'
                            }`}
                          >
                            {item.quantity} {item.meta?.packUnit || ''}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-1.5 tabular-nums">{item.minStock}</td>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-bold tabular-nums">{deficit}</td>
                          <td
                            className={`border border-slate-200 px-2.5 py-1.5 font-bold ${
                              item.isOut ? 'text-red-700' : 'text-amber-700'
                            }`}
                          >
                            {item.isOut ? 'نفاد تام — طلب فوري' : 'مخزون حرج'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-500">
            <span>أُعد بواسطة: {user.name}</span>
            <span>نطاق الصلاحية: التشغيلات المنتهية أو المتبقي لها ≤ 30 يوماً</span>
          </div>
        </div>
      </PrintPreviewModal>
    </div>
  );
};
