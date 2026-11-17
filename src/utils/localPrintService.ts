import type { InventoryItem, SiteSettings, SoldInvoice } from '../types';
import { formatMoney } from '../types';

export type TerminalPaperMode = 'a4' | 'receipt80' | 'receipt58' | 'label';

export interface LocalTerminalHardwareConfig {
  terminalId: string;
  defaultPaperMode: TerminalPaperMode;
  marginTopMm: number;
  marginSideMm: number;
  bridgeUrl: string;
  autoPrintReceipt: boolean;
  scannerSuffix: 'Enter' | 'Tab';
  scannerBurstMs: number;
  preferredThermalDeviceId?: number | null;
  preferredLabelDeviceId?: number | null;
}

const STORAGE_KEY = 'omni_terminal_hardware_v1';

export const DEFAULT_TERMINAL_CONFIG: LocalTerminalHardwareConfig = {
  terminalId: 'POS-01',
  defaultPaperMode: 'a4',
  marginTopMm: 8,
  marginSideMm: 8,
  bridgeUrl: 'http://127.0.0.1:9191',
  autoPrintReceipt: false,
  scannerSuffix: 'Enter',
  scannerBurstMs: 70,
  preferredThermalDeviceId: null,
  preferredLabelDeviceId: null,
};

export function loadLocalTerminalConfig(): LocalTerminalHardwareConfig {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_TERMINAL_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LocalTerminalHardwareConfig>;
    return {
      ...DEFAULT_TERMINAL_CONFIG,
      ...parsed,
      marginTopMm: Math.min(30, Math.max(0, Number(parsed.marginTopMm ?? 8))),
      marginSideMm: Math.min(30, Math.max(0, Number(parsed.marginSideMm ?? 8))),
      scannerBurstMs: Math.min(200, Math.max(25, Number(parsed.scannerBurstMs ?? 70))),
    };
  } catch {
    return { ...DEFAULT_TERMINAL_CONFIG };
  }
}

export function saveLocalTerminalConfig(cfg: LocalTerminalHardwareConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Ignore storage quota errors inside restricted contexts
  }
}

export function getClientHardwareCapabilities(): {
  browserPrintSupported: boolean;
  webSerialSupported: boolean;
  webHidSupported: boolean;
  electronBridgeSupported: boolean;
} {
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as Record<string, unknown>) : {};
  const win = typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : {};
  return {
    browserPrintSupported: typeof window !== 'undefined' && typeof window.print === 'function',
    webSerialSupported: typeof nav.serial === 'object' && nav.serial !== null,
    webHidSupported: typeof nav.hid === 'object' && nav.hid !== null,
    electronBridgeSupported: typeof win.electronAPI === 'object' && win.electronAPI !== null,
  };
}

/**
 * Checks honestly whether a local companion print bridge HTTP server is reachable on this machine.
 */
export async function checkLocalPrintBridgeHealth(bridgeUrl: string): Promise<{
  reachable: boolean;
  reason: string;
  printers?: string[];
}> {
  const cleanUrl = bridgeUrl.trim().replace(/\/$/, '');
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
    return { reachable: false, reason: 'عنوان Print Bridge غير صالح' };
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1600);
  try {
    const res = await fetch(`${cleanUrl}/health`, { signal: controller.signal });
    if (!res.ok) {
      return { reachable: false, reason: `استجاب الخادم المحلي برمز HTTP ${res.status}` };
    }
    const data = (await res.json().catch(() => ({}))) as { printers?: string[] };
    return {
      reachable: true,
      reason: 'تم الاتصال بخدمة الطباعة المحلية بنجاح',
      printers: Array.isArray(data.printers) ? data.printers : undefined,
    };
  } catch {
    return {
      reachable: false,
      reason: 'لا يوجد Print Bridge محلي يعمل على المنفذ المحدد؛ سيتم استخدام طباعة المتصفح CSS/PDF.',
    };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function dispatchToLocalPrintBridge(params: {
  bridgeUrl: string;
  protocol: string;
  payload: string;
  host?: string;
  port?: number;
  copies?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const cleanUrl = params.bridgeUrl.trim().replace(/\/$/, '');
  if (!cleanUrl) return { ok: false, error: 'عنوان Local Print Bridge غير مضبوط' };
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${cleanUrl}/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        protocol: params.protocol,
        payload: params.payload,
        host: params.host || '',
        port: params.port || 9100,
        copies: params.copies || 1,
      }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { ok: false, error: txt || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'خدمة Print Bridge المحلية غير متصلة على هذا الجهاز' };
  } finally {
    window.clearTimeout(timer);
  }
}

export async function dispatchToWebSerial(payload: string, baudRate = 9600): Promise<{ ok: boolean; error?: string }> {
  const nav = navigator as unknown as {
    serial?: {
      requestPort: () => Promise<{
        open: (opts: { baudRate: number }) => Promise<void>;
        close: () => Promise<void>;
        writable?: WritableStream<Uint8Array>;
      }>;
    };
  };
  if (!nav.serial) {
    return { ok: false, error: 'المتصفح الحالي لا يدعم WebSerial API للطباعة المباشرة عبر منفذ COM/USB' };
  }
  try {
    const port = await nav.serial.requestPort();
    await port.open({ baudRate });
    if (port.writable) {
      const writer = port.writable.getWriter();
      await writer.write(new TextEncoder().encode(payload));
      writer.releaseLock();
    }
    await port.close();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'تم إلغاء اختيار المنفذ التسلسلي أو تعذر فتحه',
    };
  }
}

