import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Receipt,
  Trash2,
  Plus,
  Minus,
  CheckCircle2,
  Printer,
  ShoppingBag,
  X,
  Barcode,
  AlertCircle,
  Maximize2,
  PauseCircle,
  PlayCircle,
  Clock,
  RotateCcw,
  Ban,
  Search,
  FileText,
} from 'lucide-react';
import { api } from '../api';
import type {
  BillItem,
  CartClinicalCheck,
  Customer,
  HeldBill,
  InsuranceCompany,
  InventoryItem,
  PosShift,
  Prescription,
  SalesReturnRecord,
  SiteSettings,
  SoldInvoice,
  User,
} from '../types';
import { formatMoney, getAvailableCurrencies, resolveCurrencyInfo, convertFromBase, hasPermission } from '../types';
import {
  findPosPrefixMatches,
  normalizePosDigits,
  normalizeScannerInput,
  type PosSearchMatch,
} from '../utils/posSearch';
import { attachHidScannerListener } from '../utils/scannerService';
import { ConfirmModal } from '../components/ConfirmModal';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { showErrorPopup, validationError } from '../lib/errorPopup';

interface BillingPageProps {
  user: User;
  bill: BillItem[];
  site: SiteSettings;
  inventories: InventoryItem[];
  customers: Customer[];
  prescriptions: Prescription[];
  recentSales: SoldInvoice[];
  initialPrescriptionId?: number | null;
  onClearInitialPrescription?: () => void;
  onUpdateBill: (nextBill: BillItem[]) => void;
  onScanBarcode: (code: string) => Promise<InventoryItem>;
  onClearBill: () => Promise<void>;
  onCheckoutDone: () => Promise<void>;
  onGoInventories: () => void;
}

