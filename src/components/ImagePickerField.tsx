import React from 'react';
import { Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
import { PRESET_PHOTOS, SYSTEM_LOGO_SRC, resolvePhotoSrc } from '../types';
import { validationError } from '../lib/errorPopup';

interface ImagePickerFieldProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  fallback?: string;
  allowClear?: boolean;
}

export const ImagePickerField: React.FC<ImagePickerFieldProps> = ({
  label,
  value,
  onChange,
  fallback = 'cap.png',
  allowClear = false,
}) => {
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      validationError(
        'نوع الملف المختار غير مدعوم. يرجى اختيار صورة بصيغة PNG أو JPG أو JPEG أو WebP فقط.',
        `رفع ${label}`,
        ['امتداد أو نوع الملف المرفوع لا يطابق الصيغ المصرح بها للصور.'],
        'اختر ملف صورة ينتهي بـ .png أو .jpg أو .webp.',
      );
      e.target.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      validationError(
        'حجم الصورة يتجاوز الحد الأقصى المسموح به (2 ميغابايت) لضمان سرعة التحميل والحفظ.',
        `رفع ${label}`,
        [`حجم الملف المرفوع هو ${(file.size / (1024 * 1024)).toFixed(2)} ميغابايت، والحد الأقصى 2 ميغابايت.`],
        'قم بتصغير حجم الصورة أو ضغطها ثم أعد اختيارها.',
      );
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        const img = new Image();
        img.onload = () => {
          if (img.naturalWidth < 24 || img.naturalHeight < 24) {
            validationError(
              'أبعاد الصورة صغيرة جداً (الحد الأدنى المسموح به 24×24 بكسل).',
              `رفع ${label}`,
              [`أبعاد الصورة المختارة هي ${img.naturalWidth}×${img.naturalHeight} بكسل.`],
              'اختر صورة أو شعاراً بدقة أعلى لا تقل عن 24×24 بكسل.',
            );
            return;
          }
          if (img.naturalWidth > 4096 || img.naturalHeight > 4096) {
            validationError(
              'أبعاد الصورة كبيرة جداً (الحد الأقصى المسموح به 4096×4096 بكسل).',
              `رفع ${label}`,
              [`أبعاد الصورة المختارة هي ${img.naturalWidth}×${img.naturalHeight} بكسل.`],
              'قلّل أبعاد الصورة إلى 4096×4096 بكسل أو أقل ثم أعد المحاولة.',
            );
            return;
          }
          onChange(dataUrl);
        };
        img.onerror = () => {
          validationError(
            'ملف الصورة غير صالح أو تالف ولا يمكن قراءته.',
            `رفع ${label}`,
            ['قد يكون الملف معطوباً أو تم تغيير امتداده يدوياً من صيغة أخرى.'],
            'جرّب صورة أخرى سليمة بصيغة PNG أو JPG أو WebP.',
          );
        };
        img.src = dataUrl;
      }
    };
    reader.onerror = () => {
      validationError(
        'تعذر قراءة ملف الصورة من الجهاز.',
        `رفع ${label}`,
        ['قد تكون صلاحية الوصول للملف مفقودة أو تم نقله من مكانه أثناء التحميل.'],
      );
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-700">{label}</label>
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-slate-300 bg-white p-0.5">
          {value ? (
            <img
              src={resolvePhotoSrc(value, fallback)}
              alt={label}
              className="h-full w-full rounded object-contain"
            />
          ) : allowClear ? (
            <img
              src={SYSTEM_LOGO_SRC}
              alt="شعار النظام الافتراضي"
              className="h-full w-full rounded object-contain p-0.5"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded bg-slate-50 text-[10px] font-medium text-slate-400">
              افتراضي
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <select
            value={value.startsWith('data:') ? '' : value}
            onChange={(e) => {
              onChange(e.target.value);
            }}
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-[#0B4F9C] focus:outline-none"
          >
            <option value="">-- الشعار الافتراضي / اختر صورة --</option>
            {PRESET_PHOTOS.map((p) => (
              <option key={p.file} value={p.file}>
                {p.label} ({p.file})
              </option>
            ))}
          </select>

          <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            <Upload className="h-4 w-4 text-[#0B4F9C]" />
            <span>رفع صورة</span>
            <input type="file" accept="image/png, image/jpeg, image/webp" onChange={handleFile} className="hidden" />
          </label>

          {allowClear && value && (
            <button
              type="button"
              onClick={() => {
                onChange('');
              }}
              className="inline-flex shrink-0 items-center gap-1 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
            >
              <Trash2 className="h-4 w-4" />
              <span>حذف الشعار</span>
            </button>
          )}
        </div>
      </div>
      {value.startsWith('data:') && (
        <p className="flex items-center gap-1 text-xs text-emerald-700">
          <ImageIcon className="h-3.5 w-3.5" />
          تم اختيار شعار/صورة من جهازك — اضغط "حفظ الإعدادات" لاعتماده في حساب الصيدلية
        </p>
      )}
    </div>
  );
};
