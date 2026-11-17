import React, { useCallback, useEffect, useState } from 'react';
import {
  ShoppingCart,
  Plus,
  CheckCircle2,
  PackageCheck,
  RotateCcw,
  BarChart2,
  Printer,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  CashBox,
  InventoryItem,
  MedicineBatch,
  PurchaseOrder,
  PurchaseReturn,
  SiteSettings,
  Supplier,
  User,
  Warehouse,
} from '../types';
import { formatMoney, hasPermission } from '../types';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { showErrorPopup, validationError } from '../lib/errorPopup';

interface PurchasesPageProps {
  user: User;
  site: SiteSettings;
  inventories: InventoryItem[];
  suppliers: Supplier[];
  onInventoryMutated: () => Promise<void>;
}

interface PoDraftLine {
  medicineId: number;
  qty: number;
  purchasePrice: number;
  discountPct: number;
  batchNumber: string;
  expiryDate: string;
}

export const PurchasesPage: React.FC<PurchasesPageProps> = ({
  user,
  site,
  inventories,
  suppliers,
  onInventoryMutated,
}) => {
  const [tab, setTab] = useState<'orders' | 'returns' | 'comparison'>('orders');
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [returns, setReturns] = useState<PurchaseReturn[]>([]);
  const [comparison, setComparison] = useState<Array<Record<string, unknown>>>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);

  // New Purchase Order Form
  const [showNewPo, setShowNewPo] = useState(false);
  const [supplierId, setSupplierId] = useState<number>(0);
  const [warehouseId, setWarehouseId] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<string>('0');
  const [taxAmount, setTaxAmount] = useState<string>('0');
  const [shippingCost, setShippingCost] = useState<string>('0');
  const [poNotes, setPoNotes] = useState('');
  const [poLines, setPoLines] = useState<PoDraftLine[]>([
    {
      medicineId: 0,
      qty: 10,
      purchasePrice: 0,
      discountPct: 0,
      batchNumber: '',
      expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    },
  ]);
  const [savingPo, setSavingPo] = useState(false);

  // Receive PO Modal
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const [recvInvoiceNumber, setRecvInvoiceNumber] = useState('');
  const [recvPaidAmount, setRecvPaidAmount] = useState('0');
  const [recvCashBoxId, setRecvCashBoxId] = useState<number>(0);
  const [recvItems, setRecvItems] = useState<
    Array<{ id: number; medicineName: string; batchNumber: string; expiryDate: string; qty: number }>
  >([]);
  const [savingRecv, setSavingRecv] = useState(false);

  // Purchase Return Form
  const [retSupplierId, setRetSupplierId] = useState<number>(0);
  const [retBatchId, setRetBatchId] = useState<number>(0);
  const [retQty, setRetQty] = useState<string>('1');
  const [retReason, setRetReason] = useState('');
  const [savingRet, setSavingRet] = useState(false);

  // Print Preview PO
  const [previewPo, setPreviewPo] = useState<PurchaseOrder | null>(null);

  const canApprove = hasPermission(user, 'approvePurchases');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [poRes, retRes, compRes, whRes, batchRes] = await Promise.all([
        api.getPurchases(),
        api.getPurchaseReturns(),
        api.getPurchasePriceComparison(),
        api.getWarehouses(),
        api.getBatches(),
      ]);
      setOrders(poRes.orders);
      setReturns(retRes.returns);
      setComparison(compRes.comparison);
      setWarehouses(whRes.warehouses);
      setBatches(batchRes.batches.filter((b) => b.qty_remaining > 0 && b.status === 'active'));

      setSupplierId((prev) => (suppliers.some((s) => s.id === prev) ? prev : (suppliers[0]?.id ?? 0)));
      setRetSupplierId((prev) => (suppliers.some((s) => s.id === prev) ? prev : (suppliers[0]?.id ?? 0)));
      setWarehouseId((prev) =>
        whRes.warehouses.some((w) => w.id === prev) ? prev : (whRes.warehouses[0]?.id ?? 0),
      );

      if (hasPermission(user, 'manageAccounting')) {
        const accRes = await api.getAccounts();
        setCashBoxes(accRes.cashBoxes);
        setRecvCashBoxId((prev) =>
          accRes.cashBoxes.some((c) => c.id === prev) ? prev : (accRes.cashBoxes[0]?.id ?? 0),
        );
      } else {
        setCashBoxes([{ id: 0, name: 'الصندوق الرئيسي', box_type: 'cash', account_id: 0, balance: 0 }]);
        setRecvCashBoxId(0);
      }
    } catch (err) {
      showErrorPopup(err, 'تحميل بيانات المشتريات والموردين');
    } finally {
      setLoading(false);
    }
  }, [suppliers, user]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const draftSubtotal = poLines.reduce((sum, l) => {
    const net = (Number(l.qty) || 0) * (Number(l.purchasePrice) || 0) * (1 - (Number(l.discountPct) || 0) / 100);
    return sum + net;
  }, 0);
  const draftTotal = Math.max(
    0,
    draftSubtotal - (Number(discountAmount) || 0) + (Number(taxAmount) || 0) + (Number(shippingCost) || 0),
  );

  const handleCreatePo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || !suppliers.some((s) => s.id === supplierId)) {
      validationError('يرجى تحديد المورد أولاً قبل حفظ طلب الشراء.', 'إنشاء طلب شراء جديد');
      return;
    }
    if (warehouses.length > 0 && (!warehouseId || !warehouses.some((w) => w.id === warehouseId))) {
      validationError('يرجى اختيار المستودع المستلم الصحيح.', 'إنشاء طلب شراء جديد');
      return;
    }
    const validLines = poLines.filter((l) => l.medicineId > 0 && l.qty > 0);
    if (validLines.length === 0) {
      validationError('يرجى إضافة صنف دوائي واحد على الأقل بكمية صحيحة.', 'إنشاء طلب شراء جديد');
      return;
    }
    if (validLines.some((l) => !Number.isFinite(l.purchasePrice) || l.purchasePrice < 0)) {
      validationError('سعر الشراء يجب أن يكون صفراً أو قيمة موجبة صحيحة.', 'إنشاء طلب شراء جديد');
      return;
    }
    setSavingPo(true);
    setStatusMsg('');
    try {
      await api.createPurchase({
        supplierId,
        warehouseId,
        discountAmount: Number(discountAmount) || 0,
        taxAmount: Number(taxAmount) || 0,
        shippingCost: Number(shippingCost) || 0,
        notes: poNotes.trim(),
        items: validLines,
      });
      setShowNewPo(false);
      setPoNotes('');
      setStatusMsg('تم إنشاء طلب الشراء بنجاح (بانتظار الاعتماد)');
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'إنشاء طلب شراء جديد');
    } finally {
      setSavingPo(false);
    }
  };

  const handleApprovePo = async (id: number) => {
    try {
      await api.approvePurchase(id);
      setStatusMsg(`تم اعتماد أمر الشراء #${id} وإصداره للمورد`);
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'اعتماد أمر الشراء');
    }
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    setReceivingPo(po);
    setRecvInvoiceNumber(`SUP-${po.id}`);
    setRecvPaidAmount(String(po.total_amount));
    setRecvCashBoxId(cashBoxes[0]?.id ?? 0);
    setRecvItems(
      po.items.map((it) => ({
        id: it.id,
        medicineName: it.medicine_name,
        batchNumber: it.batch_number || `PO-${po.id}-${it.medicine_id}`,
        expiryDate: it.expiry_date || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        qty: it.qty,
      })),
    );
  };

  const handleReceiveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receivingPo) return;
    if (!recvInvoiceNumber.trim()) {
      validationError('رقم فاتورة المورد مطلوب لاستلام وتوريد أمر الشراء.', 'استلام فاتورة التوريد');
      return;
    }
    const paidNum = Number(recvPaidAmount);
    if (!Number.isFinite(paidNum) || paidNum < 0 || paidNum > receivingPo.total_amount + 0.01) {
      validationError('المبلغ المدفوع يجب أن يكون بين صفر وإجمالي الفاتورة.', 'استلام فاتورة التوريد');
      return;
    }
    if (recvItems.some((it) => !Number.isFinite(it.qty) || it.qty <= 0 || !it.batchNumber.trim() || !it.expiryDate.trim())) {
      validationError('تأكد من إدخال كمية موجبة ورقم تشغيلة وتاريخ انتهاء لكل صنف مستلم.', 'استلام فاتورة التوريد');
      return;
    }
    setSavingRecv(true);
    try {
      await api.receivePurchase(receivingPo.id, {
        invoiceNumber: recvInvoiceNumber.trim(),
        paidAmount: Math.max(0, paidNum),
        cashBoxId: recvCashBoxId,
        items: recvItems.map((it) => ({
          id: it.id,
          batchNumber: it.batchNumber.trim(),
          expiryDate: it.expiryDate,
          qty: it.qty,
        })),
      });
      setReceivingPo(null);
      setStatusMsg('تم استلام فاتورة التوريد وإنشاء التشغيلات وتحديث المخزون والحسابات');
      await Promise.all([loadData(), onInventoryMutated()]);
    } catch (err) {
      showErrorPopup(err, 'استلام وتوريد فاتورة المشتريات');
    } finally {
      setSavingRecv(false);
    }
  };

  const handleCreateReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = Number(retQty);
    if (!retSupplierId || !retBatchId || !Number.isFinite(qtyNum) || qtyNum <= 0) {
      validationError('يرجى تحديد المورد والتشغيلة وإدخال كمية مرتجعة أكبر من صفر.', 'تسجيل مرتجع مشتريات');
      return;
    }
    const selectedBatch = batches.find((b) => b.id === retBatchId);
    if (selectedBatch && qtyNum > selectedBatch.qty_remaining) {
      validationError(
        `الكمية المرتجعة (${qtyNum}) أكبر من الرصيد المتاح في التشغيلة (${selectedBatch.qty_remaining}).`,
        'تسجيل مرتجع مشتريات',
      );
      return;
    }
    setSavingRet(true);
    setStatusMsg('');
    try {
      await api.createPurchaseReturn({
        supplierId: retSupplierId,
        batchId: retBatchId,
        qty: qtyNum,
        reason: retReason.trim() || 'مرتجع إلى المورد',
      });
      setRetReason('');
      setRetQty('1');
      setStatusMsg('تم تسجيل مرتجع المشتريات وتعديل رصيد المورد والمخزون');
      await Promise.all([loadData(), onInventoryMutated()]);
    } catch (err) {
      showErrorPopup(err, 'تسجيل مرتجع مشتريات لمورد');
    } finally {
      setSavingRet(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">المشتريات والموردون</span>
          <span className="mx-1">/</span>
          <span>طلبات الشراء، فواتير التوريد، التشغيلات، مرتجعات الموردين، مقارنة الأسعار</span>
        </div>
        <button
          type="button"
          onClick={() => setShowNewPo((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0f4226]"
        >
          <Plus className="h-4 w-4" />
          <span>{showNewPo ? 'إغلاق نموذج الطلب' : 'طلب شراء جديد'}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* New PO Drawer/Card */}
      {showNewPo && (
        <form noValidate onSubmit={handleCreatePo} className="space-y-3 rounded border border-[#0B4F9C] bg-white p-4 shadow-md text-xs">
          <h3 className="border-b border-slate-200 pb-2 text-sm font-bold text-[#0B4F9C]">
            إنشاء طلب شراء جديد (يُرحل لاحقاً كفاتورة توريد + توزيع تكلفة الشحن على التشغيلات)
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="mb-1 block font-semibold">المورد *</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(Number(e.target.value))}
                className="w-full rounded border border-slate-300 px-2.5 py-2"
              >
                <option value={0}>اختر المورد...</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold">المستودع المستلم</label>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(Number(e.target.value))}
                className="w-full rounded border border-slate-300 px-2.5 py-2"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-semibold">مصاريف الشحن والتخليص</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={shippingCost}
                onChange={(e) => setShippingCost(e.target.value)}
                className="w-full rounded border border-slate-300 px-2.5 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block font-semibold">ملاحظات الطلب</label>
              <input
                type="text"
                value={poNotes}
                onChange={(e) => setPoNotes(e.target.value)}
                placeholder="مثال: توريد شهري"
                className="w-full rounded border border-slate-300 px-2.5 py-2"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">الدواء</th>
                  <th className="border border-slate-300 px-2 py-1.5">الكمية</th>
                  <th className="border border-slate-300 px-2 py-1.5">سعر الشراء</th>
                  <th className="border border-slate-300 px-2 py-1.5">خصم %</th>
                  <th className="border border-slate-300 px-2 py-1.5">التشغيلة المقترحة</th>
                  <th className="border border-slate-300 px-2 py-1.5">تاريخ الانتهاء</th>
                  <th className="border border-slate-300 px-2 py-1.5">حذف</th>
                </tr>
              </thead>
              <tbody>
                {poLines.map((line, idx) => (
                  <tr key={idx}>
                    <td className="border border-slate-200 p-1.5">
                      <select
                        value={line.medicineId}
                        onChange={(e) => {
                          const mid = Number(e.target.value);
                          const med = inventories.find((m) => m.id === mid);
                          setPoLines((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? { ...row, medicineId: mid, purchasePrice: med?.purchasePrice || Number(med?.price || 0) * 0.7 }
                                : row,
                            ),
                          );
                        }}
                        className="w-full rounded border border-slate-300 px-2 py-1"
                      >
                        <option value={0}>اختر الدواء...</option>
                        {inventories.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (متوفر: {m.quantity})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="border border-slate-200 p-1.5">
                      <input
                        type="number"
                        min={1}
                        value={line.qty}
                        onChange={(e) =>
                          setPoLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, qty: Number(e.target.value) } : row)),
                          )
                        }
                        className="w-20 rounded border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="border border-slate-200 p-1.5">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.purchasePrice}
                        onChange={(e) =>
                          setPoLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, purchasePrice: Number(e.target.value) } : row)),
                          )
                        }
                        className="w-24 rounded border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="border border-slate-200 p-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={line.discountPct}
                        onChange={(e) =>
                          setPoLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, discountPct: Number(e.target.value) } : row)),
                          )
                        }
                        className="w-16 rounded border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="border border-slate-200 p-1.5">
                      <input
                        type="text"
                        value={line.batchNumber}
                        onChange={(e) =>
                          setPoLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, batchNumber: e.target.value } : row)),
                          )
                        }
                        placeholder="تلقائي"
                        className="w-24 rounded border border-slate-300 px-2 py-1 font-mono"
                      />
                    </td>
                    <td className="border border-slate-200 p-1.5">
                      <input
                        type="date"
                        value={line.expiryDate}
                        onChange={(e) =>
                          setPoLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, expiryDate: e.target.value } : row)),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1"
                      />
                    </td>
                    <td className="border border-slate-200 p-1.5 text-center">
                      {poLines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setPoLines((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-red-600 hover:text-red-800"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() =>
                setPoLines((prev) => [
                  ...prev,
                  {
                    medicineId: 0,
                    qty: 10,
                    purchasePrice: 0,
                    discountPct: 0,
                    batchNumber: '',
                    expiryDate: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
                  },
                ])
              }
              className="rounded border border-[#0B4F9C] px-3 py-1.5 font-bold text-[#0B4F9C] hover:bg-sky-50"
            >
              + إضافة صنف آخر
            </button>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1">
                <span>خصم إضافي:</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="w-20 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1">
                <span>ضريبة:</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={taxAmount}
                  onChange={(e) => setTaxAmount(e.target.value)}
                  className="w-20 rounded border border-slate-300 px-2 py-1"
                />
              </label>
              <span className="text-sm font-bold text-[#145632]">
                الصافي النهائي: {formatMoney(draftTotal, site.currencySymbol)}
              </span>
              <button
                type="submit"
                disabled={savingPo}
                className="rounded bg-[#145632] px-4 py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
              >
                {savingPo ? 'جاري الحفظ...' : 'حفظ طلب الشراء'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded border border-slate-300 bg-white p-2 shadow-sm">
        {[
          { key: 'orders', label: 'طلبات وأوامر الشراء والتوريد', icon: ShoppingCart },
          { key: 'returns', label: 'مرتجعات الموردين', icon: RotateCcw },
          { key: 'comparison', label: 'مقارنة أسعار الموردين', icon: BarChart2 },
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as typeof tab)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
                tab === t.key ? 'bg-[#0B4F9C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
          جاري تحميل بيانات المشتريات...
        </div>
      ) : (
        <>
          {tab === 'orders' && (
            <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
              <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                سجل أوامر الشراء والتوريد ({orders.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 px-2.5 py-2">#</th>
                      <th className="border border-slate-300 px-2.5 py-2">المورد</th>
                      <th className="border border-slate-300 px-2.5 py-2">المستودع</th>
                      <th className="border border-slate-300 px-2.5 py-2">الأصناف</th>
                      <th className="border border-slate-300 px-2.5 py-2">الإجمالي</th>
                      <th className="border border-slate-300 px-2.5 py-2">المدفوع</th>
                      <th className="border border-slate-300 px-2.5 py-2">الحالة</th>
                      <th className="border border-slate-300 px-2.5 py-2">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                          لا توجد طلبات شراء مسجلة بعد
                        </td>
                      </tr>
                    ) : (
                      orders.map((po) => (
                        <tr key={po.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2.5 py-2 font-bold">
                            #{po.id}
                            {po.invoice_number ? (
                              <div className="font-mono text-[10px] text-slate-500">{po.invoice_number}</div>
                            ) : null}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2 font-semibold">{po.supplier_name}</td>
                          <td className="border border-slate-200 px-2.5 py-2">{po.warehouse_name || `#${po.warehouse_id}`}</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            {po.items.map((it) => `${it.medicine_name} (${it.qty})`).join('، ')}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2 font-bold text-[#145632]">
                            {formatMoney(po.total_amount, site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            {formatMoney(po.paid_amount, site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                po.status === 'received'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : po.status === 'ordered'
                                    ? 'bg-sky-100 text-sky-800'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {po.status === 'received'
                                ? 'مستلم بالمخزون'
                                : po.status === 'ordered'
                                  ? 'أمر شراء معتمد'
                                  : 'طلب قيد الموافقة'}
                            </span>
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            <div className="flex flex-wrap gap-1">
                              {po.status === 'pending' && canApprove && (
                                <button
                                  type="button"
                                  onClick={() => void handleApprovePo(po.id)}
                                  className="rounded bg-[#0B4F9C] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#2b688c]"
                                >
                                  اعتماد
                                </button>
                              )}
                              {po.status !== 'received' && (
                                <button
                                  type="button"
                                  onClick={() => openReceiveModal(po)}
                                  className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"
                                >
                                  <PackageCheck className="h-3 w-3" />
                                  <span>استلام</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setPreviewPo(po)}
                                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <Printer className="h-3 w-3" />
                                <span>طباعة</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'returns' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  تسجيل مرتجع مشتريات لمورد
                </h3>
                <form noValidate onSubmit={handleCreateReturn} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">المورد *</label>
                    <select
                      value={retSupplierId}
                      onChange={(e) => setRetSupplierId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value={0}>اختر المورد...</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} (ذمم: {formatMoney(Number(s.balance || 0), site.currencySymbol)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">التشغيلة المرتجعة *</label>
                    <select
                      value={retBatchId}
                      onChange={(e) => setRetBatchId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value={0}>اختر تشغيلة متاحة...</option>
                      {batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.medicine_name} | {b.batch_number} — رصيد: {b.qty_remaining}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الكمية المرتجعة *</label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      value={retQty}
                      onChange={(e) => setRetQty(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">سبب الإرجاع</label>
                    <input
                      type="text"
                      value={retReason}
                      onChange={(e) => setRetReason(e.target.value)}
                      placeholder="قرب انتهاء / اختلاف مواصفات"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingRet}
                    className="w-full rounded bg-amber-600 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                  >
                    {savingRet ? 'جاري التنفيذ...' : 'اعتماد مرتجع المشتريات'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل مرتجعات الموردين ({returns.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">#</th>
                        <th className="border border-slate-300 px-2.5 py-2">المورد</th>
                        <th className="border border-slate-300 px-2.5 py-2">الدواء</th>
                        <th className="border border-slate-300 px-2.5 py-2">الكمية</th>
                        <th className="border border-slate-300 px-2.5 py-2">الإجمالي المخصوم</th>
                        <th className="border border-slate-300 px-2.5 py-2">السبب</th>
                        <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returns.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد مرتجعات موردين مسجلة
                          </td>
                        </tr>
                      ) : (
                        returns.map((r) => (
                          <tr key={r.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">#{r.id}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{r.supplier_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-semibold">{r.medicine_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{r.qty}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-bold text-red-700">
                              {formatMoney(r.total_amount, site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{r.reason}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono text-[11px]">{r.created_at}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'comparison' && (
            <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
              <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                مقارنة أسعار الشراء بين الموردين لكل صنف دوائي
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700">
                      <th className="border border-slate-300 px-3 py-2">الدواء</th>
                      <th className="border border-slate-300 px-3 py-2">المورد</th>
                      <th className="border border-slate-300 px-3 py-2">أقل سعر شراء</th>
                      <th className="border border-slate-300 px-3 py-2">متوسط السعر</th>
                      <th className="border border-slate-300 px-3 py-2">أعلى سعر</th>
                      <th className="border border-slate-300 px-3 py-2">إجمالي الكميات المورّدة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                          لا توجد بيانات فواتير شراء للمقارنة بعد
                        </td>
                      </tr>
                    ) : (
                      comparison.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-3 py-2 font-bold text-slate-800">
                            {String(row.medicine_name)}
                          </td>
                          <td className="border border-slate-200 px-3 py-2">{String(row.supplier_name)}</td>
                          <td className="border border-slate-200 px-3 py-2 font-bold text-emerald-700">
                            {formatMoney(Number(row.min_price || 0), site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-3 py-2">
                            {formatMoney(Number(row.avg_price || 0), site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-3 py-2 text-amber-700">
                            {formatMoney(Number(row.max_price || 0), site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-3 py-2 font-semibold">
                            {Number(row.total_qty || 0)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Receive Purchase Order Modal */}
      {receivingPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded bg-white p-5 shadow-xl text-xs">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-bold text-slate-800">
                استلام وتوريد أمر شراء #{receivingPo.id} — {receivingPo.supplier_name}
              </h3>
              <button
                type="button"
                onClick={() => setReceivingPo(null)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form noValidate onSubmit={handleReceiveSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-semibold">رقم فاتورة المورد</label>
                  <input
                    type="text"
                    required
                    value={recvInvoiceNumber}
                    onChange={(e) => setRecvInvoiceNumber(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-2 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">
                    المبلغ المدفوع الآن (الإجمالي: {formatMoney(receivingPo.total_amount, site.currencySymbol)})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={receivingPo.total_amount}
                    step="0.01"
                    value={recvPaidAmount}
                    onChange={(e) => setRecvPaidAmount(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">الصندوق / الحساب البنكي للدفع</label>
                  <select
                    value={recvCashBoxId}
                    onChange={(e) => setRecvCashBoxId(Number(e.target.value))}
                    className="w-full rounded border border-slate-300 px-2.5 py-2"
                  >
                    {cashBoxes.map((cb) => (
                      <option key={cb.id} value={cb.id}>
                        {cb.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <table className="w-full border-collapse text-right">
                <thead>
                  <tr className="bg-slate-100">
                    <th className="border border-slate-300 px-2 py-1.5">الصنف</th>
                    <th className="border border-slate-300 px-2 py-1.5">الكمية المستلمة</th>
                    <th className="border border-slate-300 px-2 py-1.5">رقم التشغيلة *</th>
                    <th className="border border-slate-300 px-2 py-1.5">تاريخ الانتهاء *</th>
                  </tr>
                </thead>
                <tbody>
                  {recvItems.map((it, idx) => (
                    <tr key={it.id}>
                      <td className="border border-slate-200 px-2 py-1.5 font-semibold">{it.medicineName}</td>
                      <td className="border border-slate-200 px-2 py-1.5">
                        <input
                          type="number"
                          min={0.01}
                          step="0.01"
                          value={it.qty}
                          onChange={(e) =>
                            setRecvItems((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, qty: Number(e.target.value) } : row)),
                            )
                          }
                          className="w-20 rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="border border-slate-200 px-2 py-1.5">
                        <input
                          type="text"
                          required
                          value={it.batchNumber}
                          onChange={(e) =>
                            setRecvItems((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, batchNumber: e.target.value } : row)),
                            )
                          }
                          className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                        />
                      </td>
                      <td className="border border-slate-200 px-2 py-1.5">
                        <input
                          type="date"
                          required
                          value={it.expiryDate}
                          onChange={(e) =>
                            setRecvItems((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, expiryDate: e.target.value } : row)),
                            )
                          }
                          className="rounded border border-slate-300 px-2 py-1"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReceivingPo(null)}
                  className="rounded border border-slate-300 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingRecv}
                  className="rounded bg-[#145632] px-5 py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                >
                  {savingRecv ? 'جاري التوريد...' : 'تأكيد الاستلام وتوليد التشغيلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Print Preview PO */}
      <PrintPreviewModal
        open={Boolean(previewPo)}
        title={`أمر / فاتورة شراء #${previewPo?.id || ''}`}
        site={site}
        defaultPaperMode="a4"
        onClose={() => setPreviewPo(null)}
      >
        {previewPo && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded border border-slate-300 bg-slate-50 p-3">
              <div>
                <strong>المورد:</strong> {previewPo.supplier_name}
              </div>
              <div>
                <strong>المستودع:</strong> {previewPo.warehouse_name || `#${previewPo.warehouse_id}`}
              </div>
              <div>
                <strong>رقم فاتورة المورد:</strong> {previewPo.invoice_number || '—'}
              </div>
              <div>
                <strong>التاريخ:</strong> {previewPo.created_at}
              </div>
            </div>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">الصنف</th>
                  <th className="border border-slate-300 px-2 py-1.5">الكمية</th>
                  <th className="border border-slate-300 px-2 py-1.5">سعر الشراء</th>
                  <th className="border border-slate-300 px-2 py-1.5">التكلفة المحملة</th>
                  <th className="border border-slate-300 px-2 py-1.5">التشغيلة</th>
                  <th className="border border-slate-300 px-2 py-1.5">الانتهاء</th>
                </tr>
              </thead>
              <tbody>
                {previewPo.items.map((it) => (
                  <tr key={it.id}>
                    <td className="border border-slate-300 px-2 py-1.5">{it.medicine_name}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{it.qty}</td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      {formatMoney(it.purchase_price, site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      {formatMoney(it.landed_unit_cost || it.purchase_price, site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 font-mono">{it.batch_number || '—'}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{it.expiry_date || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap justify-between gap-2 border-t border-slate-300 pt-3 font-bold">
              <span>الشحن: {formatMoney(previewPo.shipping_cost, site.currencySymbol)}</span>
              <span>الضريبة: {formatMoney(previewPo.tax_amount, site.currencySymbol)}</span>
              <span>المدفوع: {formatMoney(previewPo.paid_amount, site.currencySymbol)}</span>
              <span className="text-sm text-[#145632]">
                الإجمالي: {formatMoney(previewPo.total_amount, site.currencySymbol)}
              </span>
            </div>
          </div>
        )}
      </PrintPreviewModal>
    </div>
  );
};
