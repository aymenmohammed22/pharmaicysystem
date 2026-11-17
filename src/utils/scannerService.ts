import {
  normalizeScannerInput,
  parseGs1Barcode,
  detectBarcodeSymbology,
  type Gs1ParseResult,
  type BarcodeSymbology,
} from '../../shared/gs1Barcode';

export interface ScannedPayloadEvent {
  raw: string;
  normalized: string;
  symbology: BarcodeSymbology;
  gs1: Gs1ParseResult;
  elapsedMs: number;
  capturedAt: string;
}

export interface HidScannerOptions {
  /** Maximum interval (ms) between consecutive HID scanner keystrokes */
  burstMaxIntervalMs?: number;
  /** Minimum payload length to qualify as a barcode scan */
  minLength?: number;
  /** Debounce window (ms) to ignore duplicate Enter/Tab trailing terminators */
  terminatorDebounceMs?: number;
  /** Element ref to skip global interception when focused directly (avoid double-handling form submit) */
  ignoredElement?: () => HTMLElement | null;
  /** Whether interception is paused (e.g., modal dialog open) */
  isSuspended?: () => boolean;
  /** Callback fired cleanly on complete barcode scan */
  onScan: (payload: ScannedPayloadEvent) => void;
}

// Physical US QWERTY scancode map so Arabic/IME active layout never scrambles barcode ASCII bytes
const SCANCODE_TO_ASCII: Record<string, [string, string]> = {
  Digit0: ['0', ')'],
  Digit1: ['1', '!'],
  Digit2: ['2', '@'],
  Digit3: ['3', '#'],
  Digit4: ['4', '$'],
  Digit5: ['5', '%'],
  Digit6: ['6', '^'],
  Digit7: ['7', '&'],
  Digit8: ['8', '*'],
  Digit9: ['9', '('],
  Numpad0: ['0', '0'],
  Numpad1: ['1', '1'],
  Numpad2: ['2', '2'],
  Numpad3: ['3', '3'],
  Numpad4: ['4', '4'],
  Numpad5: ['5', '5'],
  Numpad6: ['6', '6'],
  Numpad7: ['7', '7'],
  Numpad8: ['8', '8'],
  Numpad9: ['9', '9'],
  KeyA: ['a', 'A'],
  KeyB: ['b', 'B'],
  KeyC: ['c', 'C'],
  KeyD: ['d', 'D'],
  KeyE: ['e', 'E'],
  KeyF: ['f', 'F'],
  KeyG: ['g', 'G'],
  KeyH: ['h', 'H'],
  KeyI: ['i', 'I'],
  KeyJ: ['j', 'J'],
  KeyK: ['k', 'K'],
  KeyL: ['l', 'L'],
  KeyM: ['m', 'M'],
  KeyN: ['n', 'N'],
  KeyO: ['o', 'O'],
  KeyP: ['p', 'P'],
  KeyQ: ['q', 'Q'],
  KeyR: ['r', 'R'],
  KeyS: ['s', 'S'],
  KeyT: ['t', 'T'],
  KeyU: ['u', 'U'],
  KeyV: ['v', 'V'],
  KeyW: ['w', 'W'],
  KeyX: ['x', 'X'],
  KeyY: ['y', 'Y'],
  KeyZ: ['z', 'Z'],
  Minus: ['-', '_'],
  Equal: ['=', '+'],
  BracketLeft: ['[', '{'],
  BracketRight: [']', '}'],
  Backslash: ['\\', '|'],
  Semicolon: [';', ':'],
  Quote: ["'", '"'],
  Comma: [',', '<'],
  Period: ['.', '>'],
  Slash: ['/', '?'],
  Space: [' ', ' '],
};

function resolveHidCharacter(e: KeyboardEvent): string | null {
  // USB 2D scanners frequently transmit FNC1 / Group Separator <GS> (0x1D) as Ctrl+] or GroupSeparator key
  if (e.key === 'GroupSeparator' || e.key === '\x1D' || (e.ctrlKey && !e.altKey && (e.key === ']' || e.code === 'BracketRight'))) {
    return '\x1D';
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return null;

  if (e.code && SCANCODE_TO_ASCII[e.code]) {
    const [normal, shifted] = SCANCODE_TO_ASCII[e.code];
    return e.shiftKey ? shifted : normal;
  }
  if (e.key.length === 1) {
    return e.key;
  }
  return null;
}

export function analyzeScannedCode(rawInput: string): ScannedPayloadEvent {
  const gs1 = parseGs1Barcode(rawInput);
  const normalized = normalizeScannerInput(rawInput, {
    preserveGs: false,
    fixArabicLayout: true,
  });
  return {
    raw: rawInput,
    normalized: gs1.isGs1 && gs1.gtin ? gs1.gtin : normalized,
    symbology: detectBarcodeSymbology(rawInput),
    gs1,
    elapsedMs: 0,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Attaches a global USB/Bluetooth HID keyboard-wedge barcode listener:
 * - Intercepts fast scanner bursts outside editable inputs
 * - Preserves <GS> (\x1D) FNC1 delimiters (including Ctrl+])
 * - Immune to Windows/macOS Arabic keyboard layout via physical e.code mapping
 * - Debounces CR+LF / Enter+Tab suffix pairs
 */
export function attachHidScannerListener(options: HidScannerOptions): () => void {
  const burstMaxIntervalMs = options.burstMaxIntervalMs ?? 70;
  const minLength = options.minLength ?? 4;
  const terminatorDebounceMs = options.terminatorDebounceMs ?? 120;

  let buffer = '';
  let firstKeyAt = 0;
  let lastKeyAt = 0;
  let lastSubmitAt = 0;

  const handleKeyDown = (e: KeyboardEvent) => {
    if (options.isSuspended?.()) {
      buffer = '';
      return;
    }

    const active = document.activeElement as HTMLElement | null;
    if (options.ignoredElement && active === options.ignoredElement()) {
      return;
    }
    const tag = active?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active?.isContentEditable) {
      return;
    }

    const now = Date.now();
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (now - lastSubmitAt < terminatorDebounceMs) {
        e.preventDefault();
        buffer = '';
        return;
      }
      if (buffer.length >= minLength && now - lastKeyAt < 180) {
        e.preventDefault();
        const raw = buffer;
        const elapsedMs = firstKeyAt ? now - firstKeyAt : 0;
        buffer = '';
        firstKeyAt = 0;
        lastKeyAt = 0;
        lastSubmitAt = now;

        const analyzed = analyzeScannedCode(raw);
        analyzed.elapsedMs = elapsedMs;
        options.onScan(analyzed);
      } else {
        buffer = '';
        firstKeyAt = 0;
      }
      return;
    }

    const ch = resolveHidCharacter(e);
    if (!ch) return;

    if (ch === '\x1D' && e.ctrlKey) {
      e.preventDefault();
    }

    if (buffer.length === 0 || now - lastKeyAt > burstMaxIntervalMs) {
      buffer = ch;
      firstKeyAt = now;
    } else {
      buffer += ch;
    }
    lastKeyAt = now;
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}
