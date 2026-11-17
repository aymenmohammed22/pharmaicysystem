import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js/browser';
import {
  detectBarcodeSymbology,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
  type BarcodeSymbology,
} from '../../shared/gs1Barcode';

interface BarcodeSvgProps {
  value: string;
  symbology?: BarcodeSymbology;
  height?: number;
  width?: number;
  fontSize?: number;
  displayValue?: boolean;
  className?: string;
}

export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  symbology,
  height = 38,
  width = 1.4,
  fontSize = 11,
  displayValue = true,
  className = 'mx-auto block max-w-full',
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgMarkup, setSvgMarkup] = useState<string | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  const rawText = (value || '').trim();
  const safeValue = rawText.replace(/[^\x20-\x7E\x1D]/g, '') || '0000000000';
  const effectiveSymbology = symbology ?? detectBarcodeSymbology(safeValue);

  useEffect(() => {
    let cancelled = false;

    if (effectiveSymbology === 'QR') {
      setSvgMarkup(null);
      void QRCode.toString(rawText || safeValue, {
        type: 'svg',
        margin: 1,
        width: Math.max(52, height * 1.4),
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((markup) => {
          if (!cancelled) {
            setSvgMarkup(markup);
            setFallbackText(null);
          }
        })
        .catch(() => {
          if (!cancelled) setFallbackText(rawText || safeValue);
        });
      return () => {
        cancelled = true;
      };
    }

    if (effectiveSymbology === 'GS1_DATAMATRIX') {
      try {
        // bwip-js expects FNC1 as \x1D or HRI "(01)..." via gs1datamatrix; fallback to datamatrix if arbitrary text
        const textForMatrix = /^\(\d{2,4}\)/.test(safeValue) ? safeValue : safeValue.replace(/\x1D/g, '');
        const bcid = /^\(\d{2,4}\)/.test(textForMatrix) ? 'gs1datamatrix' : 'datamatrix';
        const markup = bwipjs.toSVG({
          bcid,
          text: textForMatrix,
          scale: 2,
          paddingwidth: 2,
          paddingheight: 2,
          backgroundcolor: 'ffffff',
          barcolor: '0f172a',
        });
        setSvgMarkup(markup);
        setFallbackText(null);
      } catch {
        setSvgMarkup(null);
        setFallbackText(rawText || safeValue);
      }
      return;
    }

    setSvgMarkup(null);
    const el = svgRef.current;
    if (!el) return;

    let jsFormat: 'EAN13' | 'EAN8' | 'ITF14' | 'CODE128' = 'CODE128';
    const digitsOnly = safeValue.replace(/\x1D/g, '').trim();
    if (effectiveSymbology === 'EAN13' && isValidEan13(digitsOnly)) {
      jsFormat = 'EAN13';
    } else if (effectiveSymbology === 'EAN8' && isValidEan8(digitsOnly)) {
      jsFormat = 'EAN8';
    } else if (effectiveSymbology === 'ITF14' && isValidGtin14(digitsOnly)) {
      jsFormat = 'ITF14';
    }

    try {
      const code1d = digitsOnly.replace(/[^\x20-\x7E]/g, '') || '0000000000';
      JsBarcode(el, jsFormat === 'CODE128' ? code1d : digitsOnly, {
        format: jsFormat,
        displayValue,
        text: rawText.replace(/\x1D/g, '') || code1d,
        font: 'monospace',
        fontOptions: 'bold',
        fontSize,
        textMargin: 2,
        margin: 4,
        height,
        width,
        background: '#ffffff',
        lineColor: '#0f172a',
      });
      setFallbackText(null);
    } catch {
      // Fallback to Code128 if strict EAN checksum failed on custom vendor code
      try {
        JsBarcode(el, digitsOnly || '0000000000', {
          format: 'CODE128',
          displayValue,
          text: rawText.replace(/\x1D/g, '') || digitsOnly,
          font: 'monospace',
          fontOptions: 'bold',
          fontSize,
          textMargin: 2,
          margin: 4,
          height,
          width,
          background: '#ffffff',
          lineColor: '#0f172a',
        });
        setFallbackText(null);
      } catch {
        setFallbackText(rawText || safeValue);
      }
    }
  }, [safeValue, rawText, effectiveSymbology, height, width, fontSize, displayValue]);

  if (fallbackText) {
    return (
      <div className="rounded border border-slate-300 bg-white px-2 py-1 text-center font-mono text-xs font-bold text-slate-800" dir="ltr">
        {fallbackText}
      </div>
    );
  }

  if (svgMarkup) {
    return (
      <div
        className={`inline-flex items-center justify-center [&>svg]:max-h-20 [&>svg]:w-auto ${className}`}
        dangerouslySetInnerHTML={{ __html: svgMarkup }}
        aria-label={`2D Barcode ${safeValue}`}
      />
    );
  }

  return <svg ref={svgRef} className={className} aria-label={`Barcode ${safeValue}`} />;
};
