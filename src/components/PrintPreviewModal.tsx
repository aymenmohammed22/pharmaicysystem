import React, { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X, Maximize2, Minimize2, FileText, Receipt, Tag, SlidersHorizontal } from 'lucide-react';
import { api } from '../api';
import type { SiteSettings } from '../types';
import { SYSTEM_LOGO_SRC, resolvePhotoSrc } from '../types';
import { loadLocalTerminalConfig, saveLocalTerminalConfig } from '../utils/localPrintService';

export type PreviewPaperMode = 'a4' | 'receipt' | 'receipt80' | 'receipt58' | 'label';

const openPrintModalIds = new Set<string>();

interface PrintPreviewModalProps {
  open: boolean;
  title: string;
  site: SiteSettings;
  allowReceiptMode?: boolean;
  allowLabelMode?: boolean;
  defaultPaperMode?: PreviewPaperMode;
  autoPrint?: boolean;
  hideHeaderForLabel?: boolean;
  jobType?: string;
  onAutoPrintDone?: () => void;
  onClose: () => void;
  children: React.ReactNode;
}

export const PrintPreviewModal: React.FC<PrintPreviewModalProps> = ({
  open,
  title,
  site,
  allowReceiptMode = false,
  allowLabelMode = false,
  defaultPaperMode = 'a4',
  autoPrint = false,
  hideHeaderForLabel = false,
  jobType = 'document_print',
  onAutoPrintDone,
  onClose,
  children,
}) => {
  const instanceId = useId();
  const initialTerminalCfg = loadLocalTerminalConfig();
  const [paperMode, setPaperMode] = useState<PreviewPaperMode>(defaultPaperMode);
  const [marginTopMm, setMarginTopMm] = useState<number>(initialTerminalCfg.marginTopMm);
  const [marginSideMm, setMarginSideMm] = useState<number>(initialTerminalCfg.marginSideMm);
  const [showMarginControls, setShowMarginControls] = useState(false);
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);

  const isThermal = paperMode === 'receipt' || paperMode === 'receipt80' || paperMode === 'receipt58';

  const handlePrintPdf = React.useCallback(() => {
    const prevTitle = document.title;
    const safePdfTitle = `${title} — ${site.name}`.replace(/[\\/:*?"<>|]/g, '-');
    document.title = safePdfTitle;

    // Log print job honestly in Print Queue (best effort, never blocks printing)
    void api
      .createPrintJob({
        jobType,
        title,
        protocol: 'HTML_CSS',
        transport: 'browser_print',
        status: 'completed',
        copies: 1,
        payloadPreview: `Paper: ${paperMode}, Margin: ${marginTopMm}mm x ${marginSideMm}mm`,
      })
      .catch(() => {});

    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      document.title = prevTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };

    window.addEventListener('afterprint', restoreTitle);
    window.print();
    window.setTimeout(restoreTitle, 1500);
  }, [title, site.name, jobType, paperMode, marginTopMm, marginSideMm]);

  useEffect(() => {
    setPaperMode(defaultPaperMode);
  }, [defaultPaperMode, open]);

  useEffect(() => {
    if (!open) return;
    openPrintModalIds.add(instanceId);
    document.body.classList.add('print-modal-active');

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    const handleFsChange = () => {
      setIsBrowserFullscreen(Boolean(document.fullscreenElement));
    };

    window.addEventListener('keydown', handleKey);
    document.addEventListener('fullscreenchange', handleFsChange);

    return () => {
      openPrintModalIds.delete(instanceId);
      if (openPrintModalIds.size === 0) {
        document.body.classList.remove('print-modal-active');
      }
      window.removeEventListener('keydown', handleKey);
      document.removeEventListener('fullscreenchange', handleFsChange);
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, [open, onClose, instanceId]);

  useEffect(() => {
    if (!open || !autoPrint) return;
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        handlePrintPdf();
        onAutoPrintDone?.();
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      if (raf2) window.cancelAnimationFrame(raf2);
    };
  }, [open, autoPrint, handlePrintPdf, onAutoPrintDone]);

  if (!open) return null;

  const toggleBrowserFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback safely when fullscreen API is restricted by iframe permissions
    }
  };

  const handleSaveMargins = (top: number, side: number) => {
    setMarginTopMm(top);
    setMarginSideMm(side);
    const current = loadLocalTerminalConfig();
    saveLocalTerminalConfig({ ...current, marginTopMm: top, marginSideMm: side });
  };

  const pageSizeCss =
    paperMode === 'receipt58'
      ? '58mm auto'
      : paperMode === 'receipt' || paperMode === 'receipt80'
        ? '80mm auto'
        : 'A4 portrait';

  const paperWidthClass =
    paperMode === 'receipt58'
      ? 'max-w-[240px]'
      : paperMode === 'receipt' || paperMode === 'receipt80'
        ? 'max-w-sm'
        : 'max-w-5xl';

  return createPortal(
    <div
      id="print-preview-overlay"
      dir="rtl"
      className="fixed inset-0 z-[70] flex flex-col bg-slate-900/95"
    >
      {/* Dynamic @page CSS tailored to selected paper mode & margins */}
      <style>{`
        @media print {
          @page {
            size: ${pageSizeCss};
            margin: ${isThermal ? 3 : marginTopMm}mm ${isThermal ? 3 : marginSideMm}mm;
          }
        }
      `}</style>

      {/* Full-Screen Preview Top Toolbar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#F97316]/80 bg-[#0F1F38] px-4 py-3 text-white shadow-md">
        <div className="flex items-center gap-2.5">
          <Maximize2 className="h-5 w-5 text-[#F97316]" />
          <div>
            <h2 className="text-sm font-bold sm:text-base">معاينة ملء الشاشة قبل الطباعة — {title}</h2>
            <p className="text-[11px] text-slate-300">
              {site.name} ({site.currencyName} - {site.currencySymbol}){site.logo ? '' : ' · إتقان سوفت'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(allowReceiptMode || allowLabelMode) && (
            <div className="flex overflow-hidden rounded border border-slate-600 bg-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setPaperMode('a4')}
                className={`inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 font-semibold ${
                  paperMode === 'a4' ? 'bg-[#0B4F9C] text-white' : 'text-slate-200 hover:bg-slate-700'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>A4</span>
              </button>
              {allowReceiptMode && (
                <>
                  <button
                    type="button"
                    onClick={() => setPaperMode('receipt80')}
                    className={`inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 font-semibold ${
                      paperMode === 'receipt' || paperMode === 'receipt80'
                        ? 'bg-[#0B4F9C] text-white'
                        : 'text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    <span>حراري 80mm</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaperMode('receipt58')}
                    className={`inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 font-semibold ${
                      paperMode === 'receipt58' ? 'bg-[#0B4F9C] text-white' : 'text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    <span>حراري 58mm</span>
                  </button>
                </>
              )}
              {allowLabelMode && (
                <button
                  type="button"
                  onClick={() => setPaperMode('label')}
                  className={`inline-flex items-center gap-1 whitespace-nowrap px-2.5 py-1.5 font-semibold ${
                    paperMode === 'label' ? 'bg-[#0B4F9C] text-white' : 'text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  <Tag className="h-3.5 w-3.5" />
                  <span>وضع الملصقات</span>
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowMarginControls((v) => !v)}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-slate-600 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span>الهوامش ({marginTopMm}×{marginSideMm}mm)</span>
          </button>

          <button
            type="button"
            onClick={toggleBrowserFullscreen}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
          >
            {isBrowserFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span>{isBrowserFullscreen ? 'إنهاء ملء المتصفح' : 'ملء شاشة المتصفح'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrintPdf}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white shadow hover:bg-emerald-700"
          >
            <Printer className="h-4 w-4" />
            <span>طباعة الآن / حفظ PDF</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700"
          >
            <X className="h-4 w-4" />
            <span>إغلاق</span>
          </button>
        </div>
      </div>

      {showMarginControls && (
        <div className="no-print flex flex-wrap items-center gap-4 border-b border-slate-700 bg-slate-800 px-4 py-2 text-xs text-slate-200">
          <label className="flex items-center gap-2">
            <span>الهامش العلوي/السفلي (mm):</span>
            <input
              type="number"
              min={0}
              max={30}
              value={marginTopMm}
              onChange={(e) => handleSaveMargins(Math.min(30, Math.max(0, Number(e.target.value) || 0)), marginSideMm)}
              className="w-16 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-center font-mono text-white"
            />
          </label>
          <label className="flex items-center gap-2">
            <span>الهامش الجانبي (mm):</span>
            <input
              type="number"
              min={0}
              max={30}
              value={marginSideMm}
              onChange={(e) => handleSaveMargins(marginTopMm, Math.min(30, Math.max(0, Number(e.target.value) || 0)))}
              className="w-16 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-center font-mono text-white"
            />
          </label>
          <span className="text-[11px] text-slate-400">يتم حفظ إعدادات الهوامش محلياً لهذه المحطة.</span>
        </div>
      )}

      {/* Scrollable Centered Paper Sheet */}
      <div id="print-preview-scroll" className="flex-1 overflow-y-auto p-4 sm:p-8">
        <div
          id="print-preview-root"
          data-paper-mode={paperMode}
          className={`mx-auto rounded-lg border-t-4 border-t-[#F97316] bg-white p-6 text-slate-900 shadow-2xl transition-all sm:p-8 ${paperWidthClass}`}
        >
          {/* Official Pharmacy & itQAN Soft Print Header */}
          {!(hideHeaderForLabel && paperMode === 'label') && (
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b-2 border-[#0B4F9C] pb-3">
              <div className="flex items-center gap-3">
                {site.logo ? (
                  <img
                    src={resolvePhotoSrc(site.logo)}
                    alt={site.name}
                    className={`${isThermal ? 'h-9' : 'h-12'} w-auto max-w-[140px] object-contain`}
                  />
                ) : !logoFailed ? (
                  <img
                    src={SYSTEM_LOGO_SRC}
                    alt="شعار النظام - إتقان سوفت (itQAN Soft)"
                    referrerPolicy="no-referrer"
                    onError={() => setLogoFailed(true)}
                    className={`${isThermal ? 'h-9' : 'h-12'} w-auto object-contain`}
                  />
                ) : null}
                <div>
                  <div className="text-xl font-bold text-[#0B4F9C]">
                    {site.name}
                    {site.tradeName && site.tradeName !== site.name ? (
                      <span className="mr-1.5 text-sm font-semibold text-slate-600">({site.tradeName})</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-slate-600">{site.title}</div>
                  {(site.phone || site.address || site.city || site.country || site.taxNumber || site.licenseNumber) && (
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
                      {(site.address || site.city || site.country) && (
                        <span>{[site.address, site.city, site.country].filter(Boolean).join(' - ')}</span>
                      )}
                      {site.phone && <span dir="ltr">{site.phone}</span>}
                      {site.taxNumber && <span dir="ltr">VAT: {site.taxNumber}</span>}
                      {site.licenseNumber && <span dir="ltr">LIC: {site.licenseNumber}</span>}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-left">
                <div className="text-sm font-bold text-slate-800">{title}</div>
                <div className="font-mono text-[11px] text-slate-500" dir="ltr">
                  {new Date().toISOString().slice(0, 16).replace('T', ' ')}
                </div>
              </div>
            </div>
          )}

          {children}

          {!(hideHeaderForLabel && paperMode === 'label') && (
            <div className="mt-6 border-t border-slate-200 pt-2.5 text-center text-[11px] text-slate-500">
              {site.logo ? `${site.name} · ${site.title}` : 'نظام إدارة الصيدليات المتكامل · إتقان سوفت (itQAN Soft)'}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
