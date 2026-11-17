import React, { useMemo, useState } from 'react';
import {
  Search,
  ShoppingCart,
  Trash2,
  Edit3,
  Plus,
  Pill,
  ArrowUpDown,
  X,
  Check,
  Barcode,
  AlertCircle,
  Layers,
  History,
  ShieldAlert,
  FileText,
  Printer,
  QrCode,
  Star,
  Wand2,
  Power,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type {
  BarcodeHistoryRecord,
  Category,
  InventoryItem,
  MedicineBatch,
  ProductBarcodeRecord,
  SiteSettings,
  StockMovement,
  Supplier,
  User,
  Warehouse,
} from '../types';
import { DOSAGE_FORMS, formatMoney, getExpiryStatus, hasPermission, resolvePhotoSrc } from '../types';
import { ImagePickerField } from '../components/ImagePickerField';
import { ConfirmModal } from '../components/ConfirmModal';
import { BarcodeLabelsPrintModal } from '../components/BarcodeLabelsPrintModal';
import { BarcodeSvg } from '../components/BarcodeSvg';
import { normalizeScannerInput } from '../utils/posSearch';

interface InventoriesPageProps {
  user: User;
  site: SiteSettings;
  inventories: InventoryItem[];
  categories: Category[];
  suppliers: Supplier[];
  selectedCatId: number | null;
  onSelectCatId: (catId: number | null) => void;
  onRefreshInventories: () => Promise<void>;
  onAddToBill: (id: number) => Promise<void>;
  onScanBarcode: (code: string) => Promise<InventoryItem>;
  onGoAddNew: () => void;
}

type SortField = 'id' | 'name' | 'price' | 'quantity' | 'expiryDate';

export const InventoriesPage: React.FC<InventoriesPageProps> = ({
  user,
  site,
  inventories,
  categories,
  suppliers,
  selectedCatId,
  onSelectCatId,
  onRefreshInventories,
  onAddToBill,
  onScanBarcode,
  onGoAddNew,
}) => {
  const [search, setSearch] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [sortField, setSortField] = useState<SortField>('id');
  const [sortAsc, setSortAsc] = useState(true);
  const [addedFeedbackId, setAddedFeedbackId] = useState<number | null>(null);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<InventoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Batches Modal State
  const [batchesMed, setBatchesMed] = useState<InventoryItem | null>(null);
  const [batches, setBatches] = useState<MedicineBatch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [newBatchNo, setNewBatchNo] = useState('');
  const [newBatchWarehouseId, setNewBatchWarehouseId] = useState<number>(1);
  const [newBatchProdDate, setNewBatchProdDate] = useState('');
  const [newBatchExpDate, setNewBatchExpDate] = useState('');
  const [newBatchQty, setNewBatchQty] = useState('10');
  const [newBatchCost, setNewBatchCost] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  // Stock Movements Card Modal State
  const [movementMed, setMovementMed] = useState<InventoryItem | null>(null);
  const [movements, setMovements] = useState<StockMovement[]>([]);

  // Barcode Labels Print Modal State
  const [barcodePrintOpen, setBarcodePrintOpen] = useState(false);
  const [barcodePrintTarget, setBarcodePrintTarget] = useState<InventoryItem | null>(null);

  // Multi-Barcode Management Modal State (Stage 4)
  const [barcodeMed, setBarcodeMed] = useState<InventoryItem | null>(null);
  const [medBarcodes, setMedBarcodes] = useState<ProductBarcodeRecord[]>([]);
  const [barcodeHistory, setBarcodeHistory] = useState<BarcodeHistoryRecord[]>([]);
  const [medBatchesForBarcode, setMedBatchesForBarcode] = useState<MedicineBatch[]>([]);
  const [newBcCode, setNewBcCode] = useState('');
  const [newBcUnitType, setNewBcUnitType] = useState<'pack' | 'strip' | 'piece' | 'box' | 'batch'>('strip');
  const [newBcBatchId, setNewBcBatchId] = useState<number | ''>('');
  const [newBcPrimary, setNewBcPrimary] = useState(false);
  const [newBcValidateDigit, setNewBcValidateDigit] = useState(true);
  const [barcodeBusy, setBarcodeBusy] = useState(false);
  const [barcodeModalMsg, setBarcodeModalMsg] = useState('');

  const availableBarcodeCount = useMemo(
    () =>
      inventories.filter(
        (item) =>
          item.status !== 'suspended' &&
          item.quantity > 0 &&
          getExpiryStatus(item.expiryDate) !== 'expired',
      ).length,
    [inventories],
  );

  const canSell = hasPermission(user, 'posBilling');
  const canEdit = hasPermission(user, 'manageMedicines');
  const canDelete = hasPermission(user, 'deleteMedicines');
  const canManageBatches = hasPermission(user, 'manageBatches');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inventories
      .filter((item) => {
        if (selectedCatId && item.catId !== selectedCatId) return false;
        if (!q) return true;
        return (
          item.name.toLowerCase().includes(q) ||
          (item.scientificName || '').toLowerCase().includes(q) ||
          (item.activeIngredient || '').toLowerCase().includes(q) ||
          item.company.toLowerCase().includes(q) ||
          item.supplier.toLowerCase().includes(q) ||
          item.unit.toLowerCase().includes(q) ||
          item.barcode.toLowerCase().includes(q) ||
          item.batchNumber.toLowerCase().includes(q) ||
          (item.categoryName || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === 'id') cmp = a.id - b.id;
        else if (sortField === 'price') cmp = (Number(a.price) || 0) - (Number(b.price) || 0);
        else if (sortField === 'quantity') cmp = a.quantity - b.quantity;
        else if (sortField === 'name') cmp = a.name.localeCompare(b.name, 'ar');
        else cmp = (a.expiryDate || '').localeCompare(b.expiryDate || '');
        return sortAsc ? cmp : -cmp;
      });
  }, [inventories, selectedCatId, search, sortField, sortAsc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((v) => !v);
    else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const handleSell = async (id: number) => {
    try {
      await onAddToBill(id);
      setAddedFeedbackId(id);
      setTimeout(() => {
        setAddedFeedbackId((prev) => (prev === id ? null : prev));
      }, 1200);
    } catch (err) {
      showErrorPopup(err, 'إضافة دواء إلى الفاتورة');
    }
  };

  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) {
      validationError(
        'يرجى إدخال أو مسح رقم الباركود أو اسم الدواء أولاً.',
        'الإضافة السريعة بالباركود',
        ['حقل البحث بالباركود فارغ.'],
      );
      return;
    }
    setStatusMsg('');
    try {
      const normalized = normalizeScannerInput(barcodeInput);
      const added = await onScanBarcode(normalized || barcodeInput.trim());
      setBarcodeInput('');
      setStatusMsg(`تم مسح وإضافة "${added.name}" (${added.barcode}) إلى الفاتورة`);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, 'الإضافة بالباركود');
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteItem) return;
    setDeleting(true);
    try {
      await api.deleteInventory(confirmDeleteItem.id);
      await onRefreshInventories();
      setStatusMsg(`تم حذف الدواء "${confirmDeleteItem.name}" من المخزون`);
      setConfirmDeleteItem(null);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, `حذف الدواء: ${confirmDeleteItem.name}`);
      setConfirmDeleteItem(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    if (!editingItem.name.trim()) {
      validationError(
        'يرجى إدخال الاسم التجاري للدواء قبل الحفظ.',
        'تعديل بيانات الدواء',
        ['حقل الاسم التجاري للدواء فارغ.'],
      );
      return;
    }
    const priceNum = Number(editingItem.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      validationError(
        'سعر البيع للعلبة يجب أن يكون رقماً موجباً أكبر من الصفر.',
        'تعديل بيانات الدواء',
        ['قيمة سعر البيع المدخلة غير صالحة أو أقل من أو تساوي الصفر.'],
      );
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateInventory(editingItem.id, { ...editingItem, name: editingItem.name.trim() });
      await onRefreshInventories();
      setEditingItem(null);
      setStatusMsg('تم تحديث بيانات الدواء بنجاح');
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, `تعديل بيانات الدواء: ${editingItem.name}`);
    } finally {
      setSavingEdit(false);
    }
  };

  const openBatchesModal = async (med: InventoryItem) => {
    try {
      setBatchesMed(med);
      setNewBatchNo(`B-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 899)}`);
      setNewBatchCost(String(med.purchasePrice || ''));
      setNewBatchExpDate('');
      setNewBatchProdDate('');
      const [bRes, wRes] = await Promise.all([api.getBatches({ medicineId: med.id }), api.getWarehouses()]);
      setBatches(bRes.batches);
      setWarehouses(wRes.warehouses);
      if (wRes.warehouses[0]) setNewBatchWarehouseId(wRes.warehouses[0].id);
    } catch (err) {
      setBatchesMed(null);
      showErrorPopup(err, `عرض تشغيلات الصنف: ${med.name}`);
    }
  };

  const handleAddBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchesMed) return;
    if (!newBatchNo.trim()) {
      validationError(
        'يرجى إدخال رقم التشغيلة الجديدة.',
        'إضافة تشغيلة دوائية',
        ['حقل رقم التشغيلة فارغ.'],
      );
      return;
    }
    if (!newBatchExpDate) {
      validationError(
        'يرجى تحديد تاريخ انتهاء الصلاحية للتشغيلة.',
        'إضافة تشغيلة دوائية',
        ['حقل تاريخ الانتهاء مطلوب لتطبيق نظام الصرف FEFO.'],
      );
      return;
    }
    if (newBatchProdDate && newBatchExpDate < newBatchProdDate) {
      validationError(
        'تاريخ انتهاء الصلاحية أقدم من تاريخ الإنتاج.',
        'إضافة تشغيلة دوائية',
        [`تاريخ الإنتاج (${newBatchProdDate}) لا يمكن أن يسبق أو يلي تاريخ الانتهاء (${newBatchExpDate}).`],
      );
      return;
    }
    const qtyNum = Number(newBatchQty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      validationError(
        'كمية التشغيلة يجب أن تكون أكبر من الصفر.',
        'إضافة تشغيلة دوائية',
        ['القيمة المدخلة للكمية غير صالحة أو تساوي الصفر.'],
      );
      return;
    }
    setBatchBusy(true);
    try {
      await api.createBatch({
        medicineId: batchesMed.id,
        warehouseId: newBatchWarehouseId,
        batchNumber: newBatchNo.trim(),
        productionDate: newBatchProdDate,
        expiryDate: newBatchExpDate,
        qty: qtyNum,
        purchasePrice: Number(newBatchCost) || batchesMed.purchasePrice || 0,
        supplierName: batchesMed.supplier,
      });
      const bRes = await api.getBatches({ medicineId: batchesMed.id });
      setBatches(bRes.batches);
      await onRefreshInventories();
      setStatusMsg(`تمت إضافة التشغيلة ${newBatchNo} للدواء "${batchesMed.name}"`);
    } catch (err) {
      showErrorPopup(err, `إضافة تشغيلة للدواء: ${batchesMed.name}`);
    } finally {
      setBatchBusy(false);
    }
  };

  const handleBatchStatus = async (batchId: number, status: 'active' | 'quarantined' | 'expired' | 'damaged') => {
    if (!batchesMed) return;
    setBatchBusy(true);
    try {
      await api.updateBatchStatus(batchId, status, `تغيير حالة إلى ${status}`);
      const bRes = await api.getBatches({ medicineId: batchesMed.id });
      setBatches(bRes.batches);
      await onRefreshInventories();
    } catch (err) {
      showErrorPopup(err, 'تحديث حالة التشغيلة');
    } finally {
      setBatchBusy(false);
    }
  };

  const openMovementCard = async (med: InventoryItem) => {
    try {
      setMovementMed(med);
      const res = await api.getStockMovements(med.id);
      setMovements(res.movements);
    } catch (err) {
      setMovementMed(null);
      showErrorPopup(err, `عرض بطاقة حركة الصنف: ${med.name}`);
    }
  };

  const openMultiBarcodeModal = async (med: InventoryItem) => {
    setBarcodeMed(med);
    setBarcodeModalMsg('');
    setNewBcCode('');
    setNewBcUnitType(med.stripsPerPack > 1 ? 'strip' : 'pack');
    setNewBcBatchId('');
    setNewBcPrimary(false);
    try {
      const [bcRes, bRes] = await Promise.all([api.getBarcodes(med.id), api.getBatches({ medicineId: med.id })]);
      setMedBarcodes(bcRes.barcodes);
      setBarcodeHistory(bcRes.history);
      setMedBatchesForBarcode(bRes.batches);
    } catch (err) {
      setBarcodeMed(null);
      showErrorPopup(err, `إدارة باركودات الصنف: ${med.name}`);
    }
  };

  const refreshBarcodeModalData = async (medId: number) => {
    const bcRes = await api.getBarcodes(medId);
    setMedBarcodes(bcRes.barcodes);
    setBarcodeHistory(bcRes.history);
    await onRefreshInventories();
  };

  const handleGenerateBarcodeCode = async () => {
    setBarcodeBusy(true);
    try {
      const res = await api.generateInternalBarcode();
      setNewBcCode(res.barcode);
      setBarcodeModalMsg(`تم توليد باركود داخلي معتمد (${res.barcode}) متوافق مع EAN-13`);
    } catch (err) {
      showErrorPopup(err, 'توليد باركود داخلي');
    } finally {
      setBarcodeBusy(false);
    }
  };

  const handleAssignBarcode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeMed) return;
    const clean = normalizeScannerInput(newBcCode, { preserveGs: false });
    if (!clean) {
      validationError(
        'يرجى إدخال رقم الباركود أو الضغط على توليد باركود داخلي.',
        'ربط باركود إضافي',
        ['حقل الباركود فارغ.'],
      );
      return;
    }
    setBarcodeBusy(true);
    setBarcodeModalMsg('');
    try {
      await api.createBarcode({
        medicineId: barcodeMed.id,
        batchId: newBcBatchId ? Number(newBcBatchId) : null,
        barcode: clean,
        unitType: newBcUnitType,
        isPrimary: newBcPrimary,
        validateCheckDigit: newBcValidateDigit,
      });
      setNewBcCode('');
      setNewBcPrimary(false);
      await refreshBarcodeModalData(barcodeMed.id);
      setBarcodeModalMsg(`تم ربط الباركود ${clean} بنجاح`);
    } catch (err) {
      showErrorPopup(err, `ربط باركود للدواء: ${barcodeMed.name}`);
    } finally {
      setBarcodeBusy(false);
    }
  };

  const handlePromotePrimaryBarcode = async (barcodeId: number) => {
    if (!barcodeMed) return;
    setBarcodeBusy(true);
    try {
      await api.updateBarcode(barcodeId, { isPrimary: true });
      await refreshBarcodeModalData(barcodeMed.id);
      setBarcodeModalMsg('تمت ترقية الباركود ليصبح الباركود الأساسي للدواء');
    } catch (err) {
      showErrorPopup(err, 'تغيير الباركود الأساسي');
    } finally {
      setBarcodeBusy(false);
    }
  };

  const handleToggleBarcodeActive = async (bc: ProductBarcodeRecord) => {
    if (!barcodeMed) return;
    setBarcodeBusy(true);
    try {
      await api.updateBarcode(bc.id, { isActive: !bc.is_active });
      await refreshBarcodeModalData(barcodeMed.id);
    } catch (err) {
      showErrorPopup(err, 'تحديث حالة الباركود');
    } finally {
      setBarcodeBusy(false);
    }
  };

  const handleDeleteSecondaryBarcode = async (barcodeId: number) => {
    if (!barcodeMed) return;
    setBarcodeBusy(true);
    try {
      await api.deleteBarcode(barcodeId);
      await refreshBarcodeModalData(barcodeMed.id);
      setBarcodeModalMsg('تم حذف الباركود الإضافي وتسجيل الحركة في السجل');
    } catch (err) {
      showErrorPopup(err, 'حذف الباركود الإضافي');
    } finally {
      setBarcodeBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <Pill className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">
              إدارة الأدوية والتشغيلات (FEFO)
              {selectedCatId ? ` — ${categories.find((c) => c.id === selectedCatId)?.name || ''}` : ' (جميع الأصناف)'}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={availableBarcodeCount === 0}
              onClick={() => {
                setBarcodePrintTarget(null);
                setBarcodePrintOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0f4126] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Printer className="h-4 w-4" />
              <span>طباعة ملصقات الباركود ({availableBarcodeCount})</span>
            </button>
            {canEdit && (
              <button
                type="button"
                onClick={onGoAddNew}
                className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                <span>إضافة دواء جديد</span>
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

          {canSell && (
            <form
              onSubmit={handleBarcodeSubmit}
              noValidate
              className="flex flex-wrap items-center gap-2 rounded border border-sky-200 bg-[#F3F6FA] p-3"
            >
              <Barcode className="h-5 w-5 text-[#0B4F9C]" />
              <input
                type="text"
                dir="ltr"
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="امسح الباركود أو اكتب الاسم التجاري/العلمي للإضافة السريعة للفاتورة..."
                className="min-w-[240px] flex-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm focus:border-[#0B4F9C] focus:outline-none"
              />
              <button
                type="submit"
                className="rounded bg-[#145632] px-4 py-1.5 text-sm font-bold text-white hover:bg-[#0f4126]"
              >
                إضافة بالباركود
              </button>
            </form>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full sm:w-96">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث بالاسم التجاري، العلمي، المادة الفعالة، الباركود، التشغيلة..."
                className="w-full rounded border border-slate-300 py-2 pr-9 pl-3 text-sm focus:border-[#0B4F9C] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-semibold text-slate-600">تصفية بالتصنيف:</label>
              <select
                value={selectedCatId ?? ''}
                onChange={(e) => onSelectCatId(e.target.value ? Number(e.target.value) : null)}
                className="rounded border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#0B4F9C] focus:outline-none"
              >
                <option value="">كل التصنيفات</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-right text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5">
                    <button type="button" onClick={() => toggleSort('id')} className="inline-flex items-center gap-1 font-bold">
                      <span>#</span>
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الصورة</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">
                    <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 font-bold">
                      <span>بيانات الدواء والباركود</span>
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5">التصنيف والرف</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">
                    <button type="button" onClick={() => toggleSort('quantity')} className="inline-flex items-center gap-1 font-bold">
                      <span>الرصيد</span>
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5">
                    <button type="button" onClick={() => toggleSort('expiryDate')} className="inline-flex items-center gap-1 font-bold">
                      <span>أقرب صلاحية (FEFO)</span>
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5">
                    <button type="button" onClick={() => toggleSort('price')} className="inline-flex items-center gap-1 font-bold">
                      <span>الأسعار والربح</span>
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      لا توجد أدوية مطابقة للبحث.
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const expStatus = getExpiryStatus(item.expiryDate);
                    const isOut = item.quantity <= 0;
                    const isLow = !isOut && item.quantity <= item.minStock;
                    const suspended = item.status === 'suspended';
                    const blockedForSale = isOut || expStatus === 'expired' || suspended;
                    const sellP = Number(item.price) || 0;
                    const buyP = Number(item.purchasePrice) || 0;
                    const margin = sellP > 0 && buyP > 0 ? (((sellP - buyP) / sellP) * 100).toFixed(0) : null;

                    return (
                      <tr key={item.id} className={suspended ? 'bg-slate-50 opacity-75' : 'hover:bg-sky-50/50'}>
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{item.id}</td>
                        <td className="px-3 py-2.5">
                          <img
                            src={resolvePhotoSrc(item.pic, 'tablet.png')}
                            alt={item.name}
                            className="h-10 w-10 rounded border border-slate-200 object-cover"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-800">
                            <span>{item.name}</span>
                            {item.unit && <span className="text-xs font-normal text-slate-500">({item.unit})</span>}
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              {item.dosageForm || 'أقراص'}
                            </span>
                            {item.requiresPrescription && (
                              <span
                                title="يتطلب وصفة طبية"
                                className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"
                              >
                                <FileText className="h-3 w-3" />
                                بوصفة
                              </span>
                            )}
                            {suspended && (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                موقوف
                              </span>
                            )}
                          </div>
                          {item.scientificName && (
                            <div className="text-[11px] font-medium text-sky-700">{item.scientificName}</div>
                          )}
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-slate-500" dir="ltr">
                            <span>{item.barcode}</span>
                            {item.company && <span className="font-sans">• {item.company}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          <span className="rounded bg-sky-100 px-2 py-0.5 font-semibold text-sky-800">
                            {item.categoryName || 'غير مصنف'}
                          </span>
                          <div className="mt-1 text-[11px] text-slate-500">{item.storageLocation || 'الرف A-1'}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-bold text-slate-800">
                            {item.quantity} {item.packUnit || 'علبة'}
                          </div>
                          {isOut ? (
                            <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                              نفد المخزون
                            </span>
                          ) : isLow ? (
                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                              منخفض (الحد {item.minStock})
                            </span>
                          ) : (
                            <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">
                              متوفر
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="font-mono text-xs text-slate-700" dir="ltr">
                            {item.expiryDate || '-'}
                          </div>
                          <div className="text-[11px] text-slate-500">{item.batchNumber || '-'}</div>
                          {expStatus === 'expired' && (
                            <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold text-red-700">
                              منتهي الصلاحية
                            </span>
                          )}
                          {expStatus === 'soon' && (
                            <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
                              قريب الانتهاء
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-xs">
                          <div className="font-bold text-emerald-700">
                            بيع: {formatMoney(item.price, site.currencySymbol)}
                          </div>
                          <div className="text-slate-500">
                            شراء: {formatMoney(item.purchasePrice || 0, site.currencySymbol)}
                            {margin !== null && <span className="mr-1 text-sky-700">({margin}%)</span>}
                          </div>
                          {item.stripsPerPack > 1 && (
                            <div className="text-[11px] text-slate-500">
                              {item.stripUnit}: {formatMoney(item.stripPrice || sellP / item.stripsPerPack, site.currencySymbol)}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-1">
                            {canSell && (
                              <button
                                type="button"
                                disabled={blockedForSale}
                                onClick={() => handleSell(item.id)}
                                title={blockedForSale ? 'غير صالح للبيع' : 'إضافة للفاتورة'}
                                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${
                                  addedFeedbackId === item.id
                                    ? 'bg-emerald-600'
                                    : 'bg-[#0B4F9C] hover:bg-[#083D7A]'
                                }`}
                              >
                                {addedFeedbackId === item.id ? (
                                  <>
                                    <Check className="h-3.5 w-3.5" />
                                    <span>أُضيف</span>
                                  </>
                                ) : (
                                  <>
                                    <ShoppingCart className="h-3.5 w-3.5" />
                                    <span>بيع</span>
                                  </>
                                )}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => void openBatchesModal(item)}
                              title="التشغيلات (Batches)"
                              className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                            >
                              <Layers className="h-3.5 w-3.5" />
                              <span>التشغيلات</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setBarcodePrintTarget(item);
                                setBarcodePrintOpen(true);
                              }}
                              title="طباعة ملصق الباركود لهذا الدواء"
                              className="inline-flex items-center rounded border border-emerald-300 bg-emerald-50 p-1.5 text-emerald-700 hover:bg-emerald-100"
                            >
                              <Barcode className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => void openMultiBarcodeModal(item)}
                              title="الباركودات المتعددة والوحدات (علبة/شريط/حبة)"
                              className="inline-flex items-center rounded border border-indigo-300 bg-indigo-50 p-1.5 text-indigo-700 hover:bg-indigo-100"
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => void openMovementCard(item)}
                              title="بطاقة حركة الصنف"
                              className="inline-flex items-center rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                            >
                              <History className="h-3.5 w-3.5" />
                            </button>

                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => setEditingItem({ ...item })}
                                title="تعديل"
                                className="inline-flex items-center rounded border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-100"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                            )}

                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteItem(item)}
                                title="حذف"
                                className="inline-flex items-center rounded bg-red-600 p-1.5 text-white hover:bg-red-700"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>إجمالي النتائج المعروضة: {filtered.length}</span>
          </div>
        </div>
      </div>

      {/* Batches Modal (FEFO + Quarantine/Expired/Damaged Isolation) */}
      {batchesMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <div className="flex items-center gap-2">
                <Layers className="h-5 w-5 text-[#0B4F9C]" />
                <h3 className="text-base font-bold text-slate-800">
                  تشغيلات الصنف (نظام FEFO): {batchesMed.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setBatchesMed(null)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {canManageBatches && (
                <form onSubmit={handleAddBatch} noValidate className="rounded border border-slate-200 bg-[#F3F6FA] p-3">
                  <div className="mb-2 text-xs font-bold text-[#0B4F9C]">إضافة تشغيلة / دفعة جديدة</div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={newBatchNo}
                      onChange={(e) => setNewBatchNo(e.target.value)}
                      placeholder="رقم التشغيلة"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-left text-xs"
                    />
                    <select
                      value={newBatchWarehouseId}
                      onChange={(e) => setNewBatchWarehouseId(Number(e.target.value))}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    >
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={newBatchProdDate}
                      onChange={(e) => setNewBatchProdDate(e.target.value)}
                      title="تاريخ الإنتاج"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                    <input
                      type="date"
                      required
                      value={newBatchExpDate}
                      onChange={(e) => setNewBatchExpDate(e.target.value)}
                      title="تاريخ الانتهاء"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      required
                      value={newBatchQty}
                      onChange={(e) => setNewBatchQty(e.target.value)}
                      placeholder="الكمية"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={batchBusy}
                      className="rounded bg-[#145632] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0f4126]"
                    >
                      إضافة تشغيلة
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full border-collapse text-right text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border-b px-3 py-2">رقم التشغيلة</th>
                      <th className="border-b px-3 py-2">المستودع</th>
                      <th className="border-b px-3 py-2">الإنتاج / الانتهاء</th>
                      <th className="border-b px-3 py-2">المتبقي / الأولي</th>
                      <th className="border-b px-3 py-2">سعر التكلفة</th>
                      <th className="border-b px-3 py-2">الحالة</th>
                      {canManageBatches && <th className="border-b px-3 py-2">عزل / تحكم</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {batches.map((b, idx) => (
                      <tr key={b.id} className={b.status !== 'active' ? 'bg-red-50/50' : idx === 0 ? 'bg-emerald-50/40' : ''}>
                        <td className="px-3 py-2 font-mono font-bold">
                          {b.batch_number}
                          {idx === 0 && b.status === 'active' && b.qty_remaining > 0 && (
                            <span className="mr-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-800">
                              أولوية الصرف FEFO
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">{b.warehouse_name || `#${b.warehouse_id}`}</td>
                        <td className="px-3 py-2 font-mono" dir="ltr">
                          {b.production_date || '-'} / <strong>{b.expiry_date}</strong>
                        </td>
                        <td className="px-3 py-2 font-bold">
                          {b.qty_remaining} / {b.qty_initial}
                        </td>
                        <td className="px-3 py-2">{formatMoney(b.purchase_price, site.currencySymbol)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                              b.status === 'active'
                                ? 'bg-emerald-100 text-emerald-800'
                                : b.status === 'quarantined'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {b.status === 'active'
                              ? 'نشطة للبيع'
                              : b.status === 'quarantined'
                                ? 'حجر صحي'
                                : b.status === 'expired'
                                  ? 'منتهية معزولة'
                                  : 'تالف'}
                          </span>
                        </td>
                        {canManageBatches && (
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {b.status !== 'active' && (
                                <button
                                  type="button"
                                  disabled={batchBusy}
                                  onClick={() => void handleBatchStatus(b.id, 'active')}
                                  className="rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white"
                                >
                                  تفعيل
                                </button>
                              )}
                              {b.status === 'active' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={batchBusy}
                                    onClick={() => void handleBatchStatus(b.id, 'quarantined')}
                                    className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white"
                                  >
                                    حجر صحي
                                  </button>
                                  <button
                                    type="button"
                                    disabled={batchBusy}
                                    onClick={() => void handleBatchStatus(b.id, 'damaged')}
                                    className="inline-flex items-center gap-0.5 rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white"
                                  >
                                    <ShieldAlert className="h-3 w-3" />
                                    إتلاف/عزل
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Item Movement Card Modal */}
      {movementMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-[#0B4F9C]" />
                <h3 className="text-base font-bold text-slate-800">بطاقة حركة الصنف: {movementMed.name}</h3>
              </div>
              <button
                type="button"
                onClick={() => setMovementMed(null)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="border-b px-3 py-2">التاريخ</th>
                    <th className="border-b px-3 py-2">نوع الحركة</th>
                    <th className="border-b px-3 py-2">المستودع / التشغيلة</th>
                    <th className="border-b px-3 py-2">التغير</th>
                    <th className="border-b px-3 py-2">الرصيد بعد</th>
                    <th className="border-b px-3 py-2">البيان / الموظف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {movements.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        لا توجد حركات مسجلة لهذا الصنف حتى الآن.
                      </td>
                    </tr>
                  ) : (
                    movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2 font-mono text-slate-500">{m.created_at}</td>
                        <td className="px-3 py-2 font-bold">{m.movement_type}</td>
                        <td className="px-3 py-2">
                          {m.warehouse_name || `#${m.warehouse_id}`} • {m.batch_number || '-'}
                        </td>
                        <td className={`px-3 py-2 font-bold ${m.qty_change >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {m.qty_change >= 0 ? `+${m.qty_change}` : m.qty_change}
                        </td>
                        <td className="px-3 py-2 font-bold">{m.balance_after}</td>
                        <td className="px-3 py-2 text-slate-600">
                          {m.notes} ({m.user_name || '-'})
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

      {/* Edit Medicine Modal */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">تعديل بيانات الدواء والوحدات</h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSaveEdit} noValidate className="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الاسم التجاري</label>
                  <input
                    type="text"
                    required
                    value={editingItem.name}
                    onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الاسم العلمي</label>
                  <input
                    type="text"
                    value={editingItem.scientificName}
                    onChange={(e) => setEditingItem({ ...editingItem, scientificName: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">التصنيف</label>
                  <select
                    value={editingItem.catId}
                    onChange={(e) => setEditingItem({ ...editingItem, catId: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الشكل الصيدلاني</label>
                  <select
                    value={editingItem.dosageForm || 'أقراص'}
                    onChange={(e) => setEditingItem({ ...editingItem, dosageForm: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    {DOSAGE_FORMS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">التركيز / الجرعة</label>
                  <input
                    type="text"
                    value={editingItem.unit}
                    onChange={(e) => setEditingItem({ ...editingItem, unit: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">حالة الصنف</label>
                  <select
                    value={editingItem.status || 'active'}
                    onChange={(e) => setEditingItem({ ...editingItem, status: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  >
                    <option value="active">نشط ومسموح بصرفه</option>
                    <option value="suspended">موقوف عن الصرف</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    سعر الشراء ({site.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={editingItem.purchasePrice}
                    onChange={(e) => setEditingItem({ ...editingItem, purchasePrice: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">
                    سعر البيع للعلبة ({site.currencySymbol})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={editingItem.price}
                    onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الأشرطة / العلبة وسعر الشريط</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min="1"
                      value={editingItem.stripsPerPack}
                      onChange={(e) => setEditingItem({ ...editingItem, stripsPerPack: Number(e.target.value) })}
                      className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm"
                      title="عدد الأشرطة"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingItem.stripPrice}
                      onChange={(e) => setEditingItem({ ...editingItem, stripPrice: Number(e.target.value) })}
                      className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm"
                      title="سعر الشريط"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الحبات / العلبة وسعر الحبة</label>
                  <div className="flex gap-1">
                    <input
                      type="number"
                      min="1"
                      value={editingItem.piecesPerPack}
                      onChange={(e) => setEditingItem({ ...editingItem, piecesPerPack: Number(e.target.value) })}
                      className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm"
                      title="عدد الحبات"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editingItem.piecePrice}
                      onChange={(e) => setEditingItem({ ...editingItem, piecePrice: Number(e.target.value) })}
                      className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm"
                      title="سعر الحبة"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">حد التنبيه الأدنى</label>
                  <input
                    type="number"
                    min="0"
                    required
                    value={editingItem.minStock}
                    onChange={(e) => setEditingItem({ ...editingItem, minStock: Number(e.target.value) })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">موقع التخزين / الرف</label>
                  <input
                    type="text"
                    value={editingItem.storageLocation}
                    onChange={(e) => setEditingItem({ ...editingItem, storageLocation: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الباركود</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editingItem.barcode}
                    onChange={(e) => setEditingItem({ ...editingItem, barcode: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-left text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">المورد</label>
                  <input
                    type="text"
                    list="suppliers-datalist"
                    value={editingItem.supplier}
                    onChange={(e) => setEditingItem({ ...editingItem, supplier: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                  <datalist id="suppliers-datalist">
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.name} />
                    ))}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الشركة المصنعة</label>
                  <input
                    type="text"
                    value={editingItem.company}
                    onChange={(e) => setEditingItem({ ...editingItem, company: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-amber-800">
                  <input
                    type="checkbox"
                    checked={editingItem.requiresPrescription}
                    onChange={(e) => setEditingItem({ ...editingItem, requiresPrescription: e.target.checked })}
                    className="h-4 w-4 rounded"
                  />
                  <span>يتطلب وصفة طبية عند الصرف</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-red-800 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={Boolean(editingItem.isControlled)}
                    onChange={(e) =>
                      setEditingItem({
                        ...editingItem,
                        isControlled: e.target.checked,
                        requiresPrescription: e.target.checked ? true : editingItem.requiresPrescription,
                      })
                    }
                    className="h-4 w-4 rounded"
                  />
                  <span>دواء مقيد بالرقابة (يتطلب هوية المريض ورقم الوصفة في POS)</span>
                </label>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الجدول الرقابي</label>
                  <input
                    type="text"
                    value={editingItem.controlledSchedule || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, controlledSchedule: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الجرعة القصوى</label>
                  <input
                    type="text"
                    value={editingItem.maxDailyDose || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, maxDailyDose: e.target.value })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">تصنيف الحمل</label>
                  <input
                    type="text"
                    value={editingItem.pregnancyCategory || ''}
                    onChange={(e) => setEditingItem({ ...editingItem, pregnancyCategory: e.target.value })}
                    placeholder="A / B / C / D / X"
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">الوصف</label>
                <textarea
                  rows={2}
                  value={editingItem.description}
                  onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                  className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                />
              </div>
              <ImagePickerField
                label="صورة الدواء"
                value={editingItem.pic}
                onChange={(val) => setEditingItem({ ...editingItem, pic: val })}
                fallback="tablet.png"
              />
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded border border-slate-300 bg-white px-4 py-1.5 text-sm font-semibold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="rounded bg-[#0B4F9C] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#083D7A]"
                >
                  {savingEdit ? 'جاري التحديث...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDeleteItem)}
        title="تأكيد حذف الدواء"
        message={`هل أنت متأكد من حذف الدواء "${confirmDeleteItem?.name ?? ''}" من المخزون بشكل نهائي؟`}
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteItem(null)}
      />

      <BarcodeLabelsPrintModal
        open={barcodePrintOpen}
        site={site}
        inventories={inventories}
        filteredInventories={filtered}
        singleMedicine={barcodePrintTarget}
        onClose={() => {
          setBarcodePrintOpen(false);
          setBarcodePrintTarget(null);
        }}
      />

      {/* Multi-Barcode & Unit/Batch Binding Modal (Stage 4) */}
      {barcodeMed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-[#0B4F9C]" />
                <div>
                  <h3 className="text-base font-bold text-slate-800">
                    إدارة الباركودات المتعددة والوحدات: {barcodeMed.name}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    ربط باركود مستقل للعلبة، الشريط، الحبة، الكرتون، أو تشغيلة محددة مع دعم GS1 و EAN-13
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBarcodeMed(null)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 p-4">
              {barcodeModalMsg && (
                <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {barcodeModalMsg}
                </div>
              )}

              {canEdit && (
                <form onSubmit={handleAssignBarcode} noValidate className="space-y-3 rounded border border-slate-200 bg-[#F3F6FA] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#0B4F9C]">إضافة / ربط باركود جديد للصنف</span>
                    <button
                      type="button"
                      disabled={barcodeBusy}
                      onClick={() => void handleGenerateBarcodeCode()}
                      className="inline-flex items-center gap-1 rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>توليد باركود داخلي (200 EAN-13)</span>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">رقم الباركود (امسح بالماسح أو اكتب)</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={newBcCode}
                        onChange={(e) => setNewBcCode(e.target.value)}
                        placeholder="628... أو 200..."
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-left font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">الوحدة المرتبطة</label>
                      <select
                        value={newBcUnitType}
                        onChange={(e) =>
                          setNewBcUnitType(e.target.value as 'pack' | 'strip' | 'piece' | 'box' | 'batch')
                        }
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="pack">{barcodeMed.packUnit || 'علبة'} (وحدة كاملة = 1)</option>
                        <option value="strip">
                          {barcodeMed.stripUnit || 'شريط'} (معامل 1/{barcodeMed.stripsPerPack || 1})
                        </option>
                        <option value="piece">
                          {barcodeMed.pieceUnit || 'حبة'} (معامل 1/{barcodeMed.piecesPerPack || 1})
                        </option>
                        <option value="box">كرتون / عبوة جملة</option>
                        <option value="batch">باركود خاص بتشغيلة</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-slate-600">ربط بتشغيلة (اختياري)</label>
                      <select
                        value={newBcBatchId}
                        onChange={(e) => setNewBcBatchId(e.target.value ? Number(e.target.value) : '')}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                      >
                        <option value="">كل التشغيلات (FEFO تلقائي)</option>
                        {medBatchesForBarcode.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.batch_number} (ينتهي {b.expiry_date})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex flex-wrap items-center gap-4 text-xs">
                      <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-slate-700">
                        <input
                          type="checkbox"
                          checked={newBcValidateDigit}
                          onChange={(e) => setNewBcValidateDigit(e.target.checked)}
                          className="h-3.5 w-3.5 rounded"
                        />
                        <span>التحقق من رقم التحقق Check Digit (EAN-13 / EAN-8 / GTIN-14)</span>
                      </label>
                      <label className="flex cursor-pointer items-center gap-1.5 font-semibold text-amber-800">
                        <input
                          type="checkbox"
                          checked={newBcPrimary}
                          onChange={(e) => setNewBcPrimary(e.target.checked)}
                          className="h-3.5 w-3.5 rounded"
                        />
                        <span>تعيين كباركود أساسي للدواء</span>
                      </label>
                    </div>
                    <button
                      type="submit"
                      disabled={barcodeBusy}
                      className="rounded bg-[#0B4F9C] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#083D7A] disabled:opacity-60"
                    >
                      {barcodeBusy ? 'جاري الحفظ...' : 'ربط وحفظ الباركود'}
                    </button>
                  </div>
                </form>
              )}

              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full border-collapse text-right text-xs">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border-b px-3 py-2">الرمز والتمثيل</th>
                      <th className="border-b px-3 py-2">التنسيق</th>
                      <th className="border-b px-3 py-2">الوحدة / المعامل</th>
                      <th className="border-b px-3 py-2">التشغيلة</th>
                      <th className="border-b px-3 py-2">الحالة</th>
                      {canEdit && <th className="border-b px-3 py-2">إجراءات</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {medBarcodes.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                          لا توجد باركودات مسجلة لهذا الصنف حتى الآن.
                        </td>
                      </tr>
                    ) : (
                      medBarcodes.map((bc) => (
                        <tr key={bc.id} className={!bc.is_active ? 'bg-slate-50 opacity-60' : ''}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-3">
                              <BarcodeSvg
                                value={bc.barcode}
                                symbology={bc.symbology as 'CODE128' | 'EAN13' | 'EAN8' | 'ITF14' | 'QR' | 'GS1_DATAMATRIX'}
                                height={28}
                                width={1.2}
                                fontSize={9}
                                displayValue={false}
                              />
                              <div>
                                <div className="font-mono font-bold text-slate-900" dir="ltr">
                                  {bc.barcode}
                                </div>
                                {bc.is_primary === 1 && (
                                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                    <Star className="h-2.5 w-2.5" />
                                    أساسي
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 font-mono">{bc.symbology}</td>
                          <td className="px-3 py-2">
                            <span className="font-bold text-slate-800">{bc.unit_name}</span>{' '}
                            <span className="text-[11px] text-slate-500">
                              ({bc.unit_type} × {bc.unit_factor})
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px]">{bc.batch_number || 'عام (FEFO)'}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                bc.is_active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              {bc.is_active ? 'نشط' : 'معطل'}
                            </span>
                          </td>
                          {canEdit && (
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {bc.is_primary === 0 && (
                                  <button
                                    type="button"
                                    disabled={barcodeBusy}
                                    onClick={() => void handlePromotePrimaryBarcode(bc.id)}
                                    title="ترقية كباركود أساسي"
                                    className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                                  >
                                    تعيين كأساسي
                                  </button>
                                )}
                                {bc.is_primary === 0 && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={barcodeBusy}
                                      onClick={() => void handleToggleBarcodeActive(bc)}
                                      title={bc.is_active ? 'تعطيل' : 'تفعيل'}
                                      className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
                                    >
                                      <Power className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={barcodeBusy}
                                      onClick={() => void handleDeleteSecondaryBarcode(bc.id)}
                                      title="حذف الباركود الإضافي"
                                      className="rounded bg-red-600 p-1 text-white hover:bg-red-700"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {barcodeHistory.length > 0 && (
                <div className="rounded border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <History className="h-4 w-4 text-[#0B4F9C]" />
                    <span>سجل تغييرات الباركود لهذا الصنف ({barcodeHistory.length})</span>
                  </div>
                  <div className="max-h-36 space-y-1 overflow-y-auto text-[11px]">
                    {barcodeHistory.map((h) => (
                      <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-2.5 py-1.5">
                        <div>
                          <span className="font-bold text-[#0B4F9C]">{h.action}</span> —{' '}
                          <span className="font-mono" dir="ltr">
                            {h.old_barcode || '—'} → {h.new_barcode || '—'}
                          </span>{' '}
                          <span className="text-slate-500">({h.notes})</span>
                        </div>
                        <div className="font-mono text-slate-400" dir="ltr">
                          {h.changed_by_name} · {h.created_at.slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
