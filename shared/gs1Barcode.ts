export type BarcodeSymbology =
  | 'EAN13'
  | 'EAN8'
  | 'ITF14'
  | 'CODE128'
  | 'GS1_DATAMATRIX'
  | 'QR';

export interface Gs1ParseResult {
  isGs1: boolean;
  normalizedRaw: string;
  aimPrefix: string;
  gtin?: string;
  gtin13?: string;
  expiryDate?: string;
  expiryRaw?: string;
  isExpired?: boolean;
  prodDate?: string;
  batchNumber?: string;
  serialNumber?: string;
  quantity?: number;
  extraAis: Record<string, string>;
}

const ARABIC_INDIC_MAP: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

// Standard Windows/macOS Arabic QWERTY -> US English QWERTY map for HID scanners active in Arabic IME
const ARABIC_QWERTY_TO_ASCII: Record<string, string> = {
  'ض': 'q',
  'ص': 'w',
  'ث': 'e',
  'ق': 'r',
  'ف': 't',
  'غ': 'y',
  'ع': 'u',
  'ه': 'i',
  'خ': 'o',
  'ح': 'p',
  'ج': '[',
  'د': ']',
  'ش': 'a',
  'س': 's',
  'ي': 'd',
  'ب': 'f',
  'ل': 'g',
  'ا': 'h',
  'ت': 'j',
  'ن': 'k',
  'م': 'l',
  'ك': ';',
  'ط': "'",
  'ئ': 'z',
  'ء': 'x',
  'ؤ': 'c',
  'ر': 'v',
  'لا': 'b',
  'ى': 'n',
  'ة': 'm',
  'و': ',',
  'ز': '.',
  'ظ': '/',
  'ذ': '`',
  'أ': 'H',
  'إ': 'Y',
  'آ': 'N',
  'لأ': 'G',
  'لإ': 'T',
  'لآ': 'B',
  '؛': 'P',
  '،': 'K',
  '؟': '?',
  '×': 'O',
  '÷': 'I',
  'ـ': 'J',
};

export function normalizePosDigits(input: string): string {
  return String(input ?? '').replace(/[٠-٩۰-۹]/g, (ch) => ARABIC_INDIC_MAP[ch] ?? ch);
}

/**
 * Converts a string mistakenly captured while Windows/macOS input language was Arabic
 * back into its underlying ASCII keystrokes (e.g. "ضصث" -> "qwe").
 */
export function mapArabicKeyboardToAscii(raw: string): string {
  let out = normalizePosDigits(raw);
  // Handle two-char ligatures first
  out = out
    .replace(/لأ/g, 'G')
    .replace(/لإ/g, 'T')
    .replace(/لآ/g, 'B')
    .replace(/لا/g, 'b');

  let result = '';
  for (const ch of out) {
    result += ARABIC_QWERTY_TO_ASCII[ch] ?? ch;
  }
  return result;
}

/**
 * Normalizes raw input from USB/Bluetooth HID or 2D scanners:
 * - Converts Arabic-Indic & Persian numerals to ASCII digits
 * - Optionally repairs Arabic-layout QWERTY keystrokes (auto-enabled if AIM/GS or barcode signature found)
 * - Strips AIM symbology prefixes (e.g. ]C1, ]E0, ]d2)
 * - Optionally preserves Group Separator \x1D (ASCII 29) for GS1 DataMatrix parsing
 */
export function normalizeScannerInput(
  rawInput: string,
  options?: { preserveGs?: boolean; fixArabicLayout?: boolean },
): string {
  const preserveGs = options?.preserveGs ?? true;
  let cleaned = String(rawInput ?? '').replace(
    preserveGs ? /[\x00-\x1C\x1E\x1F\x7F]/g : /[\x00-\x1F\x7F]/g,
    '',
  );

  const hasGsOrAim = /\x1D/.test(cleaned) || /^\]/.test(cleaned.trimStart());
  if (options?.fixArabicLayout || hasGsOrAim) {
    cleaned = mapArabicKeyboardToAscii(cleaned);
  } else {
    cleaned = normalizePosDigits(cleaned);
  }

  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/^\][A-Za-z0-9]{2}/, '');
  return cleaned.trim();
}

export function extractAimPrefix(rawInput: string): string {
  const m = String(rawInput ?? '').trim().match(/^(\][A-Za-z0-9]{2})/);
  return m ? m[1] : '';
}