export const BillingPage: React.FC<BillingPageProps> = ({
  user,
  bill,
  site,
  inventories,
  customers,
  prescriptions,
  recentSales,
  initialPrescriptionId,
  onClearInitialPrescription,
  onUpdateBill,
  onScanBarcode,
  onClearBill,
  onCheckoutDone,
  onGoInventories,
}) => {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [quickSearch, setQuickSearch] = useState('');
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const [quickHighlightIdx, setQuickHighlightIdx] = useState(-1);
  const [barcodeSuggestionsOpen, setBarcodeSuggestionsOpen] = useState(false);
  const [barcodeHighlightIdx, setBarcodeHighlightIdx] = useState(-1);
  const quickSearchBoxRef = useRef<HTMLDivElement | null>(null);
  const barcodeBoxRef = useRef<HTMLDivElement | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  // Checkout fields
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [selectedPrescriptionId, setSelectedPrescriptionId] = useState<string>(
    initialPrescriptionId ? String(initialPrescriptionId) : '',
  );
  const [buyerName, setBuyerName] = useState('عميل نقدي');
  const [contact, setContact] = useState('');
  const [discount, setDiscount] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit' | 'partial'>('cash');
  const [paidAmount, setPaidAmount] = useState('0');
  const [submitting, setSubmitting] = useState(false);
  const [pageMsg, setPageMsg] = useState('');
  const [completedInvoice, setCompletedInvoice] = useState<SoldInvoice | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Clinical Safety, Controlled Drugs, Insurance & Loyalty State
  const [clinicalCheck, setClinicalCheck] = useState<CartClinicalCheck | null>(null);
  const [insuranceCompanies, setInsuranceCompanies] = useState<InsuranceCompany[]>([]);
  const [selectedInsuranceId, setSelectedInsuranceId] = useState<string>('');
  const [insurancePolicyNo, setInsurancePolicyNo] = useState('');
  const [insuranceApprovalCode, setInsuranceApprovalCode] = useState('');
  const [insuranceCoveragePct, setInsuranceCoveragePct] = useState('80');
  const [applyPromotions, setApplyPromotions] = useState(true);
  const [redeemPoints, setRedeemPoints] = useState('0');
  const [ctrlNationalId, setCtrlNationalId] = useState('');
  const [ctrlRxNumber, setCtrlRxNumber] = useState('');
  const [ctrlDoctorName, setCtrlDoctorName] = useState('');

  // Shifts & Held Bills
  const [currentShift, setCurrentShift] = useState<PosShift | null>(null);
  const [shiftModalMode, setShiftModalMode] = useState<'open' | 'close' | null>(null);
  const [openingCash, setOpeningCash] = useState('500');
  const [actualCash, setActualCash] = useState('0');
  const [shiftNotes, setShiftNotes] = useState('');
  const [heldBills, setHeldBills] = useState<HeldBill[]>([]);
  const [heldModalOpen, setHeldModalOpen] = useState(false);

  // Recent Invoices & Returns
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [returnTargetInvoice, setReturnTargetInvoice] = useState<SoldInvoice | null>(null);
  const [returnQtys, setReturnQtys] = useState<Record<number, number>>({});
  const [returnReason, setReturnReason] = useState('مرتجع عميل');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'credit_note'>('cash');
  const [salesReturns, setSalesReturns] = useState<SalesReturnRecord[]>([]);
  const [confirmCancelInvoice, setConfirmCancelInvoice] = useState<SoldInvoice | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const availableCurrencies = useMemo(() => getAvailableCurrencies(site), [site]);
  const [invoiceCurrencyCode, setInvoiceCurrencyCode] = useState<string>(
    site.autoConvertCurrencies ? site.defaultDisplayCurrency || site.currencyCode : site.currencyCode,
  );

  useEffect(() => {
    setInvoiceCurrencyCode(
      site.autoConvertCurrencies ? site.defaultDisplayCurrency || site.currencyCode : site.currencyCode,
    );
  }, [site]);

  const activeCurrency = useMemo(
    () => resolveCurrencyInfo(site, invoiceCurrencyCode),
    [site, invoiceCurrencyCode],
  );
  const convRate = activeCurrency.rateToBase;

  const canManageShifts = hasPermission(user, 'manageShifts');
  const canCancelInvoice = hasPermission(user, 'cancelInvoices');
  const canReturn = hasPermission(user, 'processReturns');

  const loadPosMeta = useCallback(async () => {
    try {
      const [sRes, hRes, insRes] = await Promise.all([
        api.getShifts(),
        api.getHeldBills(),
        api.getInsuranceCompanies().catch(() => ({ companies: [] as InsuranceCompany[] })),
      ]);
      setCurrentShift(sRes.currentShift);
      setHeldBills(hRes.held);
      setInsuranceCompanies(insRes.companies.filter((c) => c.is_active));
      if (sRes.currentShift) {
        setActualCash(String(sRes.currentShift.expected_cash));
      }
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 403) {
        showErrorPopup(err, 'تحميل بيانات الوردية والفواتير المعلقة');
      }
    }
  }, []);

  useEffect(() => {
    void loadPosMeta();
  }, [loadPosMeta]);

  useEffect(() => {
    if (bill.length === 0) {
      setClinicalCheck(null);
      return;
    }
    let cancelled = false;
    const medIds = Array.from(new Set(bill.map((b) => b.id)));
    void api
      .clinicalCheckCart({
        medicineIds: medIds,
        customerId: selectedCustomerId ? Number(selectedCustomerId) : null,
      })
      .then((res) => {
        if (!cancelled) setClinicalCheck(res);
      })
      .catch(() => {
        if (!cancelled) setClinicalCheck(null);
      });
    return () => {
      cancelled = true;
    };
  }, [bill, selectedCustomerId]);

  useEffect(() => {
    if (initialPrescriptionId) {
      setSelectedPrescriptionId(String(initialPrescriptionId));
      const rx = prescriptions.find((p) => p.id === initialPrescriptionId);
      if (rx) {
        setSelectedCustomerId(String(rx.customer_id));
        setBuyerName(rx.customer_name);
        if (rx.customer_phone) setContact(rx.customer_phone);
      }
    }
  }, [initialPrescriptionId, prescriptions]);

  const baseSubtotal = useMemo(
    () =>
      bill.reduce((sum, item) => {
        const lineGross = item.price * item.qty;
        const lineNet = lineGross - (lineGross * (item.discountPct || 0)) / 100;
        return sum + lineNet;
      }, 0),
    [bill],
  );
  const discountPct = Math.min(100, Math.max(0, Number(discount) || 0));
  const selectedCustomerObj = useMemo(
    () => customers.find((c) => String(c.id) === selectedCustomerId) || null,
    [customers, selectedCustomerId],
  );
  const availCustomerPoints = selectedCustomerObj?.loyalty_points || 0;
  const redeemedPtsNum = selectedCustomerId ? Math.min(availCustomerPoints, Math.max(0, Math.floor(Number(redeemPoints) || 0))) : 0;
  const loyaltyDiscountBase = Number((redeemedPtsNum * 0.05).toFixed(2));
  const baseAfterDiscountAndLoyalty = Number(
    Math.max(0, baseSubtotal - (baseSubtotal * discountPct) / 100 - loyaltyDiscountBase).toFixed(2),
  );
  const selectedInsObj = useMemo(
    () => insuranceCompanies.find((c) => String(c.id) === selectedInsuranceId) || null,
    [insuranceCompanies, selectedInsuranceId],
  );
  const insCovPctNum = selectedInsObj ? Math.min(100, Math.max(0, Number(insuranceCoveragePct) || 0)) : 0;
  const baseInsuranceShare = selectedInsObj
    ? Math.min(
        selectedInsObj.max_claim_limit || baseAfterDiscountAndLoyalty,
        Number(((baseAfterDiscountAndLoyalty * insCovPctNum) / 100).toFixed(2)),
      )
    : 0;
  const baseFinalAmount = Number(Math.max(0, baseAfterDiscountAndLoyalty - baseInsuranceShare).toFixed(2));
  const subtotal = Number((baseSubtotal * convRate).toFixed(2));
  const finalAmount = convRate === 1 ? baseFinalAmount : Number((baseFinalAmount * convRate).toFixed(2));
  const displayInsuranceShare = convRate === 1 ? baseInsuranceShare : Number((baseInsuranceShare * convRate).toFixed(2));

  const quickSearchMatches = useMemo(
    () => findPosPrefixMatches(inventories, quickSearch),
    [quickSearch, inventories],
  );

  const barcodeMatches = useMemo(
    () => findPosPrefixMatches(inventories, barcodeInput, { preferBarcodeFirst: true }),
    [barcodeInput, inventories],
  );

  useEffect(() => {
    setQuickHighlightIdx(quickSearchMatches.length > 0 ? 0 : -1);
  }, [quickSearchMatches]);

  useEffect(() => {
    setBarcodeHighlightIdx(-1);
  }, [barcodeMatches]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (quickSearchBoxRef.current && target && !quickSearchBoxRef.current.contains(target)) {
        setQuickSearchOpen(false);
      }
      if (barcodeBoxRef.current && target && !barcodeBoxRef.current.contains(target)) {
        setBarcodeSuggestionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  const executeBarcodeScan = React.useCallback(
    async (rawInput: string) => {
      const hasGsOrAim = /\x1D/.test(rawInput) || /^\][A-Za-z0-9]{2}/.test(rawInput.trimStart());
      const normalizedCode = normalizeScannerInput(rawInput, {
        preserveGs: true,
        fixArabicLayout: hasGsOrAim,
      });
      if (!normalizedCode) {
        validationError('يرجى مسح أو كتابة رقم الباركود قبل الإضافة.', 'قراءة الباركود');
        return;
      }
      setPageMsg('');
      try {
        const added = await onScanBarcode(normalizedCode);
        setBarcodeInput('');
        setBarcodeSuggestionsOpen(false);
        setBarcodeHighlightIdx(-1);
        setPageMsg(`تمت إضافة "${added.name}" (${added.barcode})`);
        setTimeout(() => setPageMsg(''), 2500);
      } catch (err) {
        showErrorPopup(err, 'قراءة الباركود وإضافة الصنف للسلة');
      }
    },
    [onScanBarcode],
  );

  // Global USB / Bluetooth HID Keyboard-Wedge Scanner Listener on POS screen
  useEffect(() => {
    return attachHidScannerListener({
      burstMaxIntervalMs: 70,
      minLength: 4,
      ignoredElement: () => barcodeInputRef.current,
      isSuspended: () =>
        checkoutOpen ||
        confirmClearOpen ||
        shiftModalMode !== null ||
        heldModalOpen ||
        showHistoryModal ||
        Boolean(returnTargetInvoice) ||
        Boolean(confirmCancelInvoice),
      onScan: (payload) => {
        void executeBarcodeScan(payload.raw);
      },
    });
  }, [
    checkoutOpen,
    confirmClearOpen,
    shiftModalMode,
    heldModalOpen,
    showHistoryModal,
    returnTargetInvoice,
    confirmCancelInvoice,
    executeBarcodeScan,
  ]);

  const handleBarcodeScan = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeBarcodeScan(barcodeInput);
  };

  const handleQuickAdd = async (med: InventoryItem) => {
    if (med.status === 'suspended' || med.quantity <= 0) return;
    try {
      const res = await api.addToBill(med.id);
      onUpdateBill(res.bill);
      setQuickSearch('');
      setQuickSearchOpen(false);
      setQuickHighlightIdx(-1);
      setBarcodeInput('');
      setBarcodeSuggestionsOpen(false);
      setBarcodeHighlightIdx(-1);
      setPageMsg(`تمت إضافة "${med.name}" للسلة`);
      setTimeout(() => setPageMsg(''), 2000);
    } catch (err) {
      showErrorPopup(err, 'إضافة الصنف إلى الفاتورة');
    }
  };

  const renderHighlightedPrefix = (value: string, active: boolean, len: number) => {
    if (!active || len <= 0) return <>{value}</>;
    return (
      <>
        <mark className="rounded bg-amber-200 px-0.5 font-extrabold text-slate-900">
          {value.slice(0, len)}
        </mark>
        <span>{value.slice(len)}</span>
      </>
    );
  };

  const renderSuggestionDropdown = (
    queryText: string,
    matches: PosSearchMatch[],
    highlightIdx: number,
    onHoverIdx: (idx: number) => void,
    onSelect: (med: InventoryItem) => Promise<void>,
  ) => {
    const trimmed = queryText.trim();
    if (!trimmed) return null;
    return (
      <div className="absolute right-0 left-0 top-full z-30 mt-1 overflow-hidden rounded border border-slate-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-600">
          <span>
            تلميحات الأدوية التي تبدأ بـ &quot;{trimmed}&quot;
          </span>
          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">
            {matches.length} صنف
          </span>
        </div>
        {matches.length === 0 ? (
          <div className="px-3 py-3 text-center text-xs text-slate-500">
            لا توجد أدوية يبدأ اسمها أو رمزها أو تركيزها بـ &quot;{trimmed}&quot;
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
            {matches.map((match, idx) => {
              const { item: m, matchedField, matchedLen, available } = match;
              const isHighlighted = idx === highlightIdx;
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={!available}
                  onMouseEnter={() => onHoverIdx(idx)}
                  onClick={() => void onSelect(m)}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-xs transition ${
                    !available
                      ? 'cursor-not-allowed bg-slate-50 opacity-60'
                      : isHighlighted
                        ? 'bg-sky-100/80 ring-1 ring-inset ring-[#0B4F9C]'
                        : 'hover:bg-sky-50'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 font-bold text-slate-800">
                      <span>{renderHighlightedPrefix(m.name, matchedField === 'name', matchedLen)}</span>
                      <span className="text-slate-600">
                        ({renderHighlightedPrefix(m.unit, matchedField === 'unit', matchedLen)})
                      </span>
                      {m.dosageForm && <span className="font-normal text-slate-500">— {m.dosageForm}</span>}
                      {m.status === 'suspended' && (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                          موقوف
                        </span>
                      )}
                      {m.status !== 'suspended' && m.quantity <= 0 && (
                        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                          نفد المخزون
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-sky-700">
                      <span>
                        {m.scientificName
                          ? renderHighlightedPrefix(
                              m.scientificName,
                              matchedField === 'scientificName',
                              matchedLen,
                            )
                          : m.company}
                      </span>
                      <span>•</span>
                      <span dir="ltr" className="font-mono text-slate-600">
                        {renderHighlightedPrefix(m.barcode, matchedField === 'barcode', matchedLen)}
                      </span>
                      <span>•</span>
                      <span className={m.quantity > 0 ? 'text-emerald-700 font-semibold' : 'text-red-600 font-semibold'}>
                        المتاح: {m.quantity} {m.packUnit}
                      </span>
                    </div>
                  </div>
                  <span className="shrink-0 font-bold text-emerald-700">
                    {formatMoney(Number(m.price) * convRate, activeCurrency.symbol)}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const handleUpdateLine = async (
    item: BillItem,
    patch: { qty?: number; saleUnit?: string; discountPct?: number },
  ) => {
    try {
      const res = await api.updateBillItem(item.id, {
        ...patch,
        currentSaleUnit: item.saleUnit,
      });
      onUpdateBill(res.bill);
    } catch (err) {
      showErrorPopup(err, 'تحديث بند في الفاتورة');
    }
  };

  const handleRemoveItem = async (item: BillItem) => {
    try {
      const res = await api.removeBillItem(item.id, item.saleUnit);
      onUpdateBill(res.bill);
    } catch (err) {
      showErrorPopup(err, 'إزالة الصنف من الفاتورة');
    }
  };

  const handleConfirmClear = async () => {
    setClearing(true);
    try {
      await onClearBill();
      setConfirmClearOpen(false);
    } catch (err) {
      setConfirmClearOpen(false);
      showErrorPopup(err, 'مسح سلة الفاتورة');
    } finally {
      setClearing(false);
    }
  };

  const handleHoldBill = async () => {
    try {
      const res = await api.holdBill({
        customerName: buyerName,
        discount: discountPct,
      });
      onUpdateBill(res.bill);
      await loadPosMeta();
      setPageMsg('تم تعليق الفاتورة بنجاح، يمكنك استكمالها لاحقاً');
      setTimeout(() => setPageMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, 'تعليق الفاتورة');
    }
  };

  const handleResumeHeld = async (id: number) => {
    try {
      const res = await api.resumeHeldBill(id);
      onUpdateBill(res.bill);
      if (res.customerName) setBuyerName(res.customerName);
      setDiscount(String(res.discount || 0));
      setHeldModalOpen(false);
      await loadPosMeta();
    } catch (err) {
      showErrorPopup(err, 'استرجاع الفاتورة المعلقة');
    }
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    const cashNum = Number(openingCash);
    if (!Number.isFinite(cashNum) || cashNum < 0) {
      validationError('يرجى إدخال رصيد نقدي افتتاحي صحيح (صفر أو أكبر).', 'فتح وردية كاشير');
      return;
    }
    setActionBusy(true);
    try {
      await api.openShift({ openingCash: cashNum });
      setShiftModalMode(null);
      await loadPosMeta();
      setPageMsg('تم فتح الوردية بنجاح');
    } catch (err) {
      showErrorPopup(err, 'فتح وردية كاشير');
    } finally {
      setActionBusy(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentShift) return;
    const actualNum = Number(actualCash);
    if (!Number.isFinite(actualNum) || actualNum < 0) {
      validationError('يرجى إدخال قيمة النقدية الفعلية المعدودة بشكل صحيح.', 'إغلاق الوردية');
      return;
    }
    setActionBusy(true);
    try {
      const res = await api.closeShift(currentShift.id, {
        actualCash: actualNum,
        notes: shiftNotes,
      });
      setShiftModalMode(null);
      await loadPosMeta();
      setPageMsg(
        `تم إغلاق الوردية #${res.shift.id} — الفارق: ${formatMoney(res.shift.variance || 0, site.currencySymbol)}`,
      );
    } catch (err) {
      showErrorPopup(err, 'إغلاق ومطابقة الوردية');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSelectCustomer = (custIdStr: string) => {
    setSelectedCustomerId(custIdStr);
    setRedeemPoints('0');
    const c = customers.find((x) => String(x.id) === custIdStr);
    if (c) {
      setBuyerName(c.name);
      setContact(c.phone || '');
      if (c.insurance_id) {
        setSelectedInsuranceId(String(c.insurance_id));
        const ic = insuranceCompanies.find((x) => x.id === c.insurance_id);
        if (ic) setInsuranceCoveragePct(String(ic.default_coverage_pct));
        if (c.policy_number) setInsurancePolicyNo(c.policy_number);
      }
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyerName.trim()) {
      validationError('يرجى إدخال اسم المشتري لإصدار الفاتورة.', 'إتمام الدفع وإصدار الفاتورة');
      return;
    }
    if (paymentMethod === 'credit' && !selectedCustomerId) {
      validationError(
        'البيع الآجل بالكامل يتطلب اختيار عميل مسجل من القائمة (لا يسمح بالآجل للعميل النقدي العام).',
        'إتمام الدفع وإصدار الفاتورة',
      );
      return;
    }
    if (paymentMethod === 'partial') {
      if (!selectedCustomerId) {
        validationError('الدفع الجزئي مع رصيد آجل متبقٍ يتطلب اختيار عميل مسجل من القائمة.', 'إتمام الدفع وإصدار الفاتورة');
        return;
      }
      const paidNum = Number(paidAmount);
      if (!Number.isFinite(paidNum) || paidNum <= 0 || paidNum >= finalAmount) {
        validationError(
          'في حالة الدفع الجزئي، يجب أن يكون المبلغ المدفوع أكبر من صفر وأقل من الإجمالي النهائي.',
          'إتمام الدفع وإصدار الفاتورة',
        );
        return;
      }
    }
    if ((clinicalCheck?.controlledMedicines?.length || 0) > 0) {
      if (!ctrlNationalId.trim() || (!ctrlRxNumber.trim() && !selectedPrescriptionId)) {
        validationError(
          'الصرف يحتوي على دواء مقيد بالرقابة — يجب إدخال رقم الهوية الوطنية ورقم الوصفة الطبية.',
          'توثيق الأدوية المقيدة',
        );
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await api.checkoutBill({
        name: buyerName.trim(),
        contact,
        discount: discountPct,
        paymentMethod,
        paidAmount: paymentMethod === 'partial' ? Number(paidAmount) || 0 : undefined,
        customerId: selectedCustomerId ? Number(selectedCustomerId) : null,
        prescriptionId: selectedPrescriptionId ? Number(selectedPrescriptionId) : null,
        invoiceCurrencyCode: activeCurrency.code,
        insuranceId: selectedInsuranceId ? Number(selectedInsuranceId) : null,
        policyNumber: insurancePolicyNo.trim(),
        approvalCode: insuranceApprovalCode.trim(),
        coveragePct: selectedInsuranceId ? insCovPctNum : undefined,
        redeemPoints: redeemedPtsNum,
        applyPromotions,
        controlledMeta:
          (clinicalCheck?.controlledMedicines?.length || 0) > 0
            ? {
                patientNationalId: ctrlNationalId.trim(),
                prescriptionNumber: ctrlRxNumber.trim() || (selectedPrescriptionId ? `RX-${selectedPrescriptionId}` : ''),
                doctorName: ctrlDoctorName.trim(),
              }
            : undefined,
      });
      onUpdateBill(res.bill);
      setCompletedInvoice(res.invoice);
      setCheckoutOpen(false);
      setBuyerName('عميل نقدي');
      setContact('');
      setDiscount('0');
      setPaymentMethod('cash');
      setPaidAmount('0');
      setSelectedCustomerId('');
      setSelectedPrescriptionId('');
      setSelectedInsuranceId('');
      setInsurancePolicyNo('');
      setInsuranceApprovalCode('');
      setRedeemPoints('0');
      setCtrlNationalId('');
      setCtrlRxNumber('');
      setCtrlDoctorName('');
      if (onClearInitialPrescription) onClearInitialPrescription();
      await Promise.all([onCheckoutDone(), loadPosMeta()]);
    } catch (err) {
      showErrorPopup(err, 'إتمام الدفع وإصدار الفاتورة');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelInvoice = async () => {
    if (!confirmCancelInvoice) return;
    setActionBusy(true);
    try {
      await api.cancelInvoice(confirmCancelInvoice.id);
      setConfirmCancelInvoice(null);
      await Promise.all([onCheckoutDone(), loadPosMeta()]);
      setPageMsg(`تم إلغاء الفاتورة #${confirmCancelInvoice.id} وعكس مخزونها وقيودها`);
    } catch (err) {
      setConfirmCancelInvoice(null);
      showErrorPopup(err, 'إلغاء الفاتورة');
    } finally {
      setActionBusy(false);
    }
  };

  const openReturnModal = async (inv: SoldInvoice) => {
    setReturnTargetInvoice(inv);
    const map: Record<number, number> = {};
    for (const it of inv.itemsDetail) {
      map[it.id] = 0;
    }
    setReturnQtys(map);
    try {
      const r = await api.getSalesReturns();
      setSalesReturns(r.returns);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status !== 403) {
        showErrorPopup(err, 'تحميل سجل مرتجعات المبيعات');
      }
    }
  };

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!returnTargetInvoice) return;
    const items = returnTargetInvoice.itemsDetail
      .filter((it) => (returnQtys[it.id] || 0) > 0)
      .map((it) => ({
        medicineId: it.id,
        qty: returnQtys[it.id],
        unitFactor: it.unitFactor || 1,
        refundPrice: it.price,
      }));
    if (items.length === 0) {
      validationError('يرجى تحديد كمية واحدة على الأقل للإرجاع قبل التأكيد.', 'تسجيل مرتجع مبيعات');
      return;
    }
    setActionBusy(true);
    try {
      const res = await api.createSalesReturn({
        soldId: returnTargetInvoice.id,
        reason: returnReason,
        refundMethod,
        items,
      });
      setReturnTargetInvoice(null);
      await Promise.all([onCheckoutDone(), loadPosMeta()]);
      setPageMsg(`تم تسجيل مرتجع مبيعات بمبلغ ${formatMoney(res.refundAmount, site.currencySymbol)}`);
    } catch (err) {
      showErrorPopup(err, 'تسجيل مرتجع المبيعات');
    } finally {
      setActionBusy(false);
    }
  };

  if (completedInvoice) {
    const invSymbol = completedInvoice.currencySymbol || site.currencySymbol;
    const invCode = completedInvoice.currencyCode || site.currencyCode;
    const invBaseAmt =
      completedInvoice.baseAmount !== undefined
        ? Number(completedInvoice.baseAmount)
        : Number(((Number(completedInvoice.amount) || 0) / (Number(completedInvoice.exchangeRate) || 1)).toFixed(2));
    const displayTargetCode = site.autoConvertCurrencies
      ? site.defaultDisplayCurrency || site.currencyCode
      : site.currencyCode;
    const displayTargetInfo = resolveCurrencyInfo(site, displayTargetCode);
    const convertedSummaryAmount = convertFromBase(invBaseAmt, displayTargetInfo.code, site);

    const invoiceBody = (
      <>
        <div className="mb-4 rounded bg-[#F3F6FA] p-4 text-sm">
          <div className="mb-2 flex items-center justify-between border-b border-slate-300 pb-2">
            <span className="font-bold text-[#145632]">فاتورة مبيعات رقم #{completedInvoice.id}</span>
            <span className="font-mono text-xs text-slate-600" dir="ltr">
              {completedInvoice.date}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <span className="text-slate-500">المشتري: </span>
              <span className="font-bold">{completedInvoice.name}</span>
            </div>
            <div>
              <span className="text-slate-500">رقم الهاتف: </span>
              <span className="font-mono">{completedInvoice.contact || '-'}</span>
            </div>
            <div>
              <span className="text-slate-500">الموظف: </span>
              <span className="font-bold">{completedInvoice.adminName}</span>
            </div>
            <div>
              <span className="text-slate-500">طريقة الدفع: </span>
              <span className="font-bold">
                {completedInvoice.paymentMethod === 'card'
                  ? 'بطاقة / شبكة'
                  : completedInvoice.paymentMethod === 'credit'
                    ? 'آجل'
                    : completedInvoice.paymentMethod === 'partial'
                      ? 'دفع جزئي'
                      : 'نقدي'}
              </span>
            </div>
          </div>
        </div>

        {completedInvoice.itemsDetail.length > 0 && (
          <table className="mb-4 w-full border-collapse text-right text-sm">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-200 px-3 py-2">الدواء</th>
                <th className="border border-slate-200 px-3 py-2">الوحدة / التشغيلة</th>
                <th className="border border-slate-200 px-3 py-2">السعر</th>
                <th className="border border-slate-200 px-3 py-2">الكمية</th>
                <th className="border border-slate-200 px-3 py-2">الخصم</th>
                <th className="border border-slate-200 px-3 py-2">المجموع</th>
              </tr>
            </thead>
            <tbody>
              {completedInvoice.itemsDetail.map((it, idx) => {
                const net = it.price * it.qty * (1 - (it.discountPct || 0) / 100);
                return (
                  <tr key={`${it.id}-${idx}`}>
                    <td className="border border-slate-200 px-3 py-2 font-semibold">{it.name}</td>
                    <td className="border border-slate-200 px-3 py-2 text-xs">
                      {it.saleUnit || 'علبة'} • <span className="font-mono">{it.batchNumber || '-'}</span>
                    </td>
                    <td className="border border-slate-200 px-3 py-2">{formatMoney(it.price, invSymbol)}</td>
                    <td className="border border-slate-200 px-3 py-2">{it.qty}</td>
                    <td className="border border-slate-200 px-3 py-2">{it.discountPct || 0}%</td>
                    <td className="border border-slate-200 px-3 py-2 font-bold">{formatMoney(net, invSymbol)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-sm">
          <div className="space-y-0.5">
            <div>
              <span>خصم الفاتورة: </span>
              <span className="font-bold text-amber-700">{completedInvoice.discount}%</span>
              {(completedInvoice.promoDiscount || 0) > 0 && (
                <span className="mr-3 font-semibold text-emerald-700">
                  خصم العروض: {formatMoney(completedInvoice.promoDiscount || 0, site.currencySymbol)}
                </span>
              )}
              {(completedInvoice.loyaltyDiscount || 0) > 0 && (
                <span className="mr-3 font-semibold text-indigo-700">
                  خصم النقاط: {formatMoney(completedInvoice.loyaltyDiscount || 0, site.currencySymbol)}
                </span>
              )}
            </div>
            {(completedInvoice.insuranceShare || 0) > 0 && (
              <div className="text-xs font-bold text-[#0B4F9C]">
                حصة شركة التأمين: {formatMoney(completedInvoice.insuranceShare || 0, invSymbol)} · تحمل المريض:{' '}
                {formatMoney(completedInvoice.patientCopay ?? completedInvoice.amount, invSymbol)}
              </div>
            )}
            {(completedInvoice.loyaltyPointsEarned || 0) > 0 && (
              <div className="text-xs font-semibold text-emerald-700">
                نقاط الولاء المكتسبة بهذه الفاتورة: +{completedInvoice.loyaltyPointsEarned} نقطة
              </div>
            )}
            {(completedInvoice.remainingAmount || 0) > 0 && (
              <div className="font-bold text-red-700">
                المتبقي آجل: {formatMoney(completedInvoice.remainingAmount || 0, invSymbol)}
              </div>
            )}
          </div>
          <div className="text-right">
            <div className="text-lg font-bold text-emerald-700">
              المبلغ النهائي: {formatMoney(completedInvoice.amount, invSymbol)}
            </div>
            {(site.autoConvertCurrencies || invCode !== site.currencyCode) && (
              <div className="mt-1 space-y-0.5 text-xs text-slate-600">
                {invCode !== site.currencyCode && (
                  <div>
                    المعادل بالعملة الأساسية: <strong>{formatMoney(invBaseAmt, site.currencySymbol)}</strong>
                  </div>
                )}
                {site.autoConvertCurrencies && displayTargetInfo.code !== invCode && (
                  <div className="text-indigo-700">
                    التحويل التلقائي ({displayTargetInfo.name}):{' '}
                    <strong>{formatMoney(convertedSummaryAmount, displayTargetInfo.symbol)}</strong>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </>
    );

    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded border border-[#DCE4F0] bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between border-b border-slate-200 pb-4">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-6 w-6" />
              <h2 className="text-xl font-bold">تم إصدار الفاتورة وخصم التشغيلات بنظام FEFO</h2>
            </div>
            <span className="font-mono text-sm font-bold text-slate-600">#{completedInvoice.id}</span>
          </div>

          {invoiceBody}

          <div className="no-print mt-6 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-1.5 rounded bg-[#145632] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0f4126]"
            >
              <Maximize2 className="h-4 w-4" />
              <span>عرض بشاشة كاملة قبل الطباعة</span>
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Printer className="h-4 w-4" />
              <span>طباعة مباشرة</span>
            </button>
            <button
              type="button"
              onClick={() => setCompletedInvoice(null)}
              className="rounded bg-[#0B4F9C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#083D7A]"
            >
              فاتورة جديدة
            </button>
          </div>
        </div>

        <PrintPreviewModal
          open={previewOpen}
          title={`فاتورة مبيعات #${completedInvoice.id}`}
          site={site}
          allowReceiptMode
          defaultPaperMode="receipt"
          onClose={() => setPreviewOpen(false)}
        >
          {invoiceBody}
        </PrintPreviewModal>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Shift & POS Control Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-300 bg-white px-4 py-2.5 shadow-xs">
        <div className="flex items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
            <Clock className="h-4 w-4 text-[#0B4F9C]" />
            {currentShift ? (
              <span className="text-emerald-700">
                وردية مفتوحة #{currentShift.id} — المتوقع بالصندوق:{' '}
                <strong>{formatMoney(currentShift.expected_cash, site.currencySymbol)}</strong>
              </span>
            ) : (
              <span className="text-amber-700">لا توجد وردية كاشير مفتوحة حالياً</span>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageShifts &&
            (currentShift ? (
              <button
                type="button"
                onClick={() => {
                  setActualCash(String(currentShift.expected_cash));
                  setShiftModalMode('close');
                }}
                className="rounded bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
              >
                إغلاق ومطابقة الوردية
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShiftModalMode('open')}
                className="rounded bg-[#145632] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#0f4126]"
              >
                فتح وردية كاشير
              </button>
            ))}

          <button
            type="button"
            onClick={() => setHeldModalOpen(true)}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            <PlayCircle className="h-3.5 w-3.5 text-[#0B4F9C]" />
            <span>الفواتير المعلقة ({heldBills.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setShowHistoryModal(true)}
            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
          >
            <RotateCcw className="h-3.5 w-3.5 text-amber-700" />
            <span>المبيعات الأخيرة / المرتجعات</span>
          </button>
        </div>
      </div>

      {/* Main POS Card */}
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Receipt className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">
              نقطة البيع والكاشير ({activeCurrency.name} {activeCurrency.symbol})
            </h1>
            {availableCurrencies.length > 1 && (
              <div className="flex items-center gap-1.5 rounded border border-indigo-200 bg-white px-2 py-1 text-xs">
                <span className="font-bold text-indigo-800">عملة الفاتورة:</span>
                <select
                  value={activeCurrency.code}
                  onChange={(e) => {
                    const next = resolveCurrencyInfo(site, e.target.value);
                    setInvoiceCurrencyCode(next.code);
                    setPaidAmount(String(Number((baseFinalAmount * next.rateToBase).toFixed(2))));
                  }}
                  className="bg-transparent font-bold text-slate-800 focus:outline-none"
                >
                  {availableCurrencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} ({c.symbol})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selectedPrescriptionId && (
              <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900">
                <FileText className="h-3.5 w-3.5" />
                صرف وصفة #{selectedPrescriptionId}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onGoInventories}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ShoppingBag className="h-4 w-4 text-[#0B4F9C]" />
              <span>تصفح المخزون</span>
            </button>
            {bill.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => void handleHoldBill()}
                  className="inline-flex items-center gap-1 rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
                >
                  <PauseCircle className="h-4 w-4" />
                  <span>تعليق الفاتورة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>مسح</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div className="space-y-4 p-4">
          {/* Search & Barcode Bar */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div ref={barcodeBoxRef} className="relative rounded border border-sky-200 bg-[#F3F6FA] p-2.5">
              <form noValidate onSubmit={handleBarcodeScan} className="flex items-center gap-2">
                <Barcode className="h-5 w-5 shrink-0 text-[#0B4F9C]" />
                <div className="relative flex-1">
                  <input
                    ref={barcodeInputRef}
                    type="text"
                    dir="ltr"
                    value={barcodeInput}
                    onFocus={() => {
                      if (barcodeInput.trim()) setBarcodeSuggestionsOpen(true);
                    }}
                    onChange={(e) => {
                      setBarcodeInput(e.target.value);
                      setBarcodeSuggestionsOpen(Boolean(e.target.value.trim()));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' && barcodeMatches.length > 0) {
                        e.preventDefault();
                        setBarcodeSuggestionsOpen(true);
                        setBarcodeHighlightIdx((prev) => (prev + 1) % barcodeMatches.length);
                      } else if (e.key === 'ArrowUp' && barcodeMatches.length > 0) {
                        e.preventDefault();
                        setBarcodeSuggestionsOpen(true);
                        setBarcodeHighlightIdx((prev) =>
                          prev <= 0 ? barcodeMatches.length - 1 : prev - 1,
                        );
                      } else if (e.key === 'Escape') {
                        setBarcodeSuggestionsOpen(false);
                        setBarcodeHighlightIdx(-1);
                      } else if (e.key === 'Tab' && barcodeInput.trim().length >= 4) {
                        e.preventDefault();
                        void executeBarcodeScan(barcodeInput);
                      } else if (
                        e.key === 'Enter' &&
                        barcodeSuggestionsOpen &&
                        barcodeHighlightIdx >= 0 &&
                        barcodeMatches[barcodeHighlightIdx]?.available
                      ) {
                        e.preventDefault();
                        void handleQuickAdd(barcodeMatches[barcodeHighlightIdx].item);
                      }
                    }}
                    placeholder="امسح بالماسح الضوئي (HID / 2D) أو اكتب الباركود + Enter"
                    className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 pr-7 text-left text-sm focus:border-[#0B4F9C] focus:outline-none"
                  />
                  {barcodeInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setBarcodeInput('');
                        setBarcodeSuggestionsOpen(false);
                        setBarcodeHighlightIdx(-1);
                      }}
                      title="مسح"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  className="rounded bg-[#145632] px-3 py-1.5 text-sm font-bold text-white hover:bg-[#0f4126]"
                >
                  إضافة
                </button>
              </form>
              {barcodeSuggestionsOpen &&
                renderSuggestionDropdown(
                  barcodeInput,
                  barcodeMatches,
                  barcodeHighlightIdx,
                  setBarcodeHighlightIdx,
                  handleQuickAdd,
                )}
            </div>

            <div ref={quickSearchBoxRef} className="relative rounded border border-slate-200 bg-slate-50 p-2.5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 shrink-0 text-slate-500" />
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={quickSearch}
                    onFocus={() => {
                      if (quickSearch.trim()) setQuickSearchOpen(true);
                    }}
                    onChange={(e) => {
                      setQuickSearch(e.target.value);
                      setQuickSearchOpen(Boolean(e.target.value.trim()));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' && quickSearchMatches.length > 0) {
                        e.preventDefault();
                        setQuickSearchOpen(true);
                        setQuickHighlightIdx((prev) => (prev + 1) % quickSearchMatches.length);
                      } else if (e.key === 'ArrowUp' && quickSearchMatches.length > 0) {
                        e.preventDefault();
                        setQuickSearchOpen(true);
                        setQuickHighlightIdx((prev) =>
                          prev <= 0 ? quickSearchMatches.length - 1 : prev - 1,
                        );
                      } else if (e.key === 'Escape') {
                        setQuickSearchOpen(false);
                      } else if (e.key === 'Enter' && quickSearchMatches.length > 0) {
                        const targetMatch =
                          quickHighlightIdx >= 0
                            ? quickSearchMatches[quickHighlightIdx]
                            : quickSearchMatches.length === 1
                              ? quickSearchMatches[0]
                              : null;
                        if (targetMatch?.available) {
                          e.preventDefault();
                          void handleQuickAdd(targetMatch.item);
                        }
                      }
                    }}
                    placeholder="اكتب بداية الاسم أو الحرف أو الرقم لعرض كل الأدوية المطابقة..."
                    className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 pl-7 text-sm focus:border-[#0B4F9C] focus:outline-none"
                  />
                  {quickSearch && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickSearch('');
                        setQuickSearchOpen(false);
                        setQuickHighlightIdx(-1);
                      }}
                      title="مسح البحث"
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
              {quickSearchOpen &&
                renderSuggestionDropdown(
                  quickSearch,
                  quickSearchMatches,
                  quickHighlightIdx,
                  setQuickHighlightIdx,
                  handleQuickAdd,
                )}
            </div>
          </div>

          {pageMsg && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {pageMsg}
            </div>
          )}

          {/* Live Clinical Decision Support & Controlled Medicine Alerts */}
          {clinicalCheck &&
            (clinicalCheck.interactionWarnings.length > 0 ||
              clinicalCheck.alerts.length > 0 ||
              clinicalCheck.controlledMedicines.length > 0) && (
              <div className="space-y-1.5 rounded border border-amber-300 bg-amber-50/80 p-3 text-xs">
                {clinicalCheck.interactionWarnings.map((w, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-red-900">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div>
                      <strong>تداخل دوائي ({w.severity}):</strong> {w.pair} — {w.effect}
                    </div>
                  </div>
                ))}
                {clinicalCheck.alerts.map((al, idx) => (
                  <div key={idx} className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-2.5 py-1.5 font-bold text-red-900">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <span>{al.message}</span>
                  </div>
                ))}
                {clinicalCheck.controlledMedicines.length > 0 && (
                  <div className="rounded border border-red-300 bg-white px-2.5 py-1.5 font-bold text-red-800">
                    تنبيه رقابي: تحتوي السلة على أدوية مقيدة ({clinicalCheck.controlledMedicines.map((c) => c.name).join('، ')}) — سيلزم إدخال هوية المريض ورقم الوصفة عند الإتمام.
                  </div>
                )}
              </div>
            )}

          {bill.length === 0 ? (
            <div className="py-12 text-center">
              <p className="mb-3 text-slate-500">سلة الفاتورة فارغة. امسح باركود أو ابحث بالاسم أعلاه.</p>
              <button
                type="button"
                onClick={onGoInventories}
                className="rounded bg-[#0B4F9C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#083D7A]"
              >
                تصفح المخزون الدوائي
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded border border-slate-200">
                <table className="w-full border-collapse text-right text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="border-b border-slate-200 px-3 py-2.5">#</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">الدواء والتشغيلة</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">وحدة البيع</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">سعر الوحدة</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">الكمية</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">خصم الصنف %</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">الإجمالي</th>
                      <th className="border-b border-slate-200 px-3 py-2.5">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {bill.map((item, idx) => {
                      const lineNet = item.price * item.qty * (1 - (item.discountPct || 0) / 100);
                      const unitOptions = [item.packUnit || 'علبة'];
                      if ((item.stripsPerPack || 1) > 1 && item.stripUnit) unitOptions.push(item.stripUnit);
                      if ((item.piecesPerPack || 1) > 1 && item.pieceUnit) unitOptions.push(item.pieceUnit);

                      return (
                        <tr key={`${item.id}-${item.saleUnit}-${idx}`} className="hover:bg-sky-50/40">
                          <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2.5">
                            <div className="font-bold text-slate-800">
                              {item.name} <span className="text-xs font-normal text-slate-500">({item.unit})</span>
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {item.scientificName ? `${item.scientificName} • ` : ''}تشغيلة: {item.batchNumber || '-'}
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <select
                              value={item.saleUnit}
                              onChange={(e) => void handleUpdateLine(item, { saleUnit: e.target.value })}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold"
                            >
                              {unitOptions.map((uo) => (
                                <option key={uo} value={uo}>
                                  {uo}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2.5 font-semibold">
                            {formatMoney(item.price * convRate, activeCurrency.symbol)}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white p-0.5">
                              <button
                                type="button"
                                onClick={() => void handleUpdateLine(item, { qty: Math.max(1, item.qty - 1) })}
                                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <input
                                type="number"
                                min={1}
                                value={item.qty}
                                onChange={(e) =>
                                  void handleUpdateLine(item, { qty: Math.max(1, Number(e.target.value) || 1) })
                                }
                                className="w-12 text-center text-sm font-bold focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void handleUpdateLine(item, { qty: item.qty + 1 })}
                                className="rounded p-1 text-slate-600 hover:bg-slate-100"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={item.discountPct || 0}
                              onChange={(e) =>
                                void handleUpdateLine(item, {
                                  discountPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                                })
                              }
                              className="w-16 rounded border border-slate-300 px-2 py-1 text-center text-xs"
                            />
                          </td>
                          <td className="px-3 py-2.5 font-bold text-emerald-700">
                            {formatMoney(lineNet * convRate, activeCurrency.symbol)}
                          </td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => void handleRemoveItem(item)}
                              className="rounded bg-red-600 p-1.5 text-white hover:bg-red-700"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded border border-slate-200 bg-[#F3F6FA] p-4">
                <div className="space-y-1">
                  <div className="text-sm text-slate-600">
                    إجمالي الوحدات:{' '}
                    <span className="font-bold text-slate-800">{bill.reduce((s, i) => s + i.qty, 0)}</span>
                  </div>
                  <div className="text-xl font-bold text-[#145632]">
                    الصافي للدفع: {formatMoney(subtotal, activeCurrency.symbol)}
                  </div>
                  {activeCurrency.code !== site.currencyCode && (
                    <div className="text-xs text-indigo-800">
                      المعادل بالعملة الأساسية: <strong>{formatMoney(baseSubtotal, site.currencySymbol)}</strong> (سعر الصرف:{' '}
                      {convRate})
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPaidAmount(String(finalAmount));
                    setCheckoutOpen(true);
                  }}
                  className="rounded bg-emerald-600 px-6 py-2.5 text-sm font-bold text-white shadow hover:bg-emerald-700"
                >
                  إتمام الدفع وإصدار الفاتورة
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Checkout Modal */}
      {checkoutOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">إتمام الدفع وتحصيل الفاتورة</h3>
              <button
                type="button"
                onClick={() => setCheckoutOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form noValidate onSubmit={handleCheckout} className="space-y-3 p-4">

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">اختيار عميل مسجل (اختياري)</label>
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => handleSelectCustomer(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-sm"
                  >
                    <option value="">-- عميل مباشر --</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.credit_limit > 0 ? `(حد ${c.credit_limit})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">ربط بوصفة طبية (اختياري)</label>
                  <select
                    value={selectedPrescriptionId}
                    onChange={(e) => setSelectedPrescriptionId(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-2 text-sm"
                  >
                    <option value="">-- بدون وصفة --</option>
                    {prescriptions
                      .filter((p) => p.status === 'pending' || String(p.id) === selectedPrescriptionId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          وصفة #{p.id} - {p.customer_name} ({p.doctor_name})
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    اسم المشتري <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">رقم الهاتف</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={contact}
                    onChange={(e) => setContact(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">طريقة الدفع</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as typeof paymentMethod)}
                    className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"
                  >
                    <option value="cash">نقدي (كاش)</option>
                    <option value="card">بطاقة / شبكة مدى</option>
                    <option value="credit">آجل بالكامل (على حساب العميل)</option>
                    <option value="partial">دفع جزئي (نقدي + آجل)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">خصم الفاتورة (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              </div>

              {availableCurrencies.length > 1 && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">عملة إصدار الفاتورة والتحصيل</label>
                  <select
                    value={activeCurrency.code}
                    onChange={(e) => {
                      const next = resolveCurrencyInfo(site, e.target.value);
                      setInvoiceCurrencyCode(next.code);
                      setPaidAmount(String(Number((baseFinalAmount * next.rateToBase).toFixed(2))));
                    }}
                    className="w-full rounded border border-indigo-300 bg-indigo-50/40 px-3 py-2 text-sm font-bold text-slate-800"
                  >
                    {availableCurrencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.symbol} / {c.code}) {c.rateToBase !== 1 ? `— سعر الصرف: ${c.rateToBase}` : '— أساسية'}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {paymentMethod === 'partial' && (
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    المبلغ المدفوع نقداً الآن ({activeCurrency.symbol})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={finalAmount}
                    step="0.01"
                    value={paidAmount}
                    onChange={(e) => setPaidAmount(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
              )}

              {/* Controlled Substances Mandatory Verification */}
              {(clinicalCheck?.controlledMedicines?.length || 0) > 0 && (
                <div className="space-y-2 rounded border border-red-300 bg-red-50 p-3 text-xs">
                  <div className="font-bold text-red-900">
                    توثيق صرف أدوية مقيدة ({clinicalCheck?.controlledMedicines.map((c) => c.name).join('، ')})
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={ctrlNationalId}
                      onChange={(e) => setCtrlNationalId(e.target.value)}
                      placeholder="رقم الهوية الوطنية *"
                      className="rounded border border-red-300 bg-white px-2.5 py-1.5 text-left"
                    />
                    <input
                      type="text"
                      required={!selectedPrescriptionId}
                      value={ctrlRxNumber}
                      onChange={(e) => setCtrlRxNumber(e.target.value)}
                      placeholder="رقم الوصفة المعتمدة *"
                      className="rounded border border-red-300 bg-white px-2.5 py-1.5"
                    />
                    <input
                      type="text"
                      value={ctrlDoctorName}
                      onChange={(e) => setCtrlDoctorName(e.target.value)}
                      placeholder="اسم الطبيب المعالج"
                      className="rounded border border-red-300 bg-white px-2.5 py-1.5"
                    />
                  </div>
                </div>
              )}

              {/* Insurance Coverage & Loyalty Redemption */}
              <div className="space-y-2 rounded border border-[#DCE4F0] bg-[#EDF4FC]/60 p-3 text-xs">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block font-bold text-slate-700">تغطية التأمين الصحي (اختياري)</label>
                    <select
                      value={selectedInsuranceId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedInsuranceId(val);
                        const comp = insuranceCompanies.find((c) => String(c.id) === val);
                        if (comp) setInsuranceCoveragePct(String(comp.default_coverage_pct));
                      }}
                      className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="">-- بدون تأمين --</option>
                      {insuranceCompanies.map((ic) => (
                        <option key={ic.id} value={ic.id}>
                          {ic.name} (تغطية {ic.default_coverage_pct}%)
                        </option>
                      ))}
                    </select>
                  </div>
                  {selectedInsuranceId && (
                    <div>
                      <label className="mb-1 block font-bold text-slate-700">نسبة التغطية (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={insuranceCoveragePct}
                        onChange={(e) => setInsuranceCoveragePct(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                      />
                    </div>
                  )}
                </div>

                {selectedInsuranceId && (
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={insurancePolicyNo}
                      onChange={(e) => setInsurancePolicyNo(e.target.value)}
                      placeholder="رقم البوليصة / البطاقة التأمينية"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                    <input
                      type="text"
                      value={insuranceApprovalCode}
                      onChange={(e) => setInsuranceApprovalCode(e.target.value)}
                      placeholder="رمز الموافقة المسبقة"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    />
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <label className="flex items-center gap-1.5 font-semibold text-slate-700">
                    <input
                      type="checkbox"
                      checked={applyPromotions}
                      onChange={(e) => setApplyPromotions(e.target.checked)}
                    />
                    <span>تطبيق العروض الترويجية النشطة تلقائياً</span>
                  </label>
                  {selectedCustomerId && availCustomerPoints > 0 && (
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-[#0B4F9C]">استبدال نقاط ({availCustomerPoints} متاح):</span>
                      <input
                        type="number"
                        min={0}
                        max={availCustomerPoints}
                        value={redeemPoints}
                        onChange={(e) => setRedeemPoints(e.target.value)}
                        className="w-20 rounded border border-slate-300 bg-white px-2 py-1 text-center font-bold"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1 rounded bg-[#F3F6FA] p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600">صافي الأصناف:</span>
                  <span className="font-semibold">{formatMoney(subtotal, activeCurrency.symbol)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">خصم الفاتورة ({discountPct}%):</span>
                  <span className="font-semibold text-amber-700">
                    - {formatMoney((subtotal * discountPct) / 100, activeCurrency.symbol)}
                  </span>
                </div>
                {loyaltyDiscountBase > 0 && (
                  <div className="flex justify-between text-xs text-indigo-700">
                    <span>خصم استبدال النقاط ({redeemedPtsNum} نقطة):</span>
                    <strong>- {formatMoney(loyaltyDiscountBase * convRate, activeCurrency.symbol)}</strong>
                  </div>
                )}
                {baseInsuranceShare > 0 && (
                  <div className="flex justify-between text-xs text-[#0B4F9C]">
                    <span>حصة شركة التأمين ({insCovPctNum}%):</span>
                    <strong>- {formatMoney(displayInsuranceShare, activeCurrency.symbol)}</strong>
                  </div>
                )}
                <div className="flex justify-between border-t border-slate-300 pt-1.5 text-base font-bold text-emerald-700">
                  <span>المستحق على المريض ({activeCurrency.code}):</span>
                  <span>{formatMoney(finalAmount, activeCurrency.symbol)}</span>
                </div>
                {activeCurrency.code !== site.currencyCode && (
                  <div className="flex justify-between text-xs text-indigo-700">
                    <span>المكافئ بالعملة الأساسية للمحاسبة:</span>
                    <strong>{formatMoney(baseFinalAmount, site.currencySymbol)}</strong>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setCheckoutOpen(false)}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-emerald-600 px-5 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                >
                  {submitting ? 'جاري التنفيذ...' : 'تأكيد وحفظ الفاتورة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Held Bills Modal */}
      {heldModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">الفواتير المعلقة</h3>
              <button type="button" onClick={() => setHeldModalOpen(false)}>
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="max-h-96 space-y-2 overflow-y-auto p-4">
              {heldBills.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">لا توجد فواتير معلقة حالياً.</p>
              ) : (
                heldBills.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded border border-slate-200 p-3 text-sm">
                    <div>
                      <div className="font-bold text-slate-800">{h.label}</div>
                      <div className="text-xs text-slate-500">
                        {h.created_at} • {h.user_name || ''}
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleResumeHeld(h.id)}
                        className="rounded bg-[#0B4F9C] px-3 py-1 text-xs font-bold text-white"
                      >
                        استرجاع للسلة
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await api.deleteHeldBill(h.id);
                            await loadPosMeta();
                          } catch (err) {
                            showErrorPopup(err, 'حذف فاتورة معلقة');
                          }
                        }}
                        className="rounded bg-red-600 px-2.5 py-1 text-xs font-bold text-white"
                      >
                        حذف
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Shift Open / Close Modal */}
      {shiftModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">
                {shiftModalMode === 'open' ? 'فتح وردية كاشير جديدة' : 'إغلاق ومطابقة الوردية'}
              </h3>
              <button type="button" onClick={() => setShiftModalMode(null)}>
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            {shiftModalMode === 'open' ? (
              <form noValidate onSubmit={handleOpenShift} className="space-y-3 p-4">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    الرصيد النقدي الافتتاحي بالدرج ({site.currencySymbol})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={openingCash}
                    onChange={(e) => setOpeningCash(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShiftModalMode(null)}
                    className="rounded border px-4 py-1.5 text-sm"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={actionBusy}
                    className="rounded bg-[#145632] px-4 py-1.5 text-sm font-bold text-white"
                  >
                    فتح الوردية
                  </button>
                </div>
              </form>
            ) : (
              currentShift && (
                <form noValidate onSubmit={handleCloseShift} className="space-y-3 p-4 text-sm">
                  <div className="space-y-1 rounded bg-[#F3F6FA] p-3 text-xs">
                    <div className="flex justify-between">
                      <span>الرصيد الافتتاحي:</span>
                      <strong>{formatMoney(currentShift.opening_cash, site.currencySymbol)}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span>المبيعات النقدية:</span>
                      <strong className="text-emerald-700">
                        + {formatMoney(currentShift.cash_sales, site.currencySymbol)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>مبيعات البطاقة / الآجل:</span>
                      <strong>
                        {formatMoney(currentShift.card_sales, site.currencySymbol)} /{' '}
                        {formatMoney(currentShift.credit_sales, site.currencySymbol)}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span>المرتجعات النقدية:</span>
                      <strong className="text-red-600">
                        - {formatMoney(currentShift.cash_returns, site.currencySymbol)}
                      </strong>
                    </div>
                    <div className="flex justify-between border-t pt-1 font-bold text-slate-900">
                      <span>النقدية المتوقعة بالدرج:</span>
                      <span>{formatMoney(currentShift.expected_cash, site.currencySymbol)}</span>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">النقدية الفعلية المعدودة</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={actualCash}
                      onChange={(e) => setActualCash(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">ملاحظات الإغلاق</label>
                    <input
                      type="text"
                      value={shiftNotes}
                      onChange={(e) => setShiftNotes(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShiftModalMode(null)}
                      className="rounded border px-4 py-1.5 text-sm"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={actionBusy}
                      className="rounded bg-amber-600 px-4 py-1.5 text-sm font-bold text-white"
                    >
                      اعتماد وإغلاق الوردية
                    </button>
                  </div>
                </form>
              )
            )}
          </div>
        </div>
      )}

      {/* Recent Sales & Cancel / Return Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">سجل الفواتير السريع — الإلغاء والمرتجعات</h3>
              <button type="button" onClick={() => setShowHistoryModal(false)}>
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <div className="p-4">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="border-b px-3 py-2">#</th>
                    <th className="border-b px-3 py-2">العميل</th>
                    <th className="border-b px-3 py-2">المبلغ</th>
                    <th className="border-b px-3 py-2">الدفع</th>
                    <th className="border-b px-3 py-2">الحالة</th>
                    <th className="border-b px-3 py-2">التاريخ</th>
                    <th className="border-b px-3 py-2">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {recentSales.slice(0, 25).map((inv) => (
                    <tr key={inv.id}>
                      <td className="px-3 py-2 font-mono">#{inv.id}</td>
                      <td className="px-3 py-2 font-bold">{inv.name}</td>
                      <td className="px-3 py-2 font-bold text-emerald-700">
                        {formatMoney(inv.amount, inv.currencySymbol || site.currencySymbol)}
                      </td>
                      <td className="px-3 py-2">{inv.paymentMethod || 'cash'}</td>
                      <td className="px-3 py-2">
                        {inv.status === 'cancelled' ? (
                          <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-700">ملغاة</span>
                        ) : (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">مكتملة</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono">{inv.date}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setCompletedInvoice(inv);
                              setShowHistoryModal(false);
                            }}
                            className="rounded border px-2 py-1 font-semibold hover:bg-slate-100"
                          >
                            عرض/طباعة
                          </button>
                          {inv.status !== 'cancelled' && canReturn && inv.itemsDetail.length > 0 && (
                            <button
                              type="button"
                              onClick={() => void openReturnModal(inv)}
                              className="inline-flex items-center gap-0.5 rounded bg-amber-600 px-2 py-1 font-semibold text-white"
                            >
                              <RotateCcw className="h-3 w-3" />
                              مرتجع
                            </button>
                          )}
                          {inv.status !== 'cancelled' && canCancelInvoice && (
                            <button
                              type="button"
                              onClick={() => setConfirmCancelInvoice(inv)}
                              className="inline-flex items-center gap-0.5 rounded bg-red-600 px-2 py-1 font-semibold text-white"
                            >
                              <Ban className="h-3 w-3" />
                              إلغاء
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Sales Return Modal */}
      {returnTargetInvoice && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">
                إرجاع أصناف من الفاتورة #{returnTargetInvoice.id}
              </h3>
              <button type="button" onClick={() => setReturnTargetInvoice(null)}>
                <X className="h-5 w-5 text-slate-500" />
              </button>
            </div>
            <form noValidate onSubmit={handleSubmitReturn} className="space-y-3 p-4 text-sm">
              <div className="space-y-2">
                {returnTargetInvoice.itemsDetail.map((it) => (
                  <div key={it.id} className="flex items-center justify-between rounded border p-2 text-xs">
                    <div>
                      <div className="font-bold">{it.name}</div>
                      <div className="text-slate-500">
                        المباع: {it.qty} ({it.saleUnit || 'علبة'}) × {formatMoney(it.price, site.currencySymbol)}
                      </div>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={it.qty}
                      value={returnQtys[it.id] || 0}
                      onChange={(e) =>
                        setReturnQtys((prev) => ({
                          ...prev,
                          [it.id]: Math.min(it.qty, Math.max(0, Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-20 rounded border px-2 py-1 text-center font-bold"
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-bold">طريقة رد المبلغ</label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value as 'cash' | 'credit_note')}
                    className="w-full rounded border bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="cash">رد نقدي من الصندوق</option>
                    <option value="credit_note">خصم من ذمة العميل (آجل)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold">سبب الإرجاع</label>
                  <input
                    type="text"
                    value={returnReason}
                    onChange={(e) => setReturnReason(e.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-xs"
                  />
                </div>
              </div>
              {salesReturns.length > 0 && (
                <div className="text-[11px] text-slate-500">إجمالي المرتجعات المسجلة سابقاً: {salesReturns.length}</div>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReturnTargetInvoice(null)}
                  className="rounded border px-4 py-1.5 text-xs"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={actionBusy}
                  className="rounded bg-amber-600 px-4 py-1.5 text-xs font-bold text-white"
                >
                  تأكيد المرتجع
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={confirmClearOpen}
        title="تأكيد مسح السلة"
        message="هل أنت متأكد من مسح جميع الأصناف من الفاتورة الحالية؟"
        confirmLabel="نعم، مسح السلة"
        busy={clearing}
        onConfirm={handleConfirmClear}
        onCancel={() => setConfirmClearOpen(false)}
      />

      <ConfirmModal
        open={Boolean(confirmCancelInvoice)}
        title="تأكيد إلغاء الفاتورة"
        message={`هل تريد إلغاء الفاتورة #${confirmCancelInvoice?.id ?? ''} بالكامل وإرجاع الأصناف للتشغيلات وعكس قيدها المحاسبي؟`}
        confirmLabel="نعم، إلغاء الفاتورة"
        busy={actionBusy}
        onConfirm={handleCancelInvoice}
        onCancel={() => setConfirmCancelInvoice(null)}
      />
    </div>
  );
};
