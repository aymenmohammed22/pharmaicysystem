import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Warehouse as WarehouseIcon,
  Plus,
  ArrowLeftRight,
  ClipboardCheck,
  History,
  CheckCircle2,
  Package,
  Printer,
  ShieldAlert,
  Search,
  RefreshCw,
} from 'lucide-react';
import { api } from '../api';
import type {
  InventoryItem,
  MedicineBatch,
  SiteSettings,
  StockCountRecord,
  StockMovement,
  StockTransfer,
  User,
  Warehouse,
} from '../types';
import { formatMoney, getExpiryStatus, hasPermission } from '../types';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { showErrorPopup, validationError } from '../lib/errorPopup';

interface WarehousesPageProps {
  user: User;
  site: SiteSettings;
  inventories: InventoryItem[];
  onInventoryMutated: () => Promise<void>;
}

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening: 'رصيد افتتاحي',
  purchase_in: 'توريد مشتريات',
  purchase_return: 'مرتجع لمورد',
  sale_out: 'صرف مبيعات',
  sale_return: 'مرتجع مبيعات',
  sale_cancel: 'إلغاء فاتورة بيع',
  transfer_in: 'تحويل وارد',
  transfer_out: 'تحويل صادر',
  stocktake: 'تسوية جرد',
  damaged: 'إتلاف',
  damaged_writeoff: 'شطب تالف',
  lost: 'فاقد / عجز',
  expired: 'منتهي الصلاحية',
  quarantine: 'عزل حجر صحي',
};

const ADJUSTMENT_LABELS: Record<string, string> = {
  stocktake: 'جرد دوري وتطابق فعلي',
  damaged: 'تالف / كسر عبوة',
  expired: 'منتهي الصلاحية (إعدام)',
  lost: 'عجز / مفقود',
};

