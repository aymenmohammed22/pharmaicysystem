import React, { useEffect, useMemo, useState } from 'react';
import { Barcode, Layers, Settings2, Printer, Download } from 'lucide-react';
import { api } from '../api';
import type { InventoryItem, MedicineBatch, SiteSettings } from '../types';
import {
  convertFromBase,
  formatMoney,
  getAvailableCurrencies,
  getExpiryStatus,
  resolveCurrencyInfo,
} from '../types';
import { PrintPreviewModal } from './PrintPreviewModal';
import { BarcodeSvg } from './BarcodeSvg';
import type { BarcodeSymbology } from '../../shared/gs1Barcode';
import {
  buildTsplLabelPayload,
  buildZplLabelPayload,
  dispatchToLocalPrintBridge,
  loadLocalTerminalConfig,
} from '../utils/localPrintService';

interface BarcodeLabelsPrintModalProps {
  open: boolean;
  site: SiteSettings;
  inventories: InventoryItem[];
  filteredInventories: InventoryItem[];
  singleMedicine?: InventoryItem | null;
  onClose: () => void;
}

type ScopeMode = 'available' | 'filteredAvailable' | 'single';
type CopiesMode = 'one' | 'custom' | 'stock';
type LayoutMode = 'grid3' | 'grid4' | 'thermal';
type LabelPresetKey = '50x25' | '40x30' | '38x25' | '58x40' | 'custom';

const LABEL_PRESETS: Record<Exclude<LabelPresetKey, 'custom'>, { w: number; h: number; label: string }> = {
  '50x25': { w: 50, h: 25, label: '50×25 mm (قياسي صيدليات)' },
  '40x30': { w: 40, h: 30, label: '40×30 mm (رفوف وعبوات)' },
  '38x25': { w: 38, h: 25, label: '38×25 mm (ملصق صغير)' },
  '58x40': { w: 58, h: 40, label: '58×40 mm (ملصق عريض)' },
};

