import type { InventoryItem } from '../types';
import {
  normalizePosDigits,
  normalizeScannerInput,
  parseGs1Barcode,
  detectBarcodeSymbology,
  calculateGs1CheckDigit,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
} from '../../shared/gs1Barcode';

export {
  normalizePosDigits,
  normalizeScannerInput,
  parseGs1Barcode,
  detectBarcodeSymbology,
  calculateGs1CheckDigit,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
};

export type PosMatchField = 'name' | 'scientificName' | 'barcode' | 'unit';

export interface PosSearchMatch {
  item: InventoryItem;
  matchedField: PosMatchField;
  matchedLen: number;
  available: boolean;
  priority: number;
}

export function normalizePosText(input: string): string {
  return normalizePosDigits(input)
    .replace(/[\u0640\u064B-\u065F\u0670]/g, '')
    .toLowerCase()
    .trimStart();
}

function getNormalizedMatchedLength(rawTarget: string, normalizedQuery: string): number {
  if (!normalizedQuery) return 0;
  let normCount = 0;
  let i = 0;
  const trimmedTarget = rawTarget.trimStart();
  const leadingOffset = rawTarget.length - trimmedTarget.length;

  for (i = 0; i < trimmedTarget.length && normCount < normalizedQuery.length; i += 1) {
    const ch = trimmedTarget[i];
    if (/[\u0640\u064B-\u065F\u0670]/.test(ch)) {
      continue;
    }
    normCount += 1;
  }
  return leadingOffset + i;
}

/**
 * Exact prefix matching for POS medicines:
 * Matches items whose trade name, scientific name, barcode, or concentration (unit)
 * strictly starts with the typed letters/digits.
 */
export function findPosPrefixMatches(
  inventories: InventoryItem[],
  rawQuery: string,
  options?: { preferBarcodeFirst?: boolean },
): PosSearchMatch[] {
  const q = normalizePosText(rawQuery).trim();
  if (!q) return [];

  const preferBarcode = options?.preferBarcodeFirst ?? /^[0-9]/.test(q);
  const matches: PosSearchMatch[] = [];

  for (const item of inventories) {
    const nameNorm = normalizePosText(item.name || '');
    const sciNorm = normalizePosText(item.scientificName || '');
    const barcodeNorm = normalizePosText(item.barcode || '');
    const unitNorm = normalizePosText(item.unit || '');

    let matchedField: PosMatchField | null = null;
    let rawField = '';
    let priority = 99;

    if (preferBarcode && barcodeNorm.startsWith(q)) {
      matchedField = 'barcode';
      rawField = item.barcode || '';
      priority = 1;
    } else if (nameNorm.startsWith(q)) {
      matchedField = 'name';
      rawField = item.name || '';
      priority = preferBarcode ? 2 : 1;
    } else if (sciNorm.startsWith(q)) {
      matchedField = 'scientificName';
      rawField = item.scientificName || '';
      priority = preferBarcode ? 3 : 2;
    } else if (barcodeNorm.startsWith(q)) {
      matchedField = 'barcode';
      rawField = item.barcode || '';
      priority = 3;
    } else if (unitNorm.startsWith(q)) {
      matchedField = 'unit';
      rawField = item.unit || '';
      priority = 4;
    }

    if (!matchedField) continue;

    const available = item.status !== 'suspended' && item.quantity > 0;
    const matchedLen = getNormalizedMatchedLength(rawField, q);
    matches.push({
      item,
      matchedField,
      matchedLen,
      available,
      priority,
    });
  }

  matches.sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.item.name.localeCompare(b.item.name, 'ar');
  });

  return matches;
}
