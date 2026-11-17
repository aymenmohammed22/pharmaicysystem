import React, { useEffect, useState } from 'react';
import { AlertOctagon, AlertCircle, Lightbulb, X } from 'lucide-react';
import { closeErrorPopup, subscribeErrorPopup, type ErrorPopupPayload } from '../lib/errorPopup';

export const ErrorPopupModal: React.FC = () => {
  const [payload, setPayload] = useState<ErrorPopupPayload | null>(null);

  useEffect(() => {
    return subscribeErrorPopup(setPayload);
  }, []);

  useEffect(() => {
    if (!payload) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeErrorPopup();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [payload]);

  if (!payload) return null;

  return (
    <div
      dir="rtl"
      className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="erp-error-popup-title"
      aria-describedby="erp-error-popup-desc"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeErrorPopup();
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-red-200 bg-white shadow-2xl">
        {/* Top Danger Header */}
        <div className="flex items-center justify-between border-b border-red-800/20 bg-gradient-to-l from-red-700 to-red-600 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
              <AlertOctagon className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 id="erp-error-popup-title" className="text-base font-extrabold leading-snug">
                {payload.title}
              </h3>
              {payload.context && (
                <p className="mt-0.5 text-xs font-medium text-red-100">
                  العملية: {payload.context}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={closeErrorPopup}
            className="rounded-lg p-1.5 text-white/85 transition hover:bg-white/15 hover:text-white"
            aria-label="إغلاق رسالة الخطأ"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Body */}
        <div className="space-y-4 p-5 text-right">
          {/* Primary Error Message */}
          <div
            id="erp-error-popup-desc"
            className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold leading-relaxed text-red-900"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <span>{payload.message}</span>
          </div>

          {/* Root Causes */}
          {payload.causes.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="mb-2 text-xs font-extrabold text-slate-700">
                أسباب المشكلة والخطأ المحتملة:
              </div>
              <ul className="space-y-1.5 text-xs leading-relaxed text-slate-700">
                {payload.causes.map((cause, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                    <span>{cause}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested Action */}
          {payload.suggestion && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <span className="font-bold">طريقة الحل المقترحة: </span>
                <span>{payload.suggestion}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
            {payload.status && (
              <span className="ml-auto font-mono text-[11px] font-semibold text-slate-400" dir="ltr">
                HTTP {payload.status}
              </span>
            )}
            <button
              type="button"
              onClick={closeErrorPopup}
              className="rounded-xl bg-red-600 px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
            >
              فهمت، إغلاق النافذة
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
