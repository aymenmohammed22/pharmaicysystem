import React, { useState } from 'react';
import { usePWAInstall, useOnlineStatus } from '../utils/usePWAInstall';
import { Download, WifiOff, Smartphone } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const isOnline = useOnlineStatus();

  return (
    <>
      {!isOnline && (
        <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <WifiOff className="w-3.5 h-3.5 animate-pulse" />
          <span>غير متصل</span>
        </div>
      )}

      {isInstalled ? (
        <div className="flex items-center gap-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <Smartphone className="w-3.5 h-3.5" />
          <span>التطبيق مثبت</span>
        </div>
      ) : isInstallable ? (
        <button
          onClick={install}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white px-3 py-1.5 text-xs font-medium shadow-sm transition"
          title="تثبيت التطبيق على الهاتف أو الكمبيوتر للعمل بدون إنترنت ولقراءة الباركود"
        >
          <Download className="w-3.5 h-3.5" />
          <span>تثبيت التطبيق (PWA)</span>
        </button>
      ) : isIOS ? (
        <>
          <button
            onClick={() => setShowIOSGuide(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-200 px-3 py-1.5 text-xs font-medium shadow-sm transition"
          >
            <Download className="w-3.5 h-3.5" />
            <span>تثبيت على آيفون</span>
          </button>

          {showIOSGuide && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 text-right" dir="rtl">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">تثبيت التطبيق على آيفون / آيباد</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300 space-y-2 leading-relaxed">
                  1. اضغط على زر <strong>المشاركة (Share)</strong> في شريط متصفح سفاري.<br />
                  2. انزل لأسفل واضغط على <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.<br />
                  3. اضغط إضافة لتثبيت النظام كتطبيق مستقل على هاتفك.
                </p>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="mt-5 w-full rounded-lg bg-gray-100 hover:bg-gray-200 py-2 text-sm font-medium text-gray-800 dark:bg-gray-800 dark:text-gray-200"
                >
                  فهمت
                </button>
              </div>
            </div>
          )}
        </>
      ) : null}
    </>
  );
};