/**
 * Computes GS1 Mod-10 check digit for EAN-8 (7 base digits), EAN-13 (12 base digits),
 * or GTIN-14 / ITF-14 (13 base digits).
 */
export function calculateGs1CheckDigit(digitsWithoutCheck: string): string {
  const clean = normalizePosDigits(digitsWithoutCheck).replace(/\D/g, '');
  if (!clean) return '0';
  let sum = 0;
  // Standard GS1 weightings count from right-most position * 3 alternating * 1
  for (let i = clean.length - 1, pos = 0; i >= 0; i -= 1, pos += 1) {
    const d = Number(clean[i]);
    sum += pos % 2 === 0 ? d * 3 : d;
  }
  const mod = sum % 10;
  return String(mod === 0 ? 0 : 10 - mod);
}

export function isValidEan13(code: string): boolean {
  const clean = normalizePosDigits(code).trim();
  if (!/^\d{13}$/.test(clean)) return false;
  return calculateGs1CheckDigit(clean.slice(0, 12)) === clean[12];
}

export function isValidEan8(code: string): boolean {
  const clean = normalizePosDigits(code).trim();
  if (!/^\d{8}$/.test(clean)) return false;
  return calculateGs1CheckDigit(clean.slice(0, 7)) === clean[7];
}

export function isValidGtin14(code: string): boolean {
  const clean = normalizePosDigits(code).trim();
  if (!/^\d{14}$/.test(clean)) return false;
  return calculateGs1CheckDigit(clean.slice(0, 13)) === clean[13];
}

export function isValidItf14(code: string): boolean {
  return isValidGtin14(code);
}

export function generateInternalEan13(seed?: number): string {
  const rnd = seed !== undefined
    ? Math.abs(Math.floor(seed))
    : Math.floor(100000000 + Math.random() * 899999999);
  const body = `200${String(rnd).padStart(9, '0').slice(-9)}`;
  return `${body}${calculateGs1CheckDigit(body)}`;
}

export function detectBarcodeSymbology(rawCode: string): BarcodeSymbology {
  const code = normalizeScannerInput(rawCode, { preserveGs: true });
  if (code.includes('\x1D') || /^\(01\)\d{14}/.test(code) || /^01\d{14}(?:17|10|21)/.test(code)) {
    return 'GS1_DATAMATRIX';
  }
  if (/^\d{14}$/.test(code) && isValidGtin14(code)) return 'ITF14';
  if (/^\d{13}$/.test(code) && isValidEan13(code)) return 'EAN13';
  if (/^\d{8}$/.test(code) && isValidEan8(code)) return 'EAN8';
  if (code.length > 48 || code.startsWith('http://') || code.startsWith('https://')) {
    return 'QR';
  }
  return 'CODE128';
}