/**
 * Generates an ESC/POS receipt command string/preview for 58mm/80mm thermal printers.
 */
export function buildEscPosReceiptPayload(params: {
  invoice: SoldInvoice;
  site: SiteSettings;
  paperWidthMm?: 58 | 80;
  openDrawer?: boolean;
}): { rawCommands: string; previewText: string } {
  const { invoice, site } = params;
  const cols = params.paperWidthMm === 58 ? 32 : 48;
  const line = '-'.repeat(cols);
  const currSymbol = invoice.currencySymbol || site.currencySymbol;
  const ESC = '\x1B';
  const GS = '\x1D';

  const bodyLines = [
    site.name,
    site.phone ? `Tel: ${site.phone}` : '',
    site.taxNumber ? `VAT: ${site.taxNumber}` : '',
    line,
    `INV #${invoice.id} | ${invoice.date}`,
    `Customer: ${invoice.name}`,
    line,
    ...invoice.itemsDetail.map(
      (it) => `${it.name} (${it.qty} ${it.saleUnit}) -> ${formatMoney(it.price * it.qty, currSymbol)}`,
    ),
    line,
    `Discount: ${invoice.discount}%`,
    `TOTAL: ${formatMoney(invoice.amount, currSymbol)}`,
    `Paid: ${formatMoney(invoice.paidAmount ?? invoice.amount, currSymbol)}`,
    line,
    'Thank you - itQAN Soft ERP',
  ].filter(Boolean);

  const previewText = bodyLines.join('\n');
  const rawCommands =
    `${ESC}@` +
    `${ESC}a\x01${site.name}\n` +
    `${ESC}a\x00${previewText}\n\n\n` +
    `${GS}V\x00` +
    (params.openDrawer ? `${ESC}p\x00\x19\xFA` : '');

  return { rawCommands, previewText };
}

/**
 * Generates ZPL II command stream for Zebra thermal label printers (203 / 300 DPI).
 */
export function buildZplLabelPayload(params: {
  item: InventoryItem;
  site: SiteSettings;
  widthMm: number;
  heightMm: number;
  dpi?: 203 | 300;
  copies?: number;
}): string {
  const dpmm = (params.dpi ?? 203) >= 300 ? 12 : 8;
  const pw = Math.round(params.widthMm * dpmm);
  const ll = Math.round(params.heightMm * dpmm);
  const copies = Math.max(1, params.copies ?? 1);
  const code = params.item.barcode || `MED-${params.item.id}`;

  return [
    '^XA',
    `^PW${pw}`,
    `^LL${ll}`,
    '^CI28',
    `^FO16,12^A0N,${Math.round(3.2 * dpmm)},${Math.round(2.8 * dpmm)}^FD${params.site.name}^FS`,
    `^FO16,${Math.round(5.5 * dpmm)}^A0N,${Math.round(3.4 * dpmm)},${Math.round(3 * dpmm)}^FD${params.item.name.slice(0, 32)}^FS`,
    `^FO16,${Math.round(10 * dpmm)}^BY2,2,${Math.round(8 * dpmm)}^BCN,${Math.round(8 * dpmm)},Y,N,N^FD${code}^FS`,
    `^FO16,${Math.round(20.5 * dpmm)}^A0N,${Math.round(2.6 * dpmm)},${Math.round(2.4 * dpmm)}^FDEXP:${params.item.expiryDate || '-'}  ${formatMoney(params.item.price, params.site.currencySymbol)}^FS`,
    `^PQ${copies},0,1,Y`,
    '^XZ',
  ].join('\n');
}

/**
 * Generates TSPL2 command stream for TSC / Xprinter thermal label printers.
 */
export function buildTsplLabelPayload(params: {
  item: InventoryItem;
  site: SiteSettings;
  widthMm: number;
  heightMm: number;
  gapMm?: number;
  copies?: number;
}): string {
  const copies = Math.max(1, params.copies ?? 1);
  const code = params.item.barcode || `MED-${params.item.id}`;
  return [
    `SIZE ${params.widthMm} mm,${params.heightMm} mm`,
    `GAP ${params.gapMm ?? 2} mm,0`,
    'DIRECTION 1',
    'DENSITY 10',
    'CLS',
    `TEXT 16,12,"2",0,1,1,"${params.site.name}"`,
    `TEXT 16,42,"2",0,1,1,"${params.item.name.slice(0, 28)}"`,
    `BARCODE 16,74,"128",56,1,0,2,2,"${code}"`,
    `TEXT 16,158,"1",0,1,1,"EXP:${params.item.expiryDate || '-'} | ${formatMoney(params.item.price, params.site.currencySymbol)}"`,
    `PRINT ${copies},1`,
  ].join('\r\n');
}