export const WarehousesPage: React.FC<WarehousesPageProps> = ({
  user,
  site,
  inventories,
  onInventoryMutated,
}) => {
  const [tab, setTab] = useState<'warehouses' | 'batches' | 'transfers' | 'stocktake' | 'movements' | 'stagnant'>('warehouses');
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');

  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [counts, setCounts] = useState<StockCountRecord[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [stagnantItems, setStagnantItems] = useState<Array<Record<string, unknown>>>([]);
  const [stagnantDays, setStagnantDays] = useState(30);

  // Filters
  const [selectedWarehouseFilter, setSelectedWarehouseFilter] = useState<number>(0);
  const [batchSearch, setBatchSearch] = useState('');
  const [movementMedId, setMovementMedId] = useState<number>(0);

  // Create Warehouse Modal/Form
  const [newWhName, setNewWhName] = useState('');
  const [newWhType, setNewWhType] = useState<'main' | 'branch'>('branch');
  const [newWhLocation, setNewWhLocation] = useState('');
  const [savingWh, setSavingWh] = useState(false);

  // Create Transfer Form
  const [fromWhId, setFromWhId] = useState<number>(0);
  const [toWhId, setToWhId] = useState<number>(0);
  const [transferNotes, setTransferNotes] = useState('');
  const [transferItems, setTransferItems] = useState<Array<{ medicineId: number; qty: number }>>([
    { medicineId: 0, qty: 1 },
  ]);
  const [savingTransfer, setSavingTransfer] = useState(false);

  // Create Stock Count / Adjustment Form
  const [adjBatchId, setAdjBatchId] = useState<number>(0);
  const [adjCountedQty, setAdjCountedQty] = useState<string>('0');
  const [adjType, setAdjType] = useState<string>('stocktake');
  const [adjReason, setAdjReason] = useState('');
  const [savingCount, setSavingCount] = useState(false);

  // Print Preview
  const [previewOpen, setPreviewOpen] = useState(false);

  const canApproveTransfer = hasPermission(user, 'approveTransfers');
  const canManageBatches = hasPermission(user, 'manageBatches');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [whRes, batchRes, trRes, cntRes, movRes, stagRes] = await Promise.all([
        api.getWarehouses(),
        api.getBatches(),
        api.getTransfers(),
        api.getStockCounts(),
        api.getStockMovements(movementMedId || undefined),
        api.getStagnantItems(stagnantDays),
      ]);
      setWarehouses(whRes.warehouses);
      setBatches(batchRes.batches);
      setTransfers(trRes.transfers);
      setCounts(cntRes.counts);
      setMovements(movRes.movements);
      setStagnantItems(stagRes.stagnant);
      setFromWhId((prev) =>
        whRes.warehouses.some((w) => w.id === prev) ? prev : (whRes.warehouses[0]?.id ?? 0),
      );
      setToWhId((prev) => {
        if (whRes.warehouses.length < 2) return 0;
        if (whRes.warehouses.some((w) => w.id === prev)) return prev;
        return whRes.warehouses[1].id;
      });
    } catch (err) {
      showErrorPopup(err, 'تحميل بيانات المستودعات والمخزون');
    } finally {
      setLoading(false);
    }
  }, [movementMedId, stagnantDays]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhName.trim()) {
      validationError('يرجى إدخال اسم المستودع أو الفرع.', 'إضافة مستودع أو فرع');
      return;
    }
    setSavingWh(true);
    setStatusMsg('');
    try {
      await api.createWarehouse({ name: newWhName.trim(), type: newWhType, location: newWhLocation.trim() });
      setNewWhName('');
      setNewWhLocation('');
      setStatusMsg('تم إنشاء المستودع بنجاح');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'إنشاء مستودع أو فرع');
    } finally {
      setSavingWh(false);
    }
  };

  const handleBatchStatusChange = async (
    batchId: number,
    status: 'active' | 'quarantined' | 'expired' | 'damaged',
  ) => {
    setStatusMsg('');
    try {
      await api.updateBatchStatus(batchId, status, `تغيير حالة التشغيلة من إدارة المستودعات إلى ${status}`);
      setStatusMsg('تم تحديث حالة التشغيلة ومزامنة الأرصدة بنجاح');
      await Promise.all([loadAll(), onInventoryMutated()]);
    } catch (err) {
      showErrorPopup(err, 'تحديث حالة التشغيلة');
    }
  };

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (warehouses.length < 2) {
      validationError('يجب وجود مستودعين مختلفين على الأقل لإجراء تحويل مخزني.', 'إنشاء تحويل مخزني');
      return;
    }
    const validItems = transferItems.filter((it) => it.medicineId > 0 && it.qty > 0);
    if (!fromWhId || !toWhId || fromWhId === toWhId) {
      validationError('يرجى اختيار مخزن مصدر ومخزن وجهة مختلفين.', 'إنشاء تحويل مخزني');
      return;
    }
    if (validItems.length === 0) {
      validationError('يرجى إضافة صنف واحد بكمية صحيحة على الأقل.', 'إنشاء تحويل مخزني');
      return;
    }
    setSavingTransfer(true);
    setStatusMsg('');
    try {
      await api.createTransfer({
        fromWarehouseId: fromWhId,
        toWarehouseId: toWhId,
        notes: transferNotes.trim(),
        items: validItems,
      });
      setTransferNotes('');
      setTransferItems([{ medicineId: inventories[0]?.id || 0, qty: 1 }]);
      setStatusMsg('تم تسجيل طلب التحويل المخزني بنجاح (بانتظار الاعتماد)');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'إنشاء طلب تحويل مخزني');
    } finally {
      setSavingTransfer(false);
    }
  };

  const handleApproveTransfer = async (id: number) => {
    try {
      await api.approveTransfer(id);
      setStatusMsg(`تم اعتماد التحويل المخزني #${id}`);
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'اعتماد التحويل المخزني');
    }
  };

  const handleReceiveTransfer = async (id: number) => {
    try {
      await api.receiveTransfer(id);
      setStatusMsg(`تم استلام التحويل المخزني #${id} ونقل التشغيلات للمخزن المستلم`);
      await Promise.all([loadAll(), onInventoryMutated()]);
    } catch (err) {
      showErrorPopup(err, 'استلام التحويل المخزني');
    }
  };

  const handleStockCountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjBatchId) {
      validationError('يرجى اختيار التشغيلة المراد جردها أو تسويتها.', 'اعتماد الجرد والتسوية');
      return;
    }
    const countedNum = Number(adjCountedQty);
    if (!Number.isFinite(countedNum) || countedNum < 0) {
      validationError('الكمية الفعلية يجب أن تكون رقماً صحيحاً غير سالب.', 'اعتماد الجرد والتسوية');
      return;
    }
    setSavingCount(true);
    setStatusMsg('');
    try {
      const res = await api.createStockCount({
        batchId: adjBatchId,
        countedQty: countedNum,
        adjustmentType: adjType,
        reason: adjReason.trim() || ADJUSTMENT_LABELS[adjType] || 'تسوية جرد',
      });
      setAdjReason('');
      setStatusMsg(`تم اعتماد الجرد والتسوية (الفارق: ${res.variance > 0 ? `+${res.variance}` : res.variance})`);
      await Promise.all([loadAll(), onInventoryMutated()]);
    } catch (err) {
      showErrorPopup(err, 'تسجيل الجرد والتسوية المخزنية');
    } finally {
      setSavingCount(false);
    }
  };

  const filteredBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    return batches.filter((b) => {
      if (selectedWarehouseFilter && b.warehouse_id !== selectedWarehouseFilter) return false;
      if (!q) return true;
      return (
        (b.medicine_name || '').toLowerCase().includes(q) ||
        b.batch_number.toLowerCase().includes(q) ||
        (b.supplier_name || '').toLowerCase().includes(q)
      );
    });
  }, [batches, selectedWarehouseFilter, batchSearch]);

  const selectedBatchForCount = useMemo(
    () => batches.find((b) => b.id === adjBatchId) || null,
    [batches, adjBatchId],
  );

  const totalUnitsAll = warehouses.reduce((s, w) => s + Number(w.totalUnits || 0), 0);
  const totalCostAll = warehouses.reduce((s, w) => s + Number(w.costValuation || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">المستودعات والمخزون والتحويلات</span>
          <span className="mx-1">/</span>
          <span>الفروع والتشغيلات والجرد وحركة الصنف والراكد</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>تحديث</span>
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="inline-flex items-center gap-1 rounded bg-[#0B4F9C] px-3 py-1 text-xs font-semibold text-white hover:bg-[#2c698d]"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>معاينة شاشة كاملة قبل الطباعة</span>
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="text-xs text-slate-500">عدد المستودعات / الفروع</div>
          <div className="mt-1 text-xl font-bold text-[#145632]">{warehouses.length}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="text-xs text-slate-500">إجمالي الوحدات النشطة</div>
          <div className="mt-1 text-xl font-bold text-[#0B4F9C]">{totalUnitsAll.toFixed(0)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="text-xs text-slate-500">التقييم المخزني بالتكلفة</div>
          <div className="mt-1 text-xl font-bold text-slate-800">{formatMoney(totalCostAll, site.currencySymbol)}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
          <div className="text-xs text-slate-500">التحويلات قيد الانتظار/الاعتماد</div>
          <div className="mt-1 text-xl font-bold text-amber-700">
            {transfers.filter((t) => t.status !== 'received').length}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded border border-slate-300 bg-white p-2 shadow-sm">
        {[
          { key: 'warehouses', label: 'المستودعات والفروع', icon: WarehouseIcon },
          { key: 'batches', label: 'أرصدة التشغيلات والصلاحية', icon: Package },
          { key: 'transfers', label: 'التحويلات المخزنية', icon: ArrowLeftRight },
          { key: 'stocktake', label: 'الجرد والتالف والفاقد', icon: ClipboardCheck },
          { key: 'movements', label: 'كرت حركة الصنف', icon: History },
          { key: 'stagnant', label: 'الأصناف الراكدة', icon: ShieldAlert },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as typeof tab)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold transition-colors ${
                active ? 'bg-[#0B4F9C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          جاري تحميل بيانات المستودعات...
        </div>
      ) : (
        <>
          {/* Tab 1: Warehouses */}
          {tab === 'warehouses' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  قائمة المستودعات والفروع والتقييم المالي
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-3 py-2">#</th>
                        <th className="border border-slate-300 px-3 py-2">اسم المستودع / الفرع</th>
                        <th className="border border-slate-300 px-3 py-2">النوع</th>
                        <th className="border border-slate-300 px-3 py-2">الموقع</th>
                        <th className="border border-slate-300 px-3 py-2">إجمالي الوحدات</th>
                        <th className="border border-slate-300 px-3 py-2">قيمة المخزون (بالتكلفة)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {warehouses.map((w) => (
                        <tr key={w.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-3 py-2">{w.id}</td>
                          <td className="border border-slate-200 px-3 py-2 font-bold text-slate-800">{w.name}</td>
                          <td className="border border-slate-200 px-3 py-2">
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                w.type === 'main' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {w.type === 'main' ? 'مستودع رئيسي' : 'فرع بيع'}
                            </span>
                          </td>
                          <td className="border border-slate-200 px-3 py-2 text-slate-600">{w.location || '—'}</td>
                          <td className="border border-slate-200 px-3 py-2 font-semibold">
                            {Number(w.totalUnits || 0).toFixed(0)}
                          </td>
                          <td className="border border-slate-200 px-3 py-2 font-bold text-[#145632]">
                            {formatMoney(Number(w.costValuation || 0), site.currencySymbol)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  إضافة مستودع أو فرع جديد
                </h3>
                <form noValidate onSubmit={handleCreateWarehouse} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">اسم المستودع / الفرع *</label>
                    <input
                      type="text"
                      required
                      value={newWhName}
                      onChange={(e) => setNewWhName(e.target.value)}
                      placeholder="مثال: فرع الشمال"
                      className="w-full rounded border border-slate-300 px-3 py-2 focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">النوع</label>
                    <select
                      value={newWhType}
                      onChange={(e) => setNewWhType(e.target.value as 'main' | 'branch')}
                      className="w-full rounded border border-slate-300 px-3 py-2 focus:border-[#0B4F9C] focus:outline-none"
                    >
                      <option value="branch">فرع صيدلية</option>
                      <option value="main">مستودع مركزي</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">الموقع / العنوان</label>
                    <input
                      type="text"
                      value={newWhLocation}
                      onChange={(e) => setNewWhLocation(e.target.value)}
                      placeholder="المدينة - الحي"
                      className="w-full rounded border border-slate-300 px-3 py-2 focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingWh}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    <span>{savingWh ? 'جاري الحفظ...' : 'إضافة المستودع'}</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Tab 2: Batches by Warehouse */}
          {tab === 'batches' && (
            <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-800">أرصدة التشغيلات (FEFO) حسب المستودع</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedWarehouseFilter}
                    onChange={(e) => setSelectedWarehouseFilter(Number(e.target.value))}
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-xs"
                  >
                    <option value={0}>كل المستودعات</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={batchSearch}
                      onChange={(e) => setBatchSearch(e.target.value)}
                      placeholder="بحث بالدواء أو رقم التشغيلة..."
                      className="rounded border border-slate-300 py-1.5 pr-8 pl-3 text-xs"
                    />
                  </div>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 px-2.5 py-2">الدواء</th>
                      <th className="border border-slate-300 px-2.5 py-2">المستودع</th>
                      <th className="border border-slate-300 px-2.5 py-2">رقم التشغيلة</th>
                      <th className="border border-slate-300 px-2.5 py-2">الانتهاء</th>
                      <th className="border border-slate-300 px-2.5 py-2">الرصيد المتبقي</th>
                      <th className="border border-slate-300 px-2.5 py-2">تكلفة الوحدة</th>
                      <th className="border border-slate-300 px-2.5 py-2">الحالة</th>
                      {canManageBatches && <th className="border border-slate-300 px-2.5 py-2">عزل / تحكم</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBatches.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                          لا توجد تشغيلات مطابقة
                        </td>
                      </tr>
                    ) : (
                      filteredBatches.map((b) => {
                        const expState = getExpiryStatus(b.expiry_date);
                        return (
                          <tr key={b.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-bold text-slate-800">
                              {b.medicine_name || `#${b.medicine_id}`}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{b.warehouse_name || `#${b.warehouse_id}`}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono">{b.batch_number}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <span
                                className={`font-semibold ${
                                  expState === 'expired'
                                    ? 'text-red-700'
                                    : expState === 'soon'
                                      ? 'text-amber-700'
                                      : 'text-emerald-700'
                                }`}
                              >
                                {b.expiry_date}
                              </span>
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">{b.qty_remaining}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {formatMoney(b.purchase_price, site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                  b.status === 'active'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : b.status === 'quarantined'
                                      ? 'bg-amber-100 text-amber-800'
                                      : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {b.status === 'active'
                                  ? 'نشطة'
                                  : b.status === 'quarantined'
                                    ? 'حجر صحي'
                                    : b.status === 'damaged'
                                      ? 'تالف'
                                      : 'منتهي'}
                              </span>
                            </td>
                            {canManageBatches && (
                              <td className="border border-slate-200 px-2.5 py-2">
                                <div className="flex flex-wrap gap-1">
                                  {b.status === 'active' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => void handleBatchStatusChange(b.id, 'quarantined')}
                                        className="rounded bg-amber-600 px-2 py-0.5 text-[11px] text-white hover:bg-amber-700"
                                      >
                                        حجر صحي
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => void handleBatchStatusChange(b.id, 'damaged')}
                                        className="rounded bg-red-600 px-2 py-0.5 text-[11px] text-white hover:bg-red-700"
                                      >
                                        تالف
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void handleBatchStatusChange(b.id, 'active')}
                                      className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] text-white hover:bg-emerald-700"
                                    >
                                      إعادة تنشيط
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
            </div>
          )}

          {/* Tab 3: Transfers */}
          {tab === 'transfers' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  إنشاء أمر تحويل مخزني بين الفروع
                </h3>
                <form noValidate onSubmit={handleCreateTransfer} className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-700">من مستودع</label>
                      <select
                        value={fromWhId}
                        onChange={(e) => setFromWhId(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 px-2 py-1.5"
                      >
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-700">إلى مستودع</label>
                      <select
                        value={toWhId}
                        onChange={(e) => setToWhId(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 px-2 py-1.5"
                      >
                        {warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold text-slate-700">الأصناف المطلوب تحويلها</span>
                      <button
                        type="button"
                        onClick={() =>
                          setTransferItems((prev) => [...prev, { medicineId: inventories[0]?.id || 0, qty: 1 }])
                        }
                        className="text-[11px] font-bold text-[#0B4F9C] hover:underline"
                      >
                        + إضافة سطر
                      </button>
                    </div>
                    <div className="space-y-2">
                      {transferItems.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-1.5">
                          <select
                            value={it.medicineId}
                            onChange={(e) =>
                              setTransferItems((prev) =>
                                prev.map((row, i) =>
                                  i === idx ? { ...row, medicineId: Number(e.target.value) } : row,
                                ),
                              )
                            }
                            className="flex-1 rounded border border-slate-300 px-2 py-1.5"
                          >
                            <option value={0}>اختر الدواء...</option>
                            {inventories.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} (متاح: {m.quantity})
                              </option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={it.qty}
                            onChange={(e) =>
                              setTransferItems((prev) =>
                                prev.map((row, i) => (i === idx ? { ...row, qty: Number(e.target.value) } : row)),
                              )
                            }
                            className="w-20 rounded border border-slate-300 px-2 py-1.5 text-center"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">ملاحظات</label>
                    <input
                      type="text"
                      value={transferNotes}
                      onChange={(e) => setTransferNotes(e.target.value)}
                      placeholder="سبب التحويل أو رقم التوصيل"
                      className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingTransfer}
                    className="w-full rounded bg-[#0B4F9C] py-2 font-bold text-white hover:bg-[#2b688c] disabled:opacity-60"
                  >
                    {savingTransfer ? 'جاري التسجيل...' : 'إرسال طلب التحويل'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل التحويلات المخزنية (طلب → اعتماد → استلام)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">#</th>
                        <th className="border border-slate-300 px-2.5 py-2">من → إلى</th>
                        <th className="border border-slate-300 px-2.5 py-2">الأصناف</th>
                        <th className="border border-slate-300 px-2.5 py-2">الحالة</th>
                        <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                        <th className="border border-slate-300 px-2.5 py-2">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transfers.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد تحويلات مخزنية بعد
                          </td>
                        </tr>
                      ) : (
                        transfers.map((tr) => (
                          <tr key={tr.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">#{tr.id}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <span className="font-semibold">{tr.from_warehouse_name}</span>
                              <span className="mx-1 text-slate-400">←</span>
                              <span className="font-semibold text-[#145632]">{tr.to_warehouse_name}</span>
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {tr.items.map((i) => `${i.medicine_name} (${i.qty})`).join('، ')}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                  tr.status === 'received'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : tr.status === 'approved'
                                      ? 'bg-sky-100 text-sky-800'
                                      : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {tr.status === 'received'
                                  ? 'تم الاستلام'
                                  : tr.status === 'approved'
                                    ? 'معتمد - بانتظار الاستلام'
                                    : 'قيد المراجعة'}
                              </span>
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono text-[11px]">
                              {tr.created_at}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <div className="flex flex-wrap gap-1">
                                {tr.status === 'pending' && canApproveTransfer && (
                                  <button
                                    type="button"
                                    onClick={() => void handleApproveTransfer(tr.id)}
                                    className="rounded bg-[#0B4F9C] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#2b688c]"
                                  >
                                    اعتماد
                                  </button>
                                )}
                                {tr.status === 'approved' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleReceiveTransfer(tr.id)}
                                    className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                                  >
                                    تأكيد الاستلام
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Stocktaking & Adjustments */}
          {tab === 'stocktake' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  تسوية جرد / إتلاف / عجز تشغيلة
                </h3>
                <form noValidate onSubmit={handleStockCountSubmit} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">اختر التشغيلة *</label>
                    <select
                      value={adjBatchId}
                      onChange={(e) => {
                        const bid = Number(e.target.value);
                        setAdjBatchId(bid);
                        const found = batches.find((b) => b.id === bid);
                        if (found) setAdjCountedQty(String(found.qty_remaining));
                      }}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value={0}>-- اختر تشغيلة --</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.medicine_name} | {b.batch_number} ({b.warehouse_name}) — رصيد: {b.qty_remaining}
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedBatchForCount && (
                    <div className="rounded bg-slate-50 p-2 text-[11px] text-slate-600">
                      الرصيد الدفتري الحالي: <strong>{selectedBatchForCount.qty_remaining}</strong> | الصلاحية:{' '}
                      <strong>{selectedBatchForCount.expiry_date}</strong>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-semibold text-slate-700">الكمية الفعلية الجديدة</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={adjCountedQty}
                        onChange={(e) => setAdjCountedQty(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold text-slate-700">نوع التسوية</label>
                      <select
                        value={adjType}
                        onChange={(e) => setAdjType(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      >
                        <option value="stocktake">جرد دوري</option>
                        <option value="damaged">تالف</option>
                        <option value="expired">منتهي الصلاحية</option>
                        <option value="lost">فاقد / عجز</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold text-slate-700">السبب / ملاحظات اللجنة</label>
                    <input
                      type="text"
                      value={adjReason}
                      onChange={(e) => setAdjReason(e.target.value)}
                      placeholder="سبب العجز أو الزيادة أو التلف"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingCount}
                    className="w-full rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                  >
                    {savingCount ? 'جاري الترحيل...' : 'اعتماد التسوية الجردية'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل محاضر الجرد والتسويات المخزنية
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">الدواء</th>
                        <th className="border border-slate-300 px-2.5 py-2">المستودع</th>
                        <th className="border border-slate-300 px-2.5 py-2">النوع</th>
                        <th className="border border-slate-300 px-2.5 py-2">دفتري</th>
                        <th className="border border-slate-300 px-2.5 py-2">فعلي</th>
                        <th className="border border-slate-300 px-2.5 py-2">الفارق</th>
                        <th className="border border-slate-300 px-2.5 py-2">السبب</th>
                        <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {counts.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد محاضر جرد مسجلة
                          </td>
                        </tr>
                      ) : (
                        counts.map((c) => (
                          <tr key={c.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">{c.medicine_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{c.warehouse_name || `#${c.warehouse_id}`}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {ADJUSTMENT_LABELS[c.adjustment_type] || c.adjustment_type}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{c.system_qty}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{c.counted_qty}</td>
                            <td
                              className={`border border-slate-200 px-2.5 py-2 font-bold ${
                                c.variance < 0 ? 'text-red-700' : c.variance > 0 ? 'text-emerald-700' : 'text-slate-600'
                              }`}
                            >
                              {c.variance > 0 ? `+${c.variance}` : c.variance}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{c.reason}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono text-[11px]">{c.created_at}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 5: Item Movement Card */}
          {tab === 'movements' && (
            <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-800">كرت حركة الصنف التفصيلي</h3>
                <select
                  value={movementMedId}
                  onChange={(e) => setMovementMedId(Number(e.target.value))}
                  className="rounded border border-slate-300 px-3 py-1.5 text-xs"
                >
                  <option value={0}>جميع الأصناف (آخر 200 حركة)</option>
                  {inventories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                      <th className="border border-slate-300 px-2.5 py-2">الصنف</th>
                      <th className="border border-slate-300 px-2.5 py-2">المستودع</th>
                      <th className="border border-slate-300 px-2.5 py-2">التشغيلة</th>
                      <th className="border border-slate-300 px-2.5 py-2">نوع الحركة</th>
                      <th className="border border-slate-300 px-2.5 py-2">التغير</th>
                      <th className="border border-slate-300 px-2.5 py-2">الرصيد بعد</th>
                      <th className="border border-slate-300 px-2.5 py-2">الملاحظات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movements.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                          لا توجد حركات مسجلة
                        </td>
                      </tr>
                    ) : (
                      movements.map((m) => (
                        <tr key={m.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2.5 py-2 font-mono text-[11px]">{m.created_at}</td>
                          <td className="border border-slate-200 px-2.5 py-2 font-bold">{m.medicine_name}</td>
                          <td className="border border-slate-200 px-2.5 py-2">{m.warehouse_name || `#${m.warehouse_id}`}</td>
                          <td className="border border-slate-200 px-2.5 py-2 font-mono">{m.batch_number || '—'}</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            {MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type}
                          </td>
                          <td
                            className={`border border-slate-200 px-2.5 py-2 font-bold ${
                              m.qty_change > 0 ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {m.qty_change > 0 ? `+${m.qty_change}` : m.qty_change}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2 font-semibold">{m.balance_after}</td>
                          <td className="border border-slate-200 px-2.5 py-2 text-slate-600">{m.notes}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab 6: Stagnant Items */}
          {tab === 'stagnant' && (
            <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-800">تقرير الأصناف الراكدة (لم تُبع خلال الفترة المحددة)</h3>
                <div className="flex items-center gap-2 text-xs">
                  <span>لم تُبع منذ آخر:</span>
                  <select
                    value={stagnantDays}
                    onChange={(e) => setStagnantDays(Number(e.target.value))}
                    className="rounded border border-slate-300 px-2.5 py-1"
                  >
                    <option value={15}>15 يوماً</option>
                    <option value={30}>30 يوماً</option>
                    <option value={60}>60 يوماً</option>
                    <option value={90}>90 يوماً</option>
                  </select>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 px-3 py-2">اسم الدواء</th>
                      <th className="border border-slate-300 px-3 py-2">الكمية المتوفرة</th>
                      <th className="border border-slate-300 px-3 py-2">سعر الشراء</th>
                      <th className="border border-slate-300 px-3 py-2">سعر البيع</th>
                      <th className="border border-slate-300 px-3 py-2">قيمة الرصيد بالتكلفة</th>
                      <th className="border border-slate-300 px-3 py-2">آخر عملية بيع</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagnantItems.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="border border-slate-200 px-3 py-6 text-center text-emerald-700">
                          لا توجد أصناف راكدة خلال هذه الفترة
                        </td>
                      </tr>
                    ) : (
                      stagnantItems.map((it) => {
                        const qty = Number(it.quantity || 0);
                        const cost = Number(it.purchase_price || 0);
                        return (
                          <tr key={String(it.id)} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-3 py-2 font-bold text-slate-800">
                              {String(it.name)}
                            </td>
                            <td className="border border-slate-200 px-3 py-2 font-semibold">{qty}</td>
                            <td className="border border-slate-200 px-3 py-2">
                              {formatMoney(cost, site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-3 py-2">
                              {formatMoney(String(it.price || 0), site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-3 py-2 font-bold text-amber-700">
                              {formatMoney(qty * cost, site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-3 py-2 font-mono text-[11px]">
                              {it.last_sold_date ? String(it.last_sold_date) : 'لم يُبع من قبل'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Fullscreen Print Preview Modal */}
      <PrintPreviewModal
        open={previewOpen}
        title="تقرير المستودعات والأرصدة والتشغيلات"
        site={site}
        defaultPaperMode="a4"
        onClose={() => setPreviewOpen(false)}
      >
        <div className="space-y-4 text-xs">
          <h4 className="font-bold text-slate-800">ملخص أرصدة المستودعات والفروع</h4>
          <table className="w-full border-collapse text-right">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1.5">المستودع</th>
                <th className="border border-slate-300 px-2 py-1.5">النوع</th>
                <th className="border border-slate-300 px-2 py-1.5">الموقع</th>
                <th className="border border-slate-300 px-2 py-1.5">الوحدات النشطة</th>
                <th className="border border-slate-300 px-2 py-1.5">التقييم بالتكلفة</th>
              </tr>
            </thead>
            <tbody>
              {warehouses.map((w) => (
                <tr key={w.id}>
                  <td className="border border-slate-300 px-2 py-1.5 font-bold">{w.name}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{w.type === 'main' ? 'رئيسي' : 'فرع'}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{w.location || '—'}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{Number(w.totalUnits || 0)}</td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    {formatMoney(Number(w.costValuation || 0), site.currencySymbol)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="pt-2 font-bold text-slate-800">تفاصيل التشغيلات المعروضة ({filteredBatches.length})</h4>
          <table className="w-full border-collapse text-right">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-2 py-1.5">الدواء</th>
                <th className="border border-slate-300 px-2 py-1.5">المستودع</th>
                <th className="border border-slate-300 px-2 py-1.5">التشغيلة</th>
                <th className="border border-slate-300 px-2 py-1.5">تاريخ الانتهاء</th>
                <th className="border border-slate-300 px-2 py-1.5">المتبقي</th>
                <th className="border border-slate-300 px-2 py-1.5">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {filteredBatches.slice(0, 60).map((b) => (
                <tr key={b.id}>
                  <td className="border border-slate-300 px-2 py-1.5">{b.medicine_name}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{b.warehouse_name}</td>
                  <td className="border border-slate-300 px-2 py-1.5 font-mono">{b.batch_number}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{b.expiry_date}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{b.qty_remaining}</td>
                  <td className="border border-slate-300 px-2 py-1.5">{b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PrintPreviewModal>
    </div>
  );
};