export const BarcodeLabelsPrintModal: React.FC<BarcodeLabelsPrintModalProps> = ({
  open,
  site,
  inventories,
  filteredInventories,
  singleMedicine,
  onClose,
}) => {
  const [scope, setScope] = useState<ScopeMode>('available');
  const [copiesMode, setCopiesMode] = useState<CopiesMode>('one');
  const [customCopies, setCustomCopies] = useState<number>(2);
  const [layout, setLayout] = useState<LayoutMode>('grid3');
  const [includeExpired, setIncludeExpired] = useState(false);

  // Label physical dimensions, gap, DPI & symbology
  const [sizePreset, setSizePreset] = useState<LabelPresetKey>('50x25');
  const [labelWidthMm, setLabelWidthMm] = useState<number>(50);
  const [labelHeightMm, setLabelHeightMm] = useState<number>(25);
  const [labelGapMm, setLabelGapMm] = useState<number>(3);
  const [dpi, setDpi] = useState<203 | 300>(203);
  const [symbologyOverride, setSymbologyOverride] = useState<'AUTO' | BarcodeSymbology>('AUTO');

  // Batch selection for singleMedicine (FEFO / specific batch)
  const [itemBatches, setItemBatches] = useState<MedicineBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [bridgeFeedback, setBridgeFeedback] = useState<string>('');
  const [testSingleMode, setTestSingleMode] = useState(false);

  // Per-medicine overrides (checkbox + custom copies)
  const [excludedIds, setExcludedIds] = useState<Record<number, boolean>>({});
  const [perItemCopies, setPerItemCopies] = useState<Record<number, number>>({});

  // 9 toggleable label content fields
  const [showPharmacyName, setShowPharmacyName] = useState(true);
  const [showBranchName, setShowBranchName] = useState(false);
  const [showTradeName, setShowTradeName] = useState(true);
  const [showScientificName, setShowScientificName] = useState(false);
  const [showUnitForm, setShowUnitForm] = useState(true);
  const [showExpiryDate, setShowExpiryDate] = useState(true);
  const [showBatchNumber, setShowBatchNumber] = useState(true);
  const [showPrice, setShowPrice] = useState(true);
  const [showStorageLocation, setShowStorageLocation] = useState(false);

  const availableCurrencies = useMemo(() => getAvailableCurrencies(site), [site]);
  const [currencyCode, setCurrencyCode] = useState<string>(
    site.autoConvertCurrencies ? site.defaultDisplayCurrency || site.currencyCode : site.currencyCode,
  );

  useEffect(() => {
    if (!open) return;
    setScope(singleMedicine ? 'single' : 'available');
    setCopiesMode(singleMedicine ? 'custom' : 'one');
    setCustomCopies(singleMedicine ? Math.min(Math.max(1, singleMedicine.quantity || 1), 6) : 2);
    setExcludedIds({});
    setPerItemCopies({});
    setSelectedBatchId('');
    setBridgeFeedback('');
    setTestSingleMode(false);
    setCurrencyCode(
      site.autoConvertCurrencies ? site.defaultDisplayCurrency || site.currencyCode : site.currencyCode,
    );
    if (singleMedicine) {
      void api
        .getBatches({ medicineId: singleMedicine.id })
        .then((res) => {
          const active = (res.batches || []).filter((b) => b.status === 'active' && b.qty_remaining > 0);
          setItemBatches(active);
        })
        .catch(() => setItemBatches([]));
    } else {
      setItemBatches([]);
    }
  }, [open, singleMedicine, site]);

  const activeCurrency = useMemo(
    () => resolveCurrencyInfo(site, currencyCode),
    [site, currencyCode],
  );

  const selectedBatch = useMemo(
    () => itemBatches.find((b) => String(b.id) === selectedBatchId) || null,
    [itemBatches, selectedBatchId],
  );

  const handleSelectPreset = (key: LabelPresetKey) => {
    setSizePreset(key);
    if (key !== 'custom') {
      setLabelWidthMm(LABEL_PRESETS[key].w);
      setLabelHeightMm(LABEL_PRESETS[key].h);
    }
  };

  const candidateItems = useMemo(() => {
    if (scope === 'single' && singleMedicine) {
      if (selectedBatch) {
        return [
          {
            ...singleMedicine,
            batchNumber: selectedBatch.batch_number,
            expiryDate: selectedBatch.expiry_date,
            quantity: selectedBatch.qty_remaining,
          },
        ];
      }
      return [singleMedicine];
    }
    const source = scope === 'filteredAvailable' ? filteredInventories : inventories;
    return source.filter((item) => {
      if (item.status === 'suspended' || item.quantity <= 0) return false;
      if (!includeExpired && getExpiryStatus(item.expiryDate) === 'expired') return false;
      return true;
    });
  }, [scope, singleMedicine, selectedBatch, filteredInventories, inventories, includeExpired]);

  const getCopiesForItem = (item: InventoryItem): number => {
    if (excludedIds[item.id]) return 0;
    if (perItemCopies[item.id] !== undefined) {
      return Math.min(100, Math.max(0, perItemCopies[item.id]));
    }
    if (copiesMode === 'one') return 1;
    if (copiesMode === 'stock') return Math.min(50, Math.max(1, Math.floor(item.quantity)));
    return Math.min(100, Math.max(1, customCopies));
  };

  const expandedLabels = useMemo(() => {
    if (testSingleMode && candidateItems[0]) {
      return [{ key: `${candidateItems[0].id}-test-1`, item: candidateItems[0], copyNum: 1, totalCopies: 1 }];
    }
    const out: Array<{ key: string; item: InventoryItem; copyNum: number; totalCopies: number }> = [];
    for (const item of candidateItems) {
      const count = getCopiesForItem(item);
      for (let i = 1; i <= count; i += 1) {
        out.push({
          key: `${item.id}-copy-${i}`,
          item,
          copyNum: i,
          totalCopies: count,
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidateItems, copiesMode, customCopies, excludedIds, perItemCopies, testSingleMode]);

  const handleSendDirectThermal = async (protocol: 'ZPL' | 'TSPL') => {
    const firstItem = expandedLabels[0]?.item;
    if (!firstItem) return;
    const copies = testSingleMode ? 1 : expandedLabels.length;
    const payload =
      protocol === 'ZPL'
        ? buildZplLabelPayload({ item: firstItem, site, widthMm: labelWidthMm, heightMm: labelHeightMm, dpi, copies })
        : buildTsplLabelPayload({
            item: firstItem,
            site,
            widthMm: labelWidthMm,
            heightMm: labelHeightMm,
            gapMm: labelGapMm,
            copies,
          });
    const terminal = loadLocalTerminalConfig();
    const res = await dispatchToLocalPrintBridge({
      bridgeUrl: terminal.bridgeUrl,
      protocol,
      payload,
      copies,
    });
    void api
      .createPrintJob({
        jobType: 'barcode_label',
        title: `ملصقات باركود ${protocol} (${firstItem.name})`,
        protocol,
        transport: res.ok ? 'local_bridge' : 'bridge_unreachable',
        status: res.ok ? 'completed' : 'failed',
        copies,
        payloadPreview: payload,
        errorMessage: res.error || '',
      })
      .catch(() => {});

    if (res.ok) {
      setBridgeFeedback(`تم إرسال أوامر ${protocol} (${copies} ملصق) إلى الطابعة الحرارية عبر Print Bridge بنجاح.`);
    } else {
      setBridgeFeedback(`${res.error} — يمكنك استخدام زر "طباعة الآن / حفظ PDF" للطباعة عبر المتصفح أو تنزيل ملف ${protocol}.`);
    }
  };

  const handleDownloadThermalFile = (protocol: 'ZPL' | 'TSPL') => {
    const firstItem = expandedLabels[0]?.item;
    if (!firstItem) return;
    const content =
      protocol === 'ZPL'
        ? buildZplLabelPayload({ item: firstItem, site, widthMm: labelWidthMm, heightMm: labelHeightMm, dpi, copies: 1 })
        : buildTsplLabelPayload({ item: firstItem, site, widthMm: labelWidthMm, heightMm: labelHeightMm, gapMm: labelGapMm, copies: 1 });
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `label_${firstItem.barcode || firstItem.id}.${protocol.toLowerCase()}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!open) return null;

  const gridClass =
    layout === 'grid4'
      ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 print:grid-cols-4'
      : layout === 'thermal'
        ? 'mx-auto flex flex-col items-center'
        : 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 print:grid-cols-3';

  return (
    <PrintPreviewModal
      open={open}
      title={
        singleMedicine && scope === 'single'
          ? `طباعة ملصق باركود — ${singleMedicine.name}`
          : 'طباعة ملصقات الباركود للأدوية المتوفرة'
      }
      site={site}
      allowLabelMode
      defaultPaperMode={layout === 'thermal' ? 'label' : 'a4'}
      hideHeaderForLabel
      jobType="barcode_label"
      onClose={onClose}
    >
      {/* Print Configuration Toolbar (hidden when printing) */}
      <div className="no-print mb-6 space-y-4 rounded border border-sky-200 bg-[#F3F6FA] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-200 pb-2.5">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Settings2 className="h-4 w-4 text-[#0B4F9C]" />
            <span>مصمم وإعدادات ملصقات الباركود قبل الطباعة</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded border border-slate-200 bg-white px-2.5 py-1 font-bold text-slate-700">
              الأصناف المحددة: {candidateItems.filter((i) => getCopiesForItem(i) > 0).length}
            </span>
            <span className="rounded bg-emerald-100 px-2.5 py-1 font-bold text-emerald-800">
              إجمالي الملصقات: {expandedLabels.length} ملصق
            </span>
            <button
              type="button"
              onClick={() => setTestSingleMode((v) => !v)}
              className={`inline-flex items-center gap-1 rounded px-2.5 py-1 font-bold ${
                testSingleMode ? 'bg-amber-600 text-white' : 'border border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <Printer className="h-3.5 w-3.5" />
              <span>{testSingleMode ? 'إلغاء وضع الملصق التجريبي' : 'معاينة ملصق تجريبي (1 ملصق)'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">نطاق الأدوية</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeMode)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
            >
              <option value="available">جميع الأدوية المتوفرة بالمخزون</option>
              <option value="filteredAvailable">الأدوية المتوفرة حسب البحث/التصنيف الحالي</option>
              {singleMedicine && <option value="single">الدواء المحدد فقط ({singleMedicine.name})</option>}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">عدد الملصقات لكل دواء</label>
            <div className="flex items-center gap-1.5">
              <select
                value={copiesMode}
                onChange={(e) => {
                  setPerItemCopies({});
                  setCopiesMode(e.target.value as CopiesMode);
                }}
                className="flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold"
              >
                <option value="one">ملصق واحد لكل دواء</option>
                <option value="custom">عدد موحد مخصص</option>
                <option value="stock">حسب الكمية المتوفرة (حتى 50)</option>
              </select>
              {copiesMode === 'custom' && (
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customCopies}
                  onChange={(e) => {
                    setPerItemCopies({});
                    setCustomCopies(Math.min(100, Math.max(1, Number(e.target.value) || 1)));
                  }}
                  className="w-16 rounded border border-slate-300 bg-white px-2 py-1.5 text-center text-xs font-bold"
                />
              )}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">تخطيط الورقة / الطابعة</label>
            <select
              value={layout}
              onChange={(e) => setLayout(e.target.value as LayoutMode)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
            >
              <option value="grid3">ورقة A4 — 3 أعمدة (ملصقات قياسية)</option>
              <option value="grid4">ورقة A4 — 4 أعمدة (ملصقات مكثفة)</option>
              <option value="thermal">رول حراري — عمود واحد (ملصق/سطر)</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">عملة السعر على الملصق</label>
            <select
              value={activeCurrency.code}
              onChange={(e) => setCurrencyCode(e.target.value)}
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold"
            >
              {availableCurrencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Physical Label Dimensions, Gaps, DPI, Symbology & Batch FEFO */}
        <div className="grid grid-cols-1 gap-3 border-t border-sky-200 pt-3 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-700">مقاس الملصق (mm)</label>
            <select
              value={sizePreset}
              onChange={(e) => handleSelectPreset(e.target.value as LabelPresetKey)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold"
            >
              {Object.entries(LABEL_PRESETS).map(([k, p]) => (
                <option key={k} value={k}>
                  {p.label}
                </option>
              ))}
              <option value="custom">مقاس مخصص (mm)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-700">العرض (mm)</label>
              <input
                type="number"
                min={20}
                max={120}
                value={labelWidthMm}
                onChange={(e) => {
                  setSizePreset('custom');
                  setLabelWidthMm(Math.max(20, Math.min(120, Number(e.target.value) || 50)));
                }}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-center font-mono text-xs font-bold"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-700">الارتفاع (mm)</label>
              <input
                type="number"
                min={15}
                max={100}
                value={labelHeightMm}
                onChange={(e) => {
                  setSizePreset('custom');
                  setLabelHeightMm(Math.max(15, Math.min(100, Number(e.target.value) || 25)));
                }}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-center font-mono text-xs font-bold"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-700">المسافة (mm)</label>
              <input
                type="number"
                min={0}
                max={15}
                value={labelGapMm}
                onChange={(e) => setLabelGapMm(Math.max(0, Math.min(15, Number(e.target.value) || 2)))}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-center font-mono text-xs font-bold"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-bold text-slate-700">الدقة (DPI)</label>
              <select
                value={dpi}
                onChange={(e) => setDpi(Number(e.target.value) === 300 ? 300 : 203)}
                className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 font-mono text-xs font-bold"
              >
                <option value={203}>203</option>
                <option value={300}>300</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-slate-700">نوع رمز الباركود</label>
            <select
              value={symbologyOverride}
              onChange={(e) => setSymbologyOverride(e.target.value as 'AUTO' | BarcodeSymbology)}
              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold"
            >
              <option value="AUTO">تلقائي ذكي</option>
              <option value="CODE128">Code-128</option>
              <option value="EAN13">EAN-13</option>
              <option value="EAN8">EAN-8</option>
              <option value="ITF14">ITF-14</option>
              <option value="QR">QR 2D</option>
              <option value="GS1_DATAMATRIX">GS1 DataMatrix</option>
            </select>
          </div>

          {singleMedicine && scope === 'single' && (
            <div className="md:col-span-2">
              <label className="mb-1 block text-[11px] font-bold text-slate-700">التشغيلة المستهدفة (FEFO / Batch)</label>
              <select
                value={selectedBatchId}
                onChange={(e) => setSelectedBatchId(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold"
              >
                <option value="">الأقرب انتهاءً تلقائياً ({singleMedicine.batchNumber || 'افتراضي'})</option>
                {itemBatches.map((b) => (
                  <option key={b.id} value={String(b.id)}>
                    {b.batch_number} — ينتهي {b.expiry_date} (متبقي: {b.qty_remaining})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 9 Toggleable Label Content Fields */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-sky-200 pt-2.5 text-xs font-semibold text-slate-700">
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showPharmacyName} onChange={(e) => setShowPharmacyName(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>اسم الصيدلية</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showBranchName} onChange={(e) => setShowBranchName(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>المدينة / الفرع</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showTradeName} onChange={(e) => setShowTradeName(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>الاسم التجاري</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showScientificName} onChange={(e) => setShowScientificName(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>الاسم العلمي</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showUnitForm} onChange={(e) => setShowUnitForm(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>التركيز والشكل</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showExpiryDate} onChange={(e) => setShowExpiryDate(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>تاريخ الانتهاء</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showBatchNumber} onChange={(e) => setShowBatchNumber(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>رقم التشغيلة</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>السعر والعملة</span>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={showStorageLocation} onChange={(e) => setShowStorageLocation(e.target.checked)} className="h-3.5 w-3.5 accent-[#0B4F9C]" />
            <span>موقع الرف</span>
          </label>
          {scope !== 'single' && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-amber-800">
              <input
                type="checkbox"
                checked={includeExpired}
                onChange={(e) => setIncludeExpired(e.target.checked)}
                className="h-3.5 w-3.5 accent-amber-600"
              />
              <span>تضمين المنتهي الصلاحية</span>
            </label>
          )}
        </div>

        {/* Direct Thermal ZPL / TSPL Bridge & Download Controls */}
        {expandedLabels.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sky-200 pt-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSendDirectThermal('ZPL')}
                className="inline-flex items-center gap-1 rounded bg-[#0B4F9C] px-3 py-1 font-bold text-white hover:bg-[#083D7A]"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>إرسال ZPL (Zebra Bridge)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSendDirectThermal('TSPL')}
                className="inline-flex items-center gap-1 rounded bg-slate-700 px-3 py-1 font-bold text-white hover:bg-slate-800"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>إرسال TSPL (TSC/Xprinter)</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadThermalFile('ZPL')}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>تنزيل .ZPL</span>
              </button>
              <button
                type="button"
                onClick={() => handleDownloadThermalFile('TSPL')}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                <span>تنزيل .TSPL</span>
              </button>
            </div>
            {bridgeFeedback && (
              <div className="rounded bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-900">
                {bridgeFeedback}
              </div>
            )}
          </div>
        )}

        {/* Per-Medicine Quick Selection & Quantity Fine-Tuning */}
        {candidateItems.length > 0 && (
          <details className="rounded border border-slate-200 bg-white">
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-[#0B4F9C]" />
                <span>تخصيص الأصناف وعدد الملصقات لكل دواء ({candidateItems.length} دواء متاح)</span>
              </span>
              <span className="text-[11px] font-normal text-slate-500">انقر للتخصيص</span>
            </summary>
            <div className="max-h-48 divide-y divide-slate-100 overflow-y-auto border-t border-slate-200">
              {candidateItems.map((item) => {
                const checked = !excludedIds[item.id];
                const copies = getCopiesForItem(item);
                return (
                  <div
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs hover:bg-slate-50"
                  >
                    <label className="flex flex-1 cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          setExcludedIds((prev) => ({
                            ...prev,
                            [item.id]: !e.target.checked,
                          }))
                        }
                        className="h-3.5 w-3.5 accent-[#0B4F9C]"
                      />
                      <span className="font-bold text-slate-800">{item.name}</span>
                      <span className="font-mono text-[11px] text-slate-500" dir="ltr">
                        ({item.barcode})
                      </span>
                      <span className="text-[11px] text-emerald-700">
                        المتوفر: {item.quantity} {item.packUnit}
                      </span>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-slate-500">عدد الملصقات:</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        disabled={!checked}
                        value={checked ? copies : 0}
                        onChange={(e) =>
                          setPerItemCopies((prev) => ({
                            ...prev,
                            [item.id]: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
                          }))
                        }
                        className="w-14 rounded border border-slate-300 px-1.5 py-0.5 text-center font-bold disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </details>
        )}
      </div>

      {/* Printable Barcode Stickers Sheet */}
      {expandedLabels.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 py-12 text-center text-sm text-slate-500">
          <Barcode className="mx-auto mb-2 h-8 w-8 text-slate-400" />
          <p>لا توجد أدوية متوفرة أو ملصقات محددة للطباعة حالياً.</p>
        </div>
      ) : (
        <div
          className={gridClass}
          style={{ gap: `${Math.max(2, labelGapMm * 3)}px` }}
        >
          {expandedLabels.map(({ key, item }) => {
            const convertedPrice = convertFromBase(Number(item.price) || 0, activeCurrency.code, site);
            const rawCode =
              symbologyOverride === 'GS1_DATAMATRIX'
                ? `(01)${(item.barcode || `0000000000000${item.id}`).replace(/\D/g, '').padStart(14, '0').slice(-14)}${item.expiryDate ? `(17)${item.expiryDate.replace(/-/g, '').slice(2)}` : ''}${item.batchNumber ? `(10)${item.batchNumber}` : ''}`
                : item.barcode || `MED-${item.id}`;
            return (
              <div
                key={key}
                style={
                  layout === 'thermal'
                    ? { width: `${labelWidthMm}mm`, minHeight: `${labelHeightMm}mm` }
                    : undefined
                }
                className="flex break-inside-avoid flex-col justify-between rounded border border-dashed border-slate-400 bg-white p-2 text-center"
              >
                {(showPharmacyName || showBranchName) && (
                  <div className="truncate text-[10px] font-bold text-[#145632]">
                    {[showPharmacyName ? site.name : '', showBranchName ? site.city || '' : ''].filter(Boolean).join(' · ')}
                  </div>
                )}

                {showTradeName && (
                  <div className="mt-0.5 truncate text-xs font-extrabold text-slate-900">
                    {item.name}
                  </div>
                )}

                {showScientificName && item.scientificName && (
                  <div className="truncate text-[10px] text-slate-500">
                    {item.scientificName}
                  </div>
                )}

                {showUnitForm && (item.unit || item.dosageForm) && (
                  <div className="truncate text-[10px] text-slate-600">
                    {[item.unit, item.dosageForm].filter(Boolean).join(' — ')}
                  </div>
                )}

                <div className="my-1 flex justify-center overflow-hidden">
                  <BarcodeSvg
                    value={rawCode}
                    symbology={symbologyOverride === 'AUTO' ? undefined : symbologyOverride}
                    height={layout === 'grid4' || dpi >= 300 ? 30 : 38}
                    width={layout === 'grid4' ? 1.15 : 1.4}
                    fontSize={layout === 'grid4' ? 10 : 11}
                  />
                </div>

                <div className="flex items-center justify-between gap-1 border-t border-slate-200 pt-1 text-[10px]">
                  <span className="truncate font-mono text-slate-600" dir="ltr">
                    {[
                      showExpiryDate && item.expiryDate ? `EXP ${item.expiryDate}` : '',
                      showBatchNumber && item.batchNumber ? `B:${item.batchNumber}` : '',
                      showStorageLocation && item.storageLocation ? item.storageLocation : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {showPrice && (
                    <span className="shrink-0 font-extrabold text-slate-900">
                      {formatMoney(convertedPrice, activeCurrency.symbol)}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PrintPreviewModal>
  );
};