function parseGs1YyMmDd(yyMmDd: string): string | undefined {
  if (!/^\d{6}$/.test(yyMmDd)) return undefined;
  const yy = Number(yyMmDd.slice(0, 2));
  const mm = Number(yyMmDd.slice(2, 4));
  let dd = Number(yyMmDd.slice(4, 6));
  if (mm < 1 || mm > 12) return undefined;
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  // GS1 General Spec: DD == '00' denotes last day of the month
  if (dd === 0) {
    dd = new Date(year, mm, 0).getDate();
  }
  const maxDay = new Date(year, mm, 0).getDate();
  if (dd < 1 || dd > maxDay) return undefined;
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Parses GS1 DataMatrix / GS1-128 strings (supporting both FNC1 \x1D separated payloads and HRI "(01)...(17)...(10)..." format).
 * Supported Application Identifiers:
 *  - (01) GTIN-14
 *  - (02) Content GTIN-14
 *  - (11) Production Date YYMMDD
 *  - (17) Expiry Date YYMMDD (handles DD=00 last day of month)
 *  - (10) Batch / Lot Number (variable, GS-terminated)
 *  - (21) Serial Number (variable, GS-terminated)
 *  - (30) Variable Count / Quantity
 *  - (240) Additional Product Identification
 */
export function parseGs1Barcode(rawInput: string, todayIso?: string): Gs1ParseResult {
  const aimPrefix = extractAimPrefix(rawInput);
  const normalizedRaw = normalizeScannerInput(rawInput, {
    preserveGs: true,
    fixArabicLayout: true,
  });
  const extraAis: Record<string, string> = {};

  if (!normalizedRaw) {
    return { isGs1: false, normalizedRaw: '', aimPrefix, extraAis };
  }

  let matchedAnyAi = false;
  let gtin: string | undefined;
  let expiryDate: string | undefined;
  let expiryRaw: string | undefined;
  let prodDate: string | undefined;
  let batchNumber: string | undefined;
  let serialNumber: string | undefined;
  let quantity: number | undefined;

  const applyAi = (ai: string, value: string) => {
    matchedAnyAi = true;
    extraAis[ai] = value;
    if (ai === '01' || ai === '02') {
      if (/^\d{14}$/.test(value)) gtin = value;
    } else if (ai === '17') {
      expiryRaw = value;
      expiryDate = parseGs1YyMmDd(value);
    } else if (ai === '11') {
      prodDate = parseGs1YyMmDd(value);
    } else if (ai === '10') {
      batchNumber = value.trim();
    } else if (ai === '21') {
      serialNumber = value.trim();
    } else if (ai === '30' || ai === '37') {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) quantity = n;
    }
  };

  // Mode 1: Human Readable Interpretation (HRI) with parentheses, e.g. (01)0628...(17)271231(10)B123(21)S99
  if (/^\(\d{2,4}\)/.test(normalizedRaw)) {
    const hriRegex = /\((\d{2,4})\)([^\(\x1D]+)/g;
    let m: RegExpExecArray | null;
    while ((m = hriRegex.exec(normalizedRaw)) !== null) {
      applyAi(m[1], m[2].replace(/\x1D/g, '').trim());
    }
  } else if (/^(?:01\d{14}|02\d{14}|17\d{6}|10[^\x1D]+|21[^\x1D]+)/.test(normalizedRaw) && (normalizedRaw.length > 16 || normalizedRaw.includes('\x1D'))) {
    // Mode 2: Raw FNC1 stream (with optional GS \x1D terminators after variable-length AIs)
    // Only engage Mode 2 when prefix + length clearly indicates GS1 payload rather than normal Code128
    const FIXED_AI_LENGTHS: Record<string, number> = {
      '00': 18,
      '01': 14,
      '02': 14,
      '11': 6,
      '12': 6,
      '13': 6,
      '15': 6,
      '16': 6,
      '17': 6,
      '20': 2,
    };
    const VARIABLE_AIS_2 = new Set(['10', '21', '22', '30', '37']);
    const VARIABLE_AIS_3 = new Set(['240', '241', '250', '251']);

    let cursor = 0;
    const str = normalizedRaw;
    let safetySteps = 0;
    while (cursor < str.length && safetySteps < 20) {
      safetySteps += 1;
      if (str[cursor] === '\x1D') {
        cursor += 1;
        continue;
      }
      const ai2 = str.slice(cursor, cursor + 2);
      const ai3 = str.slice(cursor, cursor + 3);
      if (FIXED_AI_LENGTHS[ai2] !== undefined) {
        const len = FIXED_AI_LENGTHS[ai2];
        const val = str.slice(cursor + 2, cursor + 2 + len);
        if (val.length === len) {
          applyAi(ai2, val);
          cursor += 2 + len;
          continue;
        }
        break;
      }
      if (VARIABLE_AIS_2.has(ai2)) {
        const gsIdx = str.indexOf('\x1D', cursor + 2);
        const endIdx = gsIdx >= 0 ? gsIdx : str.length;
        const val = str.slice(cursor + 2, endIdx);
        applyAi(ai2, val);
        cursor = gsIdx >= 0 ? gsIdx + 1 : str.length;
        continue;
      }
      if (VARIABLE_AIS_3.has(ai3)) {
        const gsIdx = str.indexOf('\x1D', cursor + 3);
        const endIdx = gsIdx >= 0 ? gsIdx : str.length;
        const val = str.slice(cursor + 3, endIdx);
        applyAi(ai3, val);
        cursor = gsIdx >= 0 ? gsIdx + 1 : str.length;
        continue;
      }
      break;
    }
  }

  const gtin13 = gtin && gtin.startsWith('0') ? gtin.slice(1) : undefined;
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const isExpired = expiryDate ? expiryDate < today : undefined;

  return {
    isGs1: matchedAnyAi && Boolean(gtin || expiryDate || batchNumber || serialNumber),
    normalizedRaw: normalizedRaw.replace(/\x1D/g, ''),
    aimPrefix,
    gtin,
    gtin13,
    expiryDate,
    expiryRaw,
    isExpired,
    prodDate,
    batchNumber,
    serialNumber,
    quantity,
    extraAis,
  };
}
