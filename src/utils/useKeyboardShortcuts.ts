import { useEffect } from 'react';
import type { PageKey } from '../types';

interface ShortcutOptions {
  onNavigate: (page: PageKey) => void;
  onOpenCheckout?: () => void;
  onFocusBarcode?: () => void;
  onToggleHelp?: () => void;
  isSuspended?: boolean;
}

export function useKeyboardShortcuts({
  onNavigate,
  onOpenCheckout,
  onFocusBarcode,
  onToggleHelp,
  isSuspended = false,
}: ShortcutOptions) {
  useEffect(() => {
    if (isSuspended) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const isInput =
        active?.tagName === 'INPUT' ||
        active?.tagName === 'TEXTAREA' ||
        active?.tagName === 'SELECT' ||
        active?.isContentEditable;

      // F2: Go to billing & focus barcode
      if (e.key === 'F2') {
        e.preventDefault();
        onNavigate('billing');
        setTimeout(() => {
          onFocusBarcode?.();
        }, 100);
        return;
      }

      // F4: Open checkout modal if on billing
      if (e.key === 'F4') {
        e.preventDefault();
        onOpenCheckout?.();
        return;
      }

      if (isInput && !e.altKey && !e.ctrlKey) {
        return;
      }

      // Alt / Option navigation shortcuts
      if (e.altKey) {
        switch (e.key.toLowerCase()) {
          case '1':
            e.preventDefault();
            onNavigate('dashboard');
            break;
          case '2':
            e.preventDefault();
            onNavigate('billing');
            break;
          case '3':
            e.preventDefault();
            onNavigate('inventories');
            break;
          case '4':
            e.preventDefault();
            onNavigate('purchases');
            break;
          case '5':
            e.preventDefault();
            onNavigate('customers');
            break;
          case '6':
            e.preventDefault();
            onNavigate('accounting');
            break;
          case '7':
            e.preventDefault();
            onNavigate('reports');
            break;
          case '8':
            e.preventDefault();
            onNavigate('addnew');
            break;
          case 'h':
          case 'إ':
            e.preventDefault();
            onToggleHelp?.();
            break;
        }
      }

      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        onToggleHelp?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onNavigate, onOpenCheckout, onFocusBarcode, onToggleHelp, isSuspended]);
}
