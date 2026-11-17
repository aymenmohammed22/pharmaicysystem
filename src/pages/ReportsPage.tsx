import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Search,
  Trash2,
  Printer,
  FileText,
  Package,
  Download,
  AlertTriangle,
  Clock,
  Maximize2,
  TrendingUp,
  ShoppingCart,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup } from '../lib/errorPopup';
import type { AuditLogRecord, ReportsData, SiteSettings, SoldInvoice, User } from '../types';
import {
  ROLE_LABELS,
  formatMoney,
  getAvailableCurrencies,
  resolveCurrencyInfo,
  hasPermission,
  resolvePhotoSrc,
} from '../types';
import { ConfirmModal } from '../components/ConfirmModal';
import { PrintPreviewModal } from '../components/PrintPreviewModal';

interface ReportsPageProps {
  user: User;
  site: SiteSettings;
  initialTab?: 'sales' | 'purchases' | 'profit' | 'inventory' | 'alerts' | 'audit';
  reports: ReportsData | null;
  onRefreshReports: (from?: string, to?: string, currency?: string) => Promise<void>;
}

function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escape = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  user,
  site,
  initialTab = 'sales',
  reports,
  onRefreshReports,
}) => {
  const [tab, setTab] = useState<'sales' | 'purchases' | 'profit' | 'inventory' | 'alerts' | 'audit'>(initialTab);
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<SoldInvoice | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [previewTarget, setPreviewTarget] = useState<'report' | 'invoice' | null>(null);
  const [autoPrintInvoice, setAutoPrintInvoice] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);

  const availableCurrencies = useMemo(() => getAvailableCurrencies(site), [site]);
  const [selectedCurrency, setSelectedCurrency] = useState<string>(
    reports?.displayCurrency?.code ||
      (site.autoConvertCurrencies ? site.defaultDisplayCurrency || site.currencyCode : site.currencyCode),
  );

  useEffect(() => {
    if (reports?.displayCurrency?.code) {
      setSelectedCurrency(reports.displayCurrency.code);
    } else {
      setSelectedCurrency(
        site.autoConvertCurrencies ? site.defaultDisplayCurrency || site.currencyCode : site.currencyCode,
      );
    }
  }, [reports?.displayCurrency?.code, site.autoConvertCurrencies, site.defaultDisplayCurrency, site.currencyCode]);

  const dispCurrInfo = reports?.displayCurrency || resolveCurrencyInfo(site, selectedCurrency);
  const dispSymbol = dispCurrInfo.symbol || site.currencySymbol;
  const dispCode = dispCurrInfo.code || site.currencyCode;

  const canDelete = hasPermission(user, 'deleteReports');
  const canAudit = hasPermission(user, 'viewAuditLog');

  useEffect(() => {
    if (tab === 'audit' && canAudit) {
      api
        .getAuditLogs(150)
        .then((r) => setAuditLogs(r.logs))
        .catch((err) => {
          const status = (err as Error & { status?: number })?.status;
          if (status !== 403) {
            showErrorPopup(err, 'تحميل سجل التدقيق والرقابة');
          }
        });
    }
  }, [tab, canAudit]);

  const filteredSales = useMemo(() => {
    if (!reports) return [];
    const q = search.trim().toLowerCase();
    return reports.sales.filter((s) => {
      if (fromDate && s.date.slice(0, 10) < fromDate) return false;
      if (toDate && s.date.slice(0, 10) > toDate) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.contact.toLowerCase().includes(q) ||
        s.adminName.toLowerCase().includes(q) ||
        String(s.id).includes(q)
      );
    });
  }, [reports, search, fromDate, toDate]);

  const filteredRevenue = useMemo(
    () =>
      filteredSales
        .filter((s) => s.status !== 'cancelled')
        .reduce((sum, s) => sum + (Number(s.convertedAmount ?? s.amount) || 0), 0),
    [filteredSales],
  );

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      await api.deleteReport(confirmDeleteId);
      await onRefreshReports(fromDate || undefined, toDate || undefined, selectedCurrency);
      setStatusMsg(`تم حذف الفاتورة #${confirmDeleteId}`);
      setConfirmDeleteId(null);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, 'حذف فاتورة مبيعات');
      setConfirmDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleExportSalesCsv = () => {
    downloadCsv(
      `sales-report-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'التسلسل',
        'اسم المشتري',
        'طريقة الدفع',
        'الحالة',
        'الأصناف',
        'الخصم %',
        'المبلغ الأصلي',
        'عملة الفاتورة',
        `المبلغ المحول (${dispSymbol})`,
        'الموظف',
        'التاريخ',
      ],
      filteredSales.map((s) => [
        s.id,
        s.name,
        s.paymentMethod || 'cash',
        s.status || 'completed',
        s.item,
        s.discount,
        s.amount,
        s.currencyCode || site.currencyCode,
        s.convertedAmount ?? s.amount,
        s.adminName,
        s.date,
      ]),
    );
  };

  const handleExportInventoryCsv = () => {
    if (!reports) return;
    downloadCsv(
      `inventory-valuation-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'معرف التصنيف',
        'التصنيف',
        'عدد الأصناف',
        'إجمالي الوحدات',
        `التقييم بالتكلفة (${dispSymbol})`,
        `التقييم بسعر البيع (${dispSymbol})`,
      ],
      reports.inventoryByCategory.map((c) => [
        c.id,
        c.name,
        c.count,
        c.totalUnits,
        (c.totalCostValue || 0).toFixed(2),
        c.totalValue.toFixed(2),
      ]),
    );
  };

  if (!reports) {
    return (
      <div className="rounded border border-[#DCE4F0] bg-white p-8 text-center text-slate-500">
        جاري تحميل التقارير...
      </div>
    );
  }

  const totalAlerts =
    reports.alerts.outOfStock.length +
    reports.alerts.lowStock.length +
    reports.alerts.expired.length +
    reports.alerts.expiringSoon.length;

  const salesTableBlock = (forPrint = false) => (
    <div className="overflow-x-auto rounded border border-slate-200">
      <table className="w-full border-collapse text-right text-sm">
        <thead className="bg-slate-100 text-slate-700">
          <tr>
            <th className="border-b border-slate-200 px-3 py-2.5">#</th>
            <th className="border-b border-slate-200 px-3 py-2.5">المشتري</th>
            <th className="border-b border-slate-200 px-3 py-2.5">الدفع والحالة</th>
            <th className="border-b border-slate-200 px-3 py-2.5">الأصناف</th>
            <th className="border-b border-slate-200 px-3 py-2.5">المبلغ المستحق</th>
            <th className="border-b border-slate-200 px-3 py-2.5">الموظف</th>
            <th className="border-b border-slate-200 px-3 py-2.5">التاريخ</th>
            {!forPrint && <th className="no-print border-b border-slate-200 px-3 py-2.5">إجراء</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {filteredSales.length === 0 ? (
            <tr>
              <td colSpan={forPrint ? 7 : 8} className="px-4 py-10 text-center text-slate-500">
                لا توجد فواتير مطابقة.
              </td>
            </tr>
          ) : (
            filteredSales.map((row) => {
              const rowSymbol = row.currencySymbol || site.currencySymbol;
              const isCancelled = row.status === 'cancelled';
              return (
                <tr key={row.id} className={isCancelled ? 'bg-red-50/40 opacity-75' : 'hover:bg-sky-50/40'}>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500">#{row.id}</td>
                  <td className="px-3 py-2.5">
                    <div className="font-bold text-slate-800">{row.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{row.contact || '-'}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-semibold">
                      {row.paymentMethod === 'card'
                        ? 'بطاقة'
                        : row.paymentMethod === 'credit'
                          ? 'آجل'
                          : row.paymentMethod === 'partial'
                            ? 'جزئي'
                            : 'نقدي'}
                    </span>
                    {isCancelled && (
                      <span className="mr-1 rounded bg-red-100 px-1.5 py-0.5 font-bold text-red-700">ملغاة</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">{row.item}</td>
                  <td className="px-3 py-2.5 font-bold text-emerald-700">
                    <div>
                      {formatMoney(
                        row.convertedAmount !== undefined ? row.convertedAmount : row.amount,
                        row.convertedCurrencySymbol || dispSymbol,
                      )}
                    </div>
                    {(row.currencyCode || site.currencyCode) !== dispCode && (
                      <div className="text-[11px] font-normal text-indigo-700">
                        الأصل: {formatMoney(row.amount, rowSymbol)}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-800">
                      {row.adminName}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-500" dir="ltr">
                    {row.date}
                  </td>
                  {!forPrint && (
                    <td className="no-print px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelectedInvoice(row)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          التفاصيل
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(row.id)}
                            title="حذف الفاتورة"
                            className="rounded bg-red-600 p-1.5 text-white hover:bg-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  const inventoryTableBlock = (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full border-collapse text-right text-sm">
          <thead className="bg-slate-100 text-slate-700">
            <tr>
              <th className="border-b px-3 py-2.5">#</th>
              <th className="border-b px-3 py-2.5">الصورة</th>
              <th className="border-b px-3 py-2.5">التصنيف</th>
              <th className="border-b px-3 py-2.5">الأصناف</th>
              <th className="border-b px-3 py-2.5">الوحدات بالمخزن</th>
              <th className="border-b px-3 py-2.5">التقييم بالتكلفة</th>
              <th className="border-b px-3 py-2.5">القيمة بسعر البيع</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {reports.inventoryByCategory.map((cat) => (
              <tr key={cat.id} className="hover:bg-sky-50/40">
                <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{cat.id}</td>
                <td className="px-3 py-2.5">
                  <img
                    src={resolvePhotoSrc(cat.pic, 'cap.png')}
                    alt={cat.name}
                    className="h-9 w-9 rounded border border-slate-200 object-cover"
                  />
                </td>
                <td className="px-3 py-2.5 font-bold text-slate-800">{cat.name}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                    {cat.count}
                  </span>
                </td>
                <td className="px-3 py-2.5 font-bold text-slate-800">{cat.totalUnits}</td>
                <td className="px-3 py-2.5 font-semibold text-slate-600">
                  {formatMoney(cat.totalCostValue || 0, dispSymbol)}
                </td>
                <td className="px-3 py-2.5 font-bold text-emerald-700">
                  {formatMoney(cat.totalValue, dispSymbol)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reports.stagnantItems && reports.stagnantItems.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50/40 p-3">
          <h4 className="mb-2 text-sm font-bold text-amber-900">
            الأدوية الراكدة (لم تُبع خلال آخر 30 يوماً - {reports.stagnantItems.length} صنف)
          </h4>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {reports.stagnantItems.slice(0, 9).map((st) => (
              <div key={st.id} className="flex justify-between rounded border bg-white px-3 py-2 text-xs">
                <span className="font-bold">{st.name}</span>
                <span className="text-slate-600">الرصيد: {st.quantity}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const alertsBlock = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="rounded border border-red-200 bg-red-50/50 p-4">
        <h3 className="mb-2 flex items-center gap-1.5 font-bold text-red-800">
          <AlertTriangle className="h-4 w-4" />
          <span>أدوية نفدت من المخزون ({reports.alerts.outOfStock.length})</span>
        </h3>
        {reports.alerts.outOfStock.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد أدوية نافدة حالياً.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {reports.alerts.outOfStock.map((m) => (
              <li key={m.id} className="flex justify-between rounded bg-white px-3 py-1.5 shadow-xs">
                <span className="font-semibold">{m.name}</span>
                <span className="font-bold text-red-700">الرصيد: 0</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded border border-amber-200 bg-amber-50/50 p-4">
        <h3 className="mb-2 flex items-center gap-1.5 font-bold text-amber-800">
          <AlertTriangle className="h-4 w-4" />
          <span>مخزون منخفض ({reports.alerts.lowStock.length})</span>
        </h3>
        {reports.alerts.lowStock.length === 0 ? (
          <p className="text-xs text-slate-500">جميع الأرصدة فوق الحد الأدنى.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {reports.alerts.lowStock.map((m) => (
              <li key={m.id} className="flex justify-between rounded bg-white px-3 py-1.5 shadow-xs">
                <span className="font-semibold">{m.name}</span>
                <span className="font-bold text-amber-700">
                  الرصيد: {m.quantity} (الحد {m.minStock})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded border border-red-200 bg-red-50/50 p-4">
        <h3 className="mb-2 flex items-center gap-1.5 font-bold text-red-800">
          <Clock className="h-4 w-4" />
          <span>تشغيلات منتهية الصلاحية ({reports.alerts.expired.length})</span>
        </h3>
        {reports.alerts.expired.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد تشغيلات منتهية الصلاحية.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {reports.alerts.expired.map((m, idx) => (
              <li key={`${m.id}-${idx}`} className="flex justify-between rounded bg-white px-3 py-1.5 shadow-xs">
                <span className="font-semibold">
                  {m.name} ({m.batchNumber})
                </span>
                <span className="font-mono text-xs font-bold text-red-700" dir="ltr">
                  {m.expiryDate}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded border border-amber-200 bg-amber-50/50 p-4">
        <h3 className="mb-2 flex items-center gap-1.5 font-bold text-amber-800">
          <Clock className="h-4 w-4" />
          <span>تشغيلات قريبة الانتهاء خلال 30 يوماً ({reports.alerts.expiringSoon.length})</span>
        </h3>
        {reports.alerts.expiringSoon.length === 0 ? (
          <p className="text-xs text-slate-500">لا توجد تشغيلات قريبة الانتهاء.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {reports.alerts.expiringSoon.map((m, idx) => (
              <li key={`${m.id}-${idx}`} className="flex justify-between rounded bg-white px-3 py-1.5 shadow-xs">
                <span className="font-semibold">
                  {m.name} ({m.batchNumber})
                </span>
                <span className="text-xs font-bold text-amber-700">
                  متبقي {m.daysLeft} يوم ({m.expiryDate})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const reportTitle =
    tab === 'sales'
      ? 'تقرير المبيعات والمرتجعات'
      : tab === 'purchases'
        ? 'تقرير المشتريات والتوريدات'
        : tab === 'profit'
          ? 'تقرير الأرباح وأداء الموظفين'
          : tab === 'inventory'
            ? 'تقرير تقييم المخزون والأصناف الراكدة'
            : tab === 'audit'
              ? 'سجل التدقيق والرقابة'
              : 'تقرير تنبيهات المخزون والصلاحية';

  return (
    <div className="space-y-5">
      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border-t-4 border-t-[#0B4F9C] bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">صافي الإيرادات (بعد المرتجع)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">
            {formatMoney(reports.summary.netRevenue ?? filteredRevenue, dispSymbol)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            فواتير: {reports.summary.totalInvoices} • مرتجعات:{' '}
            {formatMoney(reports.summary.totalSalesReturns || 0, dispSymbol)}
          </div>
        </div>
        <div className="rounded border-t-4 border-t-emerald-600 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">مجمل الربح (Gross Profit)</div>
          <div className="mt-1 text-2xl font-bold text-[#145632]">
            {formatMoney(reports.summary.grossProfit || 0, dispSymbol)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            تكلفة المبيعات: {formatMoney(reports.summary.totalCogs || 0, dispSymbol)}
          </div>
        </div>
        <div className="rounded border-t-4 border-t-indigo-600 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">المشتريات والذمم</div>
          <div className="mt-1 text-xl font-bold text-slate-800">
            {formatMoney(reports.summary.totalPurchases || 0, dispSymbol)}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            لنا (العملاء): {formatMoney(reports.summary.totalReceivables || 0, dispSymbol)} | علينا (الموردين):{' '}
            {formatMoney(reports.summary.totalPayables || 0, dispSymbol)}
          </div>
        </div>
        <div className="rounded border-t-4 border-t-amber-500 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">تنبيهات المخزون والتشغيلات</div>
          <div className="mt-1 text-2xl font-bold text-amber-700">{totalAlerts}</div>
          <div className="mt-1 text-[11px] text-slate-500">تشغيلات نشطة: {reports.summary.activeBatches || 0}</div>
        </div>
      </div>

      {/* Main Reports Panel */}
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">التقارير والتحليلات المالية والتشغيلية</h1>
          </div>
          <div className="no-print flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setTab('sales')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ${
                tab === 'sales' ? 'bg-[#0B4F9C] text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>المبيعات</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('purchases')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ${
                tab === 'purchases' ? 'bg-[#0B4F9C] text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              <span>المشتريات</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('profit')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ${
                tab === 'profit' ? 'bg-[#0B4F9C] text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              <TrendingUp className="h-3.5 w-3.5" />
              <span>الأرباح والموظفين</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('inventory')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ${
                tab === 'inventory' ? 'bg-[#0B4F9C] text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              <span>تقييم المخزون</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('alerts')}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ${
                tab === 'alerts' ? 'bg-amber-600 text-white' : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>التنبيهات ({totalAlerts})</span>
            </button>
            {canAudit && (
              <button
                type="button"
                onClick={() => setTab('audit')}
                className={`inline-flex items-center gap-1 rounded px-2.5 py-1.5 text-xs font-semibold ${
                  tab === 'audit' ? 'bg-slate-800 text-white' : 'border border-slate-300 bg-white text-slate-700'
                }`}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                <span>سجل التدقيق</span>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4 p-4">
          {statusMsg && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {statusMsg}
            </div>
          )}

          {availableCurrencies.length > 1 && (
            <div className="no-print flex flex-wrap items-center justify-between gap-2 rounded border border-indigo-200 bg-indigo-50/50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2 font-bold text-indigo-900">
                <span>عملة عرض التقارير:</span>
                <select
                  value={selectedCurrency}
                  onChange={(e) => {
                    const next = e.target.value;
                    setSelectedCurrency(next);
                    void onRefreshReports(fromDate || undefined, toDate || undefined, next).catch((err) =>
                      showErrorPopup(err, 'تغيير عملة عرض التقارير'),
                    );
                  }}
                  className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800"
                >
                  {availableCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.symbol} / {c.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="text-indigo-800">
                {site.autoConvertCurrencies
                  ? `التحويل التلقائي للعملات مفعّل (سعر الصرف: ${dispCurrInfo.rateToBase} ${dispSymbol} / 1 ${site.currencySymbol})`
                  : `العرض الحالي بعملة ${dispCurrInfo.name} (${dispSymbol})`}
              </div>
            </div>
          )}

          {tab === 'sales' && (
            <div className="space-y-4">
              <div className="no-print flex flex-wrap items-end justify-between gap-3 rounded border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">بحث نصي</label>
                    <div className="relative w-56">
                      <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="مشتري، موظف، رقم..."
                        className="w-full rounded border border-slate-300 bg-white py-1.5 pr-9 pl-3 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">من تاريخ</label>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        setFromDate(e.target.value);
                        void onRefreshReports(
                          e.target.value || undefined,
                          toDate || undefined,
                          selectedCurrency,
                        ).catch((err) => showErrorPopup(err, 'تحديث تقارير المبيعات حسب التاريخ'));
                      }}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">إلى تاريخ</label>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => {
                        setToDate(e.target.value);
                        void onRefreshReports(
                          fromDate || undefined,
                          e.target.value || undefined,
                          selectedCurrency,
                        ).catch((err) => showErrorPopup(err, 'تحديث تقارير المبيعات حسب التاريخ'));
                      }}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExportSalesCsv}
                    className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <Download className="h-4 w-4" />
                    <span>تصدير CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewTarget('report')}
                    className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f4126]"
                  >
                    <Maximize2 className="h-4 w-4" />
                    <span>عرض بشاشة كاملة قبل الطباعة</span>
                  </button>
                </div>
              </div>

              {salesTableBlock(false)}
            </div>
          )}

          {tab === 'purchases' && (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setPreviewTarget('report')}
                  className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white"
                >
                  <Maximize2 className="h-4 w-4" />
                  <span>عرض بشاشة كاملة قبل الطباعة</span>
                </button>
              </div>
              <table className="w-full border-collapse rounded border border-slate-200 text-right text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border-b px-3 py-2">#</th>
                    <th className="border-b px-3 py-2">رقم الفاتورة</th>
                    <th className="border-b px-3 py-2">المورد</th>
                    <th className="border-b px-3 py-2">الشحن</th>
                    <th className="border-b px-3 py-2">الإجمالي</th>
                    <th className="border-b px-3 py-2">المدفوع</th>
                    <th className="border-b px-3 py-2">التاريخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {reports.purchases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                        لا توجد فواتير توريد مستلمة في هذه الفترة.
                      </td>
                    </tr>
                  ) : (
                    reports.purchases.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 font-mono">#{p.id}</td>
                        <td className="px-3 py-2 font-mono">{p.invoice_number}</td>
                        <td className="px-3 py-2 font-bold">{p.supplier_name}</td>
                        <td className="px-3 py-2">{formatMoney(p.shipping_cost, dispSymbol)}</td>
                        <td className="px-3 py-2 font-bold text-slate-800">
                          {formatMoney(p.total_amount, dispSymbol)}
                        </td>
                        <td className="px-3 py-2 text-emerald-700">{formatMoney(p.paid_amount, dispSymbol)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{p.received_at || p.created_at}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'profit' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setPreviewTarget('report')}
                  className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white"
                >
                  <Maximize2 className="h-4 w-4" />
                  <span>عرض بشاشة كاملة قبل الطباعة</span>
                </button>
              </div>
              <h3 className="font-bold text-slate-800">أداء الموظفين والمبيعات حسب المستخدم</h3>
              <table className="w-full border-collapse rounded border border-slate-200 text-right text-sm">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border-b px-3 py-2">الموظف</th>
                    <th className="border-b px-3 py-2">الدور الوظيفي</th>
                    <th className="border-b px-3 py-2">عدد الفواتير المكتملة</th>
                    <th className="border-b px-3 py-2">إجمالي المبيعات ({dispSymbol})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {reports.employeePerformance.map((ep) => (
                    <tr key={ep.id}>
                      <td className="px-3 py-2 font-bold">{ep.name}</td>
                      <td className="px-3 py-2 text-xs">{ROLE_LABELS[ep.role as keyof typeof ROLE_LABELS] || ep.role}</td>
                      <td className="px-3 py-2 font-bold">{ep.invoiceCount}</td>
                      <td className="px-3 py-2 font-bold text-emerald-700">
                        {formatMoney(ep.totalSales, dispSymbol)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'inventory' && (
            <div className="space-y-3">
              <div className="no-print flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={handleExportInventoryCsv}
                  className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" />
                  <span>تصدير CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTarget('report')}
                  className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f4126]"
                >
                  <Maximize2 className="h-4 w-4" />
                  <span>عرض بشاشة كاملة قبل الطباعة</span>
                </button>
              </div>
              {inventoryTableBlock}
            </div>
          )}

          {tab === 'alerts' && (
            <div className="space-y-3">
              <div className="no-print flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewTarget('report')}
                  className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f4126]"
                >
                  <Maximize2 className="h-4 w-4" />
                  <span>عرض بشاشة كاملة قبل الطباعة</span>
                </button>
              </div>
              {alertsBlock}
            </div>
          )}

          {tab === 'audit' && canAudit && (
            <div className="overflow-x-auto rounded border border-slate-200">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border-b px-3 py-2">#</th>
                    <th className="border-b px-3 py-2">المستخدم</th>
                    <th className="border-b px-3 py-2">الإجراء</th>
                    <th className="border-b px-3 py-2">السجل</th>
                    <th className="border-b px-3 py-2">التفاصيل</th>
                    <th className="border-b px-3 py-2">الوقت</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {auditLogs.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-mono">{l.id}</td>
                      <td className="px-3 py-2 font-bold">{l.user_name}</td>
                      <td className="px-3 py-2 font-mono">{l.action}</td>
                      <td className="px-3 py-2">{l.entity_type}</td>
                      <td className="px-3 py-2">{l.details}</td>
                      <td className="px-3 py-2 font-mono" dir="ltr">
                        {l.created_at}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded border border-slate-300 bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-bold">
                تفاصيل الفاتورة #{selectedInvoice.id} — {selectedInvoice.name}
              </h3>
              <span className="font-mono text-xs text-slate-500" dir="ltr">
                {selectedInvoice.date}
              </span>
            </div>
            <div className="mb-3 grid grid-cols-2 gap-2 rounded bg-slate-50 p-2.5 text-xs">
              <div>
                الهاتف: <span className="font-mono">{selectedInvoice.contact || '-'}</span>
              </div>
              <div>
                الموظف: <span className="font-bold">{selectedInvoice.adminName}</span>
              </div>
              <div>
                الخصم: <span className="font-bold text-amber-700">{selectedInvoice.discount}%</span>
              </div>
              <div>
                الإجمالي النهائي:{' '}
                <span className="font-bold text-emerald-700">
                  {formatMoney(selectedInvoice.amount, selectedInvoice.currencySymbol || site.currencySymbol)}
                </span>
                {selectedInvoice.convertedAmount !== undefined &&
                  (selectedInvoice.currencyCode || site.currencyCode) !== dispCode && (
                    <div className="text-[11px] text-indigo-700">
                      المكافئ المحول ({dispCode}):{' '}
                      <strong>{formatMoney(selectedInvoice.convertedAmount, dispSymbol)}</strong>
                    </div>
                  )}
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {selectedInvoice.itemsDetail.length === 0 ? (
                <p className="text-center text-xs text-slate-500">لا توجد بنود تفصيلية مسجلة.</p>
              ) : (
                selectedInvoice.itemsDetail.map((it, idx) => (
                  <div key={`${it.id}-${idx}`} className="flex justify-between border-b border-slate-100 pb-1">
                    <span>
                      {it.name} ({it.saleUnit || it.unit}) × {it.qty}
                    </span>
                    <span className="font-bold">
                      {formatMoney(it.price * it.qty, selectedInvoice.currencySymbol || site.currencySymbol)}
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="no-print mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setPreviewTarget('invoice')}
                className="inline-flex items-center gap-1 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f4126]"
              >
                <Maximize2 className="h-4 w-4" />
                <span>عرض بشاشة كاملة قبل الطباعة</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAutoPrintInvoice(true);
                  setPreviewTarget('invoice');
                }}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700"
              >
                <Printer className="h-4 w-4" />
                <span>طباعة</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="rounded bg-[#0B4F9C] px-4 py-1.5 text-sm font-semibold text-white"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Full-Screen Print Preview Modal */}
      <PrintPreviewModal
        open={previewTarget !== null}
        title={
          previewTarget === 'invoice' && selectedInvoice
            ? `تفاصيل الفاتورة #${selectedInvoice.id} — ${selectedInvoice.name}`
            : reportTitle
        }
        site={site}
        allowReceiptMode={previewTarget === 'invoice'}
        defaultPaperMode="a4"
        autoPrint={previewTarget === 'invoice' && autoPrintInvoice}
        onAutoPrintDone={() => setAutoPrintInvoice(false)}
        onClose={() => {
          setAutoPrintInvoice(false);
          setPreviewTarget(null);
        }}
      >
        {previewTarget === 'invoice' && selectedInvoice ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded bg-slate-50 p-3 text-xs">
              <div>
                المشتري: <span className="font-bold">{selectedInvoice.name}</span>
              </div>
              <div>
                الهاتف: <span className="font-mono">{selectedInvoice.contact || '-'}</span>
              </div>
              <div>
                الموظف: <span className="font-bold">{selectedInvoice.adminName}</span>
              </div>
              <div>
                التاريخ:{' '}
                <span className="font-mono" dir="ltr">
                  {selectedInvoice.date}
                </span>
              </div>
            </div>
            <table className="w-full border-collapse text-right text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-200 px-3 py-2">الدواء</th>
                  <th className="border border-slate-200 px-3 py-2">السعر</th>
                  <th className="border border-slate-200 px-3 py-2">الكمية</th>
                  <th className="border border-slate-200 px-3 py-2">المجموع</th>
                </tr>
              </thead>
              <tbody>
                {selectedInvoice.itemsDetail.map((it, idx) => (
                  <tr key={`${it.id}-${idx}`}>
                    <td className="border border-slate-200 px-3 py-2 font-semibold">
                      {it.name} ({it.saleUnit || it.unit})
                    </td>
                    <td className="border border-slate-200 px-3 py-2">
                      {formatMoney(it.price, selectedInvoice.currencySymbol || site.currencySymbol)}
                    </td>
                    <td className="border border-slate-200 px-3 py-2">{it.qty}</td>
                    <td className="border border-slate-200 px-3 py-2 font-bold">
                      {formatMoney(it.price * it.qty, selectedInvoice.currencySymbol || site.currencySymbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 font-bold">
              <span>الخصم: {selectedInvoice.discount}%</span>
              <div className="text-right">
                <span className="text-emerald-700">
                  الإجمالي النهائي:{' '}
                  {formatMoney(selectedInvoice.amount, selectedInvoice.currencySymbol || site.currencySymbol)}
                </span>
                {selectedInvoice.convertedAmount !== undefined &&
                  (selectedInvoice.currencyCode || site.currencyCode) !== dispCode && (
                    <div className="text-xs font-semibold text-indigo-700">
                      المكافئ المحول تلقائياً ({dispCode}):{' '}
                      {formatMoney(selectedInvoice.convertedAmount, dispSymbol)}
                    </div>
                  )}
              </div>
            </div>
          </div>
        ) : tab === 'sales' ? (
          salesTableBlock(true)
        ) : tab === 'inventory' ? (
          inventoryTableBlock
        ) : (
          alertsBlock
        )}
      </PrintPreviewModal>

      <ConfirmModal
        open={confirmDeleteId !== null}
        title="تأكيد حذف الفاتورة"
        message={`هل أنت متأكد من حذف الفاتورة رقم #${confirmDeleteId ?? ''} من سجل المبيعات؟`}
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
};
