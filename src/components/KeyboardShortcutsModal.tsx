import React from 'react';
import { Keyboard, X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const shortcuts = [
    { key: 'Alt + 1', desc: 'الانتقال إلى لوحة التحكم والتنبيهات' },
    { key: 'Alt + 2', desc: 'الانتقال إلى نقطة البيع والكاشير (POS)' },
    { key: 'Alt + 3', desc: 'الانتقال إلى الأدوية والمخزون' },
    { key: 'Alt + 4', desc: 'الانتقال إلى المشتريات والموردين' },
    { key: 'Alt + 5', desc: 'الانتقال إلى العملاء والوصفات الطبية' },
    { key: 'Alt + 6', desc: 'الانتقال إلى الحسابات والصندوق' },
    { key: 'Alt + 7', desc: 'الانتقال إلى التقارير التحليلية' },
    { key: 'Alt + 8', desc: 'الانتقال إلى إضافة دواء جديد' },
    { key: 'F2', desc: 'الذهاب السريع لنقطة البيع وتركيز مؤشر الباركود' },
    { key: 'F4', desc: 'فتح نافذة إتمام الدفع والفاتورة (في نقطة البيع)' },
    { key: 'Alt + H أو Shift + ?', desc: 'فتح لوحة اختصارات لوحة المفاتيح' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-gray-900 text-right" dir="rtl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Keyboard className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">اختصارات لوحة المفاتيح السريعة</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-2.5 overflow-y-auto pr-1">
          {shortcuts.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-800/50"
            >
              <span className="text-sm font-medium text-slate-700 dark:text-gray-300">{item.desc}</span>
              <kbd className="rounded bg-white px-2.5 py-1 text-xs font-bold text-slate-800 shadow-sm border border-slate-200 dark:bg-gray-900 dark:border-gray-700 dark:text-sky-400">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-lg bg-primary-600 hover:bg-primary-700 px-5 py-2 text-sm font-medium text-white shadow transition"
          >
            حسناً، فهمت
          </button>
        </div>
      </div>
    </div>
  );
};
