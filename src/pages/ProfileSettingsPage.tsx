import React, { useEffect, useRef, useState } from 'react';
import {
  UserCircle,
  Settings,
  CheckCircle2,
  Building2,
  Coins,
  RefreshCw,
  Plus,
  Trash2,
  ArrowLeftRight,
  Database,
  Download,
  Upload,
  ShieldAlert,
  FileJson,
  History,
  ChevronDown,
  ChevronUp,
  Printer,
  RotateCcw,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type { AdditionalCurrency, CurrencyRateHistory, DatabaseBackupPayload, SiteSettings, User } from '../types';
import { CURRENCY_PRESETS, hasPermission, resolvePhotoSrc } from '../types';
import { ImagePickerField } from '../components/ImagePickerField';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  DEFAULT_TERMINAL_CONFIG,
  loadLocalTerminalConfig,
  saveLocalTerminalConfig,
  type LocalTerminalHardwareConfig,
  type TerminalPaperMode,
} from '../utils/localPrintService';

interface ProfileSettingsPageProps {
  mode: 'profile' | 'accountSetting';
  user: User;
  site: SiteSettings;
  onUserUpdated: (u: User) => void;
  onSiteUpdated: (s: SiteSettings, convertedPrices?: boolean) => Promise<void> | void;
  onDatabaseRestored?: (s: SiteSettings, u: User) => Promise<void> | void;
}

export const ProfileSettingsPage: React.FC<ProfileSettingsPageProps> = ({
  mode,
  user,
  site,
  onUserUpdated,
  onSiteUpdated,
  onDatabaseRestored,
}) => {
  // Profile state
  const [name, setName] = useState(user.name);
  const [number, setNumber] = useState(user.number);
  const [pic, setPic] = useState(user.pic || 'png.png');
  const [profileMsg, setProfileMsg] = useState('');

  // Account settings state
  const [email, setEmail] = useState(user.email);
  const [username, setUsername] = useState(user.username || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountMsg, setAccountMsg] = useState('');

  // Site & Currency settings state
  const [siteTitle, setSiteTitle] = useState(site.title);
  const [siteName, setSiteName] = useState(site.name);
  const [siteTradeName, setSiteTradeName] = useState(site.tradeName || '');
  const [siteLogo, setSiteLogo] = useState(site.logo || '');
  const [siteOwnerName, setSiteOwnerName] = useState(site.ownerName || '');
  const [siteOwnerEmail, setSiteOwnerEmail] = useState(site.ownerEmail || '');
  const [sitePhone, setSitePhone] = useState(site.phone || '');
  const [siteAddress, setSiteAddress] = useState(site.address || '');
  const [siteCity, setSiteCity] = useState(site.city || '');
  const [siteCountry, setSiteCountry] = useState(site.country || 'السعودية');
  const [siteTaxNumber, setSiteTaxNumber] = useState(site.taxNumber || '');
  const [siteLicenseNumber, setSiteLicenseNumber] = useState(site.licenseNumber || '');
  const [siteNotes, setSiteNotes] = useState(site.notes || '');
  const [currencyCode, setCurrencyCode] = useState(site.currencyCode);
  const [currencySymbol, setCurrencySymbol] = useState(site.currencySymbol);
  const [currencyName, setCurrencyName] = useState(site.currencyName);
  const [currencyDecimals, setCurrencyDecimals] = useState<number>(site.currencyDecimals ?? 2);
  const [salesCurrencyCode, setSalesCurrencyCode] = useState(site.salesCurrencyCode || site.defaultDisplayCurrency || site.currencyCode);
  const [purchasesCurrencyCode, setPurchasesCurrencyCode] = useState(site.purchasesCurrencyCode || site.currencyCode);
  const [additionalCurrencies, setAdditionalCurrencies] = useState<AdditionalCurrency[]>(
    site.additionalCurrencies || [],
  );
  const [autoConvertCurrencies, setAutoConvertCurrencies] = useState(Boolean(site.autoConvertCurrencies));
  const [defaultDisplayCurrency, setDefaultDisplayCurrency] = useState(
    site.defaultDisplayCurrency || site.currencyCode,
  );
  const [convertPrices, setConvertPrices] = useState(false);
  const [exchangeMultiplier, setExchangeMultiplier] = useState('1');
  const [newCurrCode, setNewCurrCode] = useState('');
  const [newCurrSymbol, setNewCurrSymbol] = useState('');
  const [newCurrName, setNewCurrName] = useState('');
  const [newCurrRate, setNewCurrRate] = useState('1');
  const [rateHistory, setRateHistory] = useState<CurrencyRateHistory[]>([]);
  const [showRateHistory, setShowRateHistory] = useState(false);
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteMsg, setSiteMsg] = useState('');

  // Database Backup (JSON Export / Import) state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [exportingDb, setExportingDb] = useState(false);
  const [importingDb, setImportingDb] = useState(false);
  const [dbMsg, setDbMsg] = useState('');
  const [pendingBackup, setPendingBackup] = useState<DatabaseBackupPayload | null>(null);
  const [pendingFileName, setPendingFileName] = useState('');
  const [confirmImportOpen, setConfirmImportOpen] = useState(false);

  // Local Terminal Hardware Preferences (per-device localStorage, Stage 9)
  const [terminalCfg, setTerminalCfg] = useState<LocalTerminalHardwareConfig>(() => loadLocalTerminalConfig());
  const [terminalMsg, setTerminalMsg] = useState('');

  const loadRateHistory = async () => {
    try {
      const res = await api.getCurrencySettings();
      setRateHistory(res.rateHistory || []);
    } catch {
      // Ignore if endpoint is inaccessible
    }
  };

  useEffect(() => {
    setSiteTitle(site.title);
    setSiteName(site.name);
    setSiteTradeName(site.tradeName || '');
    setSiteLogo(site.logo || '');
    setSiteOwnerName(site.ownerName || '');
    setSiteOwnerEmail(site.ownerEmail || '');
    setSitePhone(site.phone || '');
    setSiteAddress(site.address || '');
    setSiteCity(site.city || '');
    setSiteCountry(site.country || 'السعودية');
    setSiteTaxNumber(site.taxNumber || '');
    setSiteLicenseNumber(site.licenseNumber || '');
    setSiteNotes(site.notes || '');
    setCurrencyCode(site.currencyCode);
    setCurrencySymbol(site.currencySymbol);
    setCurrencyName(site.currencyName);
    setCurrencyDecimals(site.currencyDecimals ?? 2);
    setSalesCurrencyCode(site.salesCurrencyCode || site.defaultDisplayCurrency || site.currencyCode);
    setPurchasesCurrencyCode(site.purchasesCurrencyCode || site.currencyCode);
    setAdditionalCurrencies(site.additionalCurrencies || []);
    setAutoConvertCurrencies(Boolean(site.autoConvertCurrencies));
    setDefaultDisplayCurrency(site.defaultDisplayCurrency || site.currencyCode);
  }, [site]);

  useEffect(() => {
    if (mode === 'accountSetting' && hasPermission(user, 'manageSiteSettings')) {
      void loadRateHistory();
    }
  }, [mode, user]);

  const canManageSite = hasPermission(user, 'manageSiteSettings');

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg('');
    if (!name.trim()) {
      validationError(
        'الاسم الشخصي مطلوب ولا يمكن تركه فارغاً',
        'تحديث الملف الشخصي',
        ['لم يتم كتابة الاسم الكامل في خانة الاسم.'],
        'أدخل اسمك ثم اضغط حفظ التعديلات.',
      );
      return;
    }
    try {
      const res = await api.updateProfile({ name: name.trim(), number: number.trim(), pic });
      onUserUpdated(res.user);
      setProfileMsg('تم تحديث الملف الشخصي بنجاح');
    } catch (err) {
      showErrorPopup(err, 'تحديث الملف الشخصي');
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccountMsg('');
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      validationError(
        'يرجى إدخال بريد إلكتروني صحيح',
        'تحديث بيانات الحساب وكلمة المرور',
        ['البريد الإلكتروني فارغ أو لا يحتوي على صيغة بريد صالحة.'],
        'أدخل بريداً إلكترونياً سليماً مثل admin@pharmacy.com.',
      );
      return;
    }
    if (newPassword.trim()) {
      if (!currentPassword.trim()) {
        validationError(
          'يرجى إدخال كلمة المرور الحالية لتأكيد تغيير كلمة المرور',
          'تحديث بيانات الحساب وكلمة المرور',
          ['أدخلت كلمة مرور جديدة دون إدخال كلمة المرور الحالية للتحقق الأمني.'],
          'اكتب كلمة المرور الحالية أولاً ثم الجديدة.',
        );
        return;
      }
      if (newPassword.trim().length < 4) {
        validationError(
          'كلمة المرور الجديدة يجب أن لا تقل عن 4 أحرف أو أرقام',
          'تحديث بيانات الحساب وكلمة المرور',
          ['طول كلمة المرور الجديدة أقل من الحد الأدنى المسموح.'],
          'استخدم كلمة مرور من 4 خانات فأكثر.',
        );
        return;
      }
    }
    try {
      const res = await api.updateAccount({
        email: email.trim(),
        username: username.trim() || undefined,
        currentPassword: currentPassword || undefined,
        newPassword: newPassword || undefined,
      });
      onUserUpdated(res.user);
      setCurrentPassword('');
      setNewPassword('');
      setAccountMsg('تم تحديث بيانات الحساب وكلمة المرور بنجاح');
    } catch (err) {
      showErrorPopup(err, 'تحديث بيانات الحساب وكلمة المرور');
    }
  };

  const suggestRateForBase = (targetPresetCode: string): number => {
    const basePreset = CURRENCY_PRESETS.find((p) => p.code === currencyCode);
    const targetPreset = CURRENCY_PRESETS.find((p) => p.code === targetPresetCode);
    if (basePreset?.suggestedRateFromSar && targetPreset?.suggestedRateFromSar) {
      return Number((targetPreset.suggestedRateFromSar / basePreset.suggestedRateFromSar).toFixed(4));
    }
    return targetPreset?.suggestedRateFromSar || 1;
  };

  const handleAddPresetCurrency = (preset: (typeof CURRENCY_PRESETS)[number]) => {
    if (preset.code === currencyCode || additionalCurrencies.some((c) => c.code === preset.code)) return;
    setAdditionalCurrencies((prev) => [
      ...prev,
      {
        code: preset.code,
        symbol: preset.symbol,
        name: preset.name,
        rateToBase: suggestRateForBase(preset.code),
        enabled: true,
      },
    ]);
  };

  const handleAddCustomCurrency = () => {
    const code = newCurrCode.trim().toUpperCase();
    const symbol = newCurrSymbol.trim();
    const cName = newCurrName.trim();
    const rate = Number(newCurrRate);
    if (!code || !symbol || !cName) {
      validationError(
        'يرجى إدخال اسم العملة الإضافية ورمزها واختصارها الدولي',
        'إضافة عملة إضافية',
        ['واحد أو أكثر من حقول (اسم العملة، رمز العرض، الاختصار الدولي) غير مكتمل.'],
        'أكمل الحقول الثلاثة ثم اضغط إضافة عملة.',
      );
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      validationError(
        'سعر الصرف مقابل العملة الأساسية يجب أن يكون رقماً موجباً أكبر من الصفر',
        'إضافة عملة إضافية',
        ['قيمة سعر الصرف المدخلة تساوي صفراً أو سالبة أو غير رقمية.'],
        'أدخل معامل تحويل موجباً أكبر من الصفر.',
      );
      return;
    }
    if (code === currencyCode || additionalCurrencies.some((c) => c.code === code)) {
      validationError(
        `العملة ${code} موجودة بالفعل ضمن العملة الأساسية أو الإضافية`,
        'إضافة عملة إضافية',
        ['كود العملة المدخل مطابق للعملة الأساسية الحالية أو عملة مضافة مسبقاً.'],
        'اختر كود ISO مختلفاً أو عدّل العملة الموجودة في الجدول.',
      );
      return;
    }
    setAdditionalCurrencies((prev) => [
      ...prev,
      { code, symbol, name: cName, rateToBase: Number(rate.toFixed(6)), enabled: true },
    ]);
    setNewCurrCode('');
    setNewCurrSymbol('');
    setNewCurrName('');
    setNewCurrRate('1');
  };

  const handleSaveSite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSiteMsg('');
    if (!siteTitle.trim() || !siteName.trim()) {
      validationError(
        'عنوان النظام واسم الصيدلية مطلوبان',
        'حفظ إعدادات الصيدلية والعملات',
        ['تم مسح اسم الصيدلية أو عنوان النظام الرئيسي.'],
        'أدخل عنوان النظام واسم الصيدلية ثم أعد الحفظ.',
      );
      return;
    }
    if (!currencyName.trim() || !currencySymbol.trim() || !currencyCode.trim()) {
      validationError(
        'بيانات العملة الأساسية (الاسم، الرمز، والاختصار) مطلوبة',
        'حفظ إعدادات الصيدلية والعملات',
        ['أحد حقول العملة الأساسية فارغ.'],
        'أكمل اسم العملة ورمزها واختصارها الدولي أو اختر من الأزرار السريعة.',
      );
      return;
    }
    const mult = Number(exchangeMultiplier);
    if (convertPrices && (!Number.isFinite(mult) || mult <= 0)) {
      validationError(
        'معامل التحويل يجب أن يكون رقماً موجباً أكبر من الصفر',
        'حفظ إعدادات الصيدلية والعملات',
        ['خيار تحويل أسعار المخزون مفعّل لكن المعامل غير صالح أو أقل من/يساوي صفر.'],
        'أدخل معامل تحويل موجباً صحيحاً مثل 0.27 أو 3.75.',
      );
      return;
    }
    setSiteSaving(true);
    try {
      const res = await api.updateSite({
        title: siteTitle.trim(),
        name: siteName.trim(),
        tradeName: siteTradeName,
        logo: siteLogo,
        ownerName: siteOwnerName,
        ownerEmail: siteOwnerEmail,
        phone: sitePhone,
        address: siteAddress,
        city: siteCity,
        country: siteCountry,
        taxNumber: siteTaxNumber,
        licenseNumber: siteLicenseNumber,
        notes: siteNotes,
        currencyCode: currencyCode.trim().toUpperCase(),
        currencySymbol: currencySymbol.trim(),
        currencyName: currencyName.trim(),
        currencyDecimals,
        salesCurrencyCode,
        purchasesCurrencyCode,
        additionalCurrencies,
        autoConvertCurrencies,
        defaultDisplayCurrency,
        convertPrices,
        exchangeMultiplier: convertPrices ? mult : 1,
      });
      await onSiteUpdated(res.site, res.convertedPrices);
      void loadRateHistory();
      setConvertPrices(false);
      setExchangeMultiplier('1');
      setSiteMsg(
        res.convertedPrices
          ? 'تم تجديد العملة وتحويل أسعار المخزون والعملات الإضافية مع حماية القيود التاريخية بنجاح'
          : 'تم حفظ إعدادات الهوية البصرية والعملات والتحويل التلقائي بنجاح',
      );
    } catch (err) {
      showErrorPopup(err, 'حفظ إعدادات الصيدلية والعملات');
    } finally {
      setSiteSaving(false);
    }
  };

  const handleExportDatabase = async () => {
    setDbMsg('');
    setExportingDb(true);
    try {
      const backup = await api.exportDatabase();
      const jsonText = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      const a = document.createElement('a');
      a.href = url;
      a.download = `pharmacy-database-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setDbMsg(
        `تم تصدير النسخة الاحتياطية الكاملة بنجاح (${backup.tableCount || Object.keys(backup.tables).length} جدول، ${backup.totalRows || 0} سجل).`,
      );
    } catch (err) {
      showErrorPopup(err, 'تصدير النسخة الاحتياطية الكاملة (JSON)');
    } finally {
      setExportingDb(false);
    }
  };

  const handleSelectBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setDbMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as DatabaseBackupPayload;
      if (!parsed || typeof parsed !== 'object' || !parsed.tables || typeof parsed.tables !== 'object') {
        throw new Error('بنية ملف JSON غير صالحة: لا يحتوي على كائن tables');
      }
      if (!Array.isArray(parsed.tables.site) || !Array.isArray(parsed.tables.users)) {
        throw new Error('ملف النسخة الاحتياطية ناقص (يفتقر إلى جداول النظام الأساسية site/users)');
      }
      setPendingBackup(parsed);
      setPendingFileName(file.name);
    } catch (err) {
      setPendingBackup(null);
      setPendingFileName('');
      showErrorPopup(err, 'قراءة وفحص ملف النسخة الاحتياطية (JSON)');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleConfirmImportDatabase = async () => {
    if (!pendingBackup) return;
    setDbMsg('');
    setImportingDb(true);
    try {
      const res = await api.importDatabase(pendingBackup);
      setConfirmImportOpen(false);
      setPendingBackup(null);
      setPendingFileName('');
      if (onDatabaseRestored) {
        await onDatabaseRestored(res.site, res.user);
      } else {
        await onSiteUpdated(res.site, true);
        onUserUpdated(res.user);
      }
      setDbMsg(
        `تمت استعادة قاعدة البيانات بالكامل بنجاح (${res.restoredTables} جدول، ${res.restoredRows} سجل) وتم تحديث بيانات النظام.`,
      );
    } catch (err) {
      setConfirmImportOpen(false);
      showErrorPopup(err, 'استيراد واستعادة قاعدة البيانات');
    } finally {
      setImportingDb(false);
    }
  };

  const multPreview = Number(exchangeMultiplier) || 1;
  const selectableDisplayCurrencies = [
    { code: currencyCode, name: currencyName, symbol: currencySymbol },
    ...additionalCurrencies.filter((c) => c.enabled && c.code !== currencyCode),
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {mode === 'profile' ? (
        <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
            <UserCircle className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">الملف الشخصي</h1>
          </div>
          <form onSubmit={handleSaveProfile} noValidate className="space-y-4 p-5">
            <div className="flex items-center gap-4 rounded bg-[#F3F6FA] p-4">
              <img
                src={resolvePhotoSrc(pic, 'png.png')}
                alt={name}
                className="h-16 w-16 rounded-full border-2 border-[#0B4F9C] bg-white object-cover"
              />
              <div>
                <div className="text-base font-bold text-slate-800">{user.name}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600" dir="ltr">
                  <span>{user.email}</span>
                  {user.username && <span className="font-mono font-semibold text-sky-700">@{user.username}</span>}
                  <span className="rounded bg-white px-1.5 py-0.5 font-mono font-bold text-slate-700 border border-slate-200">
                    ID #{user.id}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  تاريخ التسجيل: <span dir="ltr">{user.date}</span>
                </div>
              </div>
            </div>

            {profileMsg && (
              <div className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4" />
                <span>{profileMsg}</span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">الاسم</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">رقم الهاتف</label>
                <input
                  type="text"
                  dir="ltr"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                />
              </div>
            </div>

            <ImagePickerField label="تغيير الصورة الشخصية" value={pic} onChange={setPic} fallback="png.png" />

            <div className="flex justify-end border-t border-slate-200 pt-3">
              <button
                type="submit"
                className="rounded bg-[#0B4F9C] px-5 py-2 text-sm font-bold text-white hover:bg-[#083D7A]"
              >
                حفظ التعديلات
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* Account Settings */}
          <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
              <Settings className="h-5 w-5 text-[#0B4F9C]" />
              <h1 className="text-lg font-bold text-slate-800">إعدادات الحساب وكلمة المرور</h1>
            </div>
            <form onSubmit={handleSaveAccount} noValidate className="space-y-4 p-5">
              {accountMsg && (
                <div className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{accountMsg}</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">البريد الإلكتروني</label>
                  <input
                    type="email"
                    required
                    dir="ltr"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    اسم المستخدم (رقم المستخدم: <span className="font-mono">#{user.id}</span>)
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">
                    كلمة المرور الحالية (عند تغيير كلمة المرور)
                  </label>
                  <input
                    type="password"
                    dir="ltr"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">كلمة المرور الجديدة</label>
                  <input
                    type="password"
                    dir="ltr"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
              </div>
              <div className="flex justify-end border-t border-slate-200 pt-3">
                <button
                  type="submit"
                  className="rounded bg-[#0B4F9C] px-5 py-2 text-sm font-bold text-white hover:bg-[#083D7A]"
                >
                  تحديث الحساب
                </button>
              </div>
            </form>
          </div>

          {/* Site & Multi-Currency Settings */}
          {canManageSite && (
            <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
                <Building2 className="h-5 w-5 text-[#0B4F9C]" />
                <h2 className="text-lg font-bold text-slate-800">
                  إعدادات الصيدلية والعملات والتحويل التلقائي
                </h2>
              </div>
              <form onSubmit={handleSaveSite} noValidate className="space-y-5 p-5">
                {siteMsg && (
                  <div className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>{siteMsg}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">عنوان النظام</label>
                    <input
                      type="text"
                      required
                      value={siteTitle}
                      onChange={(e) => setSiteTitle(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-slate-700">اسم الصيدلية</label>
                    <input
                      type="text"
                      required
                      value={siteName}
                      onChange={(e) => setSiteName(e.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <ImagePickerField label="شعار الصيدلية الرئيسي (Logo)" value={siteLogo} onChange={setSiteLogo} fallback="cap.png" allowClear />

                {/* Pharmacy Metadata & Branding Details */}
                <div className="space-y-3 rounded border border-slate-200 bg-slate-50/70 p-4">
                  <div className="border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                    الهوية البصرية وبيانات الصيدلية (Pharmacy Branding)
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">الاسم التجاري</label>
                      <input
                        type="text"
                        value={siteTradeName}
                        onChange={(e) => setSiteTradeName(e.target.value)}
                        placeholder="الاسم التجاري المعتمد..."
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">اسم المالك</label>
                      <input
                        type="text"
                        value={siteOwnerName}
                        onChange={(e) => setSiteOwnerName(e.target.value)}
                        placeholder="د. ..."
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">هاتف الصيدلية</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={sitePhone}
                        onChange={(e) => setSitePhone(e.target.value)}
                        placeholder="+9665..."
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">البريد الإلكتروني للصيدلية</label>
                      <input
                        type="email"
                        dir="ltr"
                        value={siteOwnerEmail}
                        onChange={(e) => setSiteOwnerEmail(e.target.value)}
                        placeholder="info@pharmacy.com"
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">الرقم الضريبي</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={siteTaxNumber}
                        onChange={(e) => setSiteTaxNumber(e.target.value)}
                        placeholder="310..."
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">رقم الترخيص</label>
                      <input
                        type="text"
                        dir="ltr"
                        value={siteLicenseNumber}
                        onChange={(e) => setSiteLicenseNumber(e.target.value)}
                        placeholder="LIC-..."
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">العنوان التفصيلي</label>
                      <input
                        type="text"
                        value={siteAddress}
                        onChange={(e) => setSiteAddress(e.target.value)}
                        placeholder="الحي - الشارع"
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">المدينة</label>
                      <input
                        type="text"
                        value={siteCity}
                        onChange={(e) => setSiteCity(e.target.value)}
                        placeholder="الرياض / صنعاء / القاهرة..."
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">الدولة</label>
                      <input
                        type="text"
                        value={siteCountry}
                        onChange={(e) => setSiteCountry(e.target.value)}
                        placeholder="السعودية"
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">وصف مختصر للصيدلية</label>
                    <input
                      type="text"
                      value={siteNotes}
                      onChange={(e) => setSiteNotes(e.target.value)}
                      placeholder="وصف أو ملاحظات تظهر على المطبوعات..."
                      className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                    />
                  </div>
                </div>

                {/* Base Currency Section */}
                <div className="space-y-3 rounded border border-sky-200 bg-[#F3F6FA] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <Coins className="h-4 w-4 text-[#145632]" />
                      <span>العملة الأساسية المعتمدة للنظام والمحاسبة</span>
                    </div>
                    <span className="rounded bg-white px-2.5 py-0.5 text-xs font-bold text-[#145632] shadow-xs">
                      الأساسية: {site.currencyName} ({site.currencySymbol} / {site.currencyCode})
                    </span>
                  </div>

                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-slate-600">اختيار سريع للعملة الأساسية:</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CURRENCY_PRESETS.slice(0, 10).map((preset) => {
                        const selected = currencyCode === preset.code && currencySymbol === preset.symbol;
                        return (
                          <button
                            key={preset.code}
                            type="button"
                            onClick={() => {
                              setCurrencyCode(preset.code);
                              setCurrencySymbol(preset.symbol);
                              setCurrencyName(preset.name);
                            }}
                            className={`rounded border px-2.5 py-1 text-xs font-semibold transition ${
                              selected
                                ? 'border-[#145632] bg-[#145632] text-white'
                                : 'border-slate-300 bg-white text-slate-700 hover:border-[#0B4F9C]'
                            }`}
                          >
                            {preset.name} ({preset.symbol})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">اسم العملة الأساسية</label>
                      <input
                        type="text"
                        required
                        value={currencyName}
                        onChange={(e) => setCurrencyName(e.target.value)}
                        placeholder="ريال سعودي"
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">رمز العرض</label>
                      <input
                        type="text"
                        required
                        value={currencySymbol}
                        onChange={(e) => setCurrencySymbol(e.target.value)}
                        placeholder="ر.س"
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">الاختصار الدولي</label>
                      <input
                        type="text"
                        required
                        dir="ltr"
                        value={currencyCode}
                        onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                        placeholder="SAR"
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm uppercase"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">عدد المنازل العشرية</label>
                      <select
                        value={currencyDecimals}
                        onChange={(e) => setCurrencyDecimals(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                      >
                        <option value={0}>0 (بدون كسور)</option>
                        <option value={2}>2 (0.00 - قياسي)</option>
                        <option value={3}>3 (0.000 - دينار)</option>
                        <option value={4}>4 (0.0000 - دقيق)</option>
                      </select>
                    </div>
                  </div>

                  <div className="rounded border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                    <strong>حماية الأرصدة التاريخية:</strong> تغيير العملة الأساسية أو معامل التسعير يحدّث تسعير المخزون النشط فقط ولا يغيّر قيم الفواتير أو القيود المحاسبية التاريخية المسجلة مسبقاً.
                  </div>

                  {/* Optional Exchange Multiplier on Renew */}
                  <div className="rounded border border-slate-200 bg-white p-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-800">
                      <input
                        type="checkbox"
                        checked={convertPrices}
                        onChange={(e) => setConvertPrices(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-[#145632]"
                      />
                      <RefreshCw className="h-4 w-4 text-[#0B4F9C]" />
                      <span>تحديث وتحويل أسعار المخزون الحالية عند تغيير العملة الأساسية</span>
                    </label>
                    {convertPrices && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-3 pr-6">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">
                            معامل التحويل (الضرب في):
                          </label>
                          <input
                            type="number"
                            step="0.0001"
                            min="0.0001"
                            required={convertPrices}
                            dir="ltr"
                            value={exchangeMultiplier}
                            onChange={(e) => setExchangeMultiplier(e.target.value)}
                            className="w-36 rounded border border-slate-300 px-3 py-1.5 text-left text-sm"
                          />
                        </div>
                        <div className="text-xs text-slate-600">
                          مثال: دواء سعره <span className="font-bold">10.00</span> سيصبح{' '}
                          <span className="font-bold text-emerald-700">
                            {(10 * multPreview).toFixed(2)} {currencySymbol}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Additional Currencies & Exchange Rates */}
                <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 pb-2">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                      <ArrowLeftRight className="h-4 w-4 text-indigo-700" />
                      <span>العملات الإضافية المعتمدة في الفواتير والتقارير</span>
                    </div>
                    <span className="text-xs font-semibold text-indigo-800">
                      ({additionalCurrencies.filter((c) => c.enabled).length} عملة إضافية مفعّلة)
                    </span>
                  </div>

                  <div>
                    <div className="mb-1.5 text-xs font-semibold text-slate-600">
                      إضافة سريعة لعملة إضافية (مع احتساب سعر الصرف التقديري مقابل {currencySymbol}):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CURRENCY_PRESETS.filter(
                        (p) => p.code !== currencyCode && !additionalCurrencies.some((c) => c.code === p.code),
                      ).map((preset) => (
                        <button
                          key={preset.code}
                          type="button"
                          onClick={() => handleAddPresetCurrency(preset)}
                          className="inline-flex items-center gap-1 rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-800 hover:bg-indigo-100"
                        >
                          <Plus className="h-3 w-3" />
                          <span>
                            {preset.name} ({preset.symbol})
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {additionalCurrencies.length > 0 && (
                    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                      <table className="w-full border-collapse text-right text-xs">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr>
                            <th className="border-b px-3 py-2">تفعيل</th>
                            <th className="border-b px-3 py-2">العملة والاختصار</th>
                            <th className="border-b px-3 py-2">الرمز</th>
                            <th className="border-b px-3 py-2">
                              سعر الصرف (1 {currencySymbol} يساوي كم من العملة)
                            </th>
                            <th className="border-b px-3 py-2">معاينة التحويل</th>
                            <th className="border-b px-3 py-2">حذف</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {additionalCurrencies.map((curr, idx) => (
                            <tr key={curr.code}>
                              <td className="px-3 py-2">
                                <input
                                  type="checkbox"
                                  checked={curr.enabled}
                                  onChange={(e) =>
                                    setAdditionalCurrencies((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, enabled: e.target.checked } : c)),
                                    )
                                  }
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                              </td>
                              <td className="px-3 py-2 font-bold text-slate-800">
                                {curr.name}{' '}
                                <span className="font-mono text-[11px] text-slate-500">({curr.code})</span>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={curr.symbol}
                                  onChange={(e) =>
                                    setAdditionalCurrencies((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, symbol: e.target.value } : c)),
                                    )
                                  }
                                  className="w-16 rounded border border-slate-300 px-2 py-1 text-center font-semibold"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="number"
                                  step="0.000001"
                                  min="0.000001"
                                  dir="ltr"
                                  value={curr.rateToBase}
                                  onChange={(e) => {
                                    const val = Math.max(0.000001, Number(e.target.value) || 0.000001);
                                    setAdditionalCurrencies((prev) =>
                                      prev.map((c, i) => (i === idx ? { ...c, rateToBase: val } : c)),
                                    );
                                  }}
                                  className="w-28 rounded border border-slate-300 px-2 py-1 text-left font-mono"
                                />
                              </td>
                              <td className="px-3 py-2 text-emerald-700 font-semibold">
                                100 {currencySymbol} = {(100 * curr.rateToBase).toFixed(2)} {curr.symbol}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAdditionalCurrencies((prev) => prev.filter((_, i) => i !== idx));
                                    if (defaultDisplayCurrency === curr.code) {
                                      setDefaultDisplayCurrency(currencyCode);
                                    }
                                  }}
                                  className="rounded bg-red-600 p-1 text-white hover:bg-red-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add Custom Currency Inline */}
                  <div className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-white p-2.5 sm:grid-cols-5">
                    <input
                      type="text"
                      value={newCurrName}
                      onChange={(e) => setNewCurrName(e.target.value)}
                      placeholder="اسم العملة (مثال: دينار)"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                    <input
                      type="text"
                      value={newCurrSymbol}
                      onChange={(e) => setNewCurrSymbol(e.target.value)}
                      placeholder="الرمز (د.ل)"
                      className="rounded border border-slate-300 px-2 py-1 text-xs"
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={newCurrCode}
                      onChange={(e) => setNewCurrCode(e.target.value.toUpperCase())}
                      placeholder="الكود (LYD)"
                      className="rounded border border-slate-300 px-2 py-1 text-left text-xs uppercase"
                    />
                    <input
                      type="number"
                      step="0.000001"
                      min="0.000001"
                      dir="ltr"
                      value={newCurrRate}
                      onChange={(e) => setNewCurrRate(e.target.value)}
                      placeholder="سعر الصرف"
                      className="rounded border border-slate-300 px-2 py-1 text-left text-xs"
                    />
                    <button
                      type="button"
                      onClick={handleAddCustomCurrency}
                      className="inline-flex items-center justify-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة عملة</span>
                    </button>
                  </div>

                  {/* Auto-Conversion Toggle & Default Display Currency */}
                  {/* Auto-Conversion Toggle & Default Currencies for Sales & Purchases */}
                  <div className="rounded border border-emerald-200 bg-white p-3 space-y-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
                      <input
                        type="checkbox"
                        checked={autoConvertCurrencies}
                        onChange={(e) => setAutoConvertCurrencies(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-[#145632]"
                      />
                      <ArrowLeftRight className="h-4 w-4 text-emerald-700" />
                      <span>تفعيل ميزة تحويل العملات التلقائي في الفواتير والتقارير</span>
                    </label>
                    <p className="pr-6 text-xs text-slate-600">
                      عند التفعيل، يتم عرض وتحويل أسعار الفواتير ونقطة البيع وملخصات التقارير المالية تلقائياً إلى العملة الافتراضية المحددة أدناه مع حفظ القيمة الأساسية في الدفاتر المحاسبية.
                    </p>
                    <div className="grid grid-cols-1 gap-3 pr-6 sm:grid-cols-3">
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">
                          عملة العرض الافتراضية بالتقارير:
                        </label>
                        <select
                          value={defaultDisplayCurrency}
                          onChange={(e) => setDefaultDisplayCurrency(e.target.value)}
                          className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                        >
                          {selectableDisplayCurrencies.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name} ({c.symbol} / {c.code})
                              {c.code === currencyCode ? ' — الأساسية' : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">
                          العملة الافتراضية للمبيعات (POS):
                        </label>
                        <select
                          value={salesCurrencyCode}
                          onChange={(e) => setSalesCurrencyCode(e.target.value)}
                          className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                        >
                          {selectableDisplayCurrencies.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name} ({c.symbol} / {c.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-bold text-slate-700">
                          العملة الافتراضية للمشتريات:
                        </label>
                        <select
                          value={purchasesCurrencyCode}
                          onChange={(e) => setPurchasesCurrencyCode(e.target.value)}
                          className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800"
                        >
                          {selectableDisplayCurrencies.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.name} ({c.symbol} / {c.code})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Exchange Rate History */}
                  <div className="rounded border border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setShowRateHistory((v) => !v)}
                      className="flex w-full items-center justify-between px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <span className="flex items-center gap-1.5">
                        <History className="h-4 w-4 text-indigo-600" />
                        <span>سجل تاريخ أسعار الصرف ({rateHistory.length})</span>
                      </span>
                      {showRateHistory ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {showRateHistory && (
                      <div className="max-h-48 overflow-y-auto border-t border-slate-200">
                        {rateHistory.length === 0 ? (
                          <div className="p-3 text-center text-xs text-slate-500">
                            لا توجد تعديلات مسجلة على أسعار الصرف حتى الآن.
                          </div>
                        ) : (
                          <table className="w-full text-right text-xs">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-3 py-1.5">العملة</th>
                                <th className="px-3 py-1.5">السعر السابق</th>
                                <th className="px-3 py-1.5">السعر الجديد</th>
                                <th className="px-3 py-1.5">بواسطة</th>
                                <th className="px-3 py-1.5">التاريخ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {rateHistory.map((h) => (
                                <tr key={h.id}>
                                  <td className="px-3 py-1.5 font-semibold">
                                    {h.currency_name || h.currency_code} ({h.currency_code})
                                  </td>
                                  <td className="px-3 py-1.5 font-mono" dir="ltr">
                                    {h.old_rate}
                                  </td>
                                  <td className="px-3 py-1.5 font-mono font-bold text-emerald-700" dir="ltr">
                                    {h.new_rate}
                                  </td>
                                  <td className="px-3 py-1.5">{h.changed_by_name}</td>
                                  <td className="px-3 py-1.5 font-mono text-slate-500" dir="ltr">
                                    {String(h.created_at || '').slice(0, 16).replace('T', ' ')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end border-t border-slate-200 pt-3">
                  <button
                    type="submit"
                    disabled={siteSaving}
                    className="rounded bg-[#145632] px-5 py-2 text-sm font-bold text-white hover:bg-[#0f4126] disabled:opacity-60"
                  >
                    {siteSaving ? 'جاري الحفظ...' : 'حفظ الإعدادات وتحديث العملات'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Local Terminal Hardware Settings (Per-Device Hierarchy Tier 6 — separate from cloud SiteSettings) */}
          <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
              <div className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-[#0B4F9C]" />
                <div>
                  <h2 className="text-lg font-bold text-slate-800">إعدادات الطرفية المحلية (الأجهزة والطابعات لهذا الجهاز)</h2>
                  <p className="text-[11px] text-slate-600">
                    تُحفظ هذه الإعدادات محلياً على هذا المتصفح/جهاز الكاشير فقط ولا تؤثر على بقية أجهزة الفروع أو السحابة
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  const fresh = { ...DEFAULT_TERMINAL_CONFIG };
                  setTerminalCfg(fresh);
                  saveLocalTerminalConfig(fresh);
                  setTerminalMsg('تمت استعادة الإعدادات الافتراضية لهذه الطرفية بنجاح');
                }}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>الوضع الافتراضي</span>
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                saveLocalTerminalConfig({
                  ...terminalCfg,
                  terminalId: terminalCfg.terminalId.trim() || 'POS-01',
                });
                setTerminalMsg('تم حفظ تفضيلات الطرفية المحلية والأجهزة بنجاح');
              }}
              className="space-y-4 p-5"
            >
              {terminalMsg && (
                <div className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span>{terminalMsg}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">معرف المحطة / الكاشير (Terminal ID)</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={terminalCfg.terminalId}
                    onChange={(e) => setTerminalCfg({ ...terminalCfg, terminalId: e.target.value })}
                    placeholder="POS-01"
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-left font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">وضع الورق الافتراضي للفواتير</label>
                  <select
                    value={terminalCfg.defaultPaperMode}
                    onChange={(e) =>
                      setTerminalCfg({ ...terminalCfg, defaultPaperMode: e.target.value as TerminalPaperMode })
                    }
                    className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="a4">تقرير / فاتورة A4 القياسية (PDF)</option>
                    <option value="receipt80">طابعة حرارية 80mm (POS)</option>
                    <option value="receipt58">طابعة حرارية مصغرة 58mm</option>
                    <option value="label">طابعة ملصقات باركود (Thermal Label)</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">عنوان جسر الطباعة المحلي (Print Bridge)</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={terminalCfg.bridgeUrl}
                    onChange={(e) => setTerminalCfg({ ...terminalCfg, bridgeUrl: e.target.value })}
                    placeholder="http://127.0.0.1:9191"
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-left font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الهامش العلوي للطباعة (mm)</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={terminalCfg.marginTopMm}
                    onChange={(e) => setTerminalCfg({ ...terminalCfg, marginTopMm: Number(e.target.value) || 0 })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">الهامش الجانبي للطباعة (mm)</label>
                  <input
                    type="number"
                    min="0"
                    max="30"
                    value={terminalCfg.marginSideMm}
                    onChange={(e) => setTerminalCfg({ ...terminalCfg, marginSideMm: Number(e.target.value) || 0 })}
                    className="w-full rounded border border-slate-300 px-3 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">مفتاح إنهاء الماسح وأقصى مهلة التقاط (ms)</label>
                  <div className="flex gap-2">
                    <select
                      value={terminalCfg.scannerSuffix}
                      onChange={(e) =>
                        setTerminalCfg({ ...terminalCfg, scannerSuffix: e.target.value as 'Enter' | 'Tab' })
                      }
                      className="w-1/2 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    >
                      <option value="Enter">Enter (CR)</option>
                      <option value="Tab">Tab</option>
                    </select>
                    <input
                      type="number"
                      min="25"
                      max="200"
                      value={terminalCfg.scannerBurstMs}
                      onChange={(e) =>
                        setTerminalCfg({ ...terminalCfg, scannerBurstMs: Number(e.target.value) || 70 })
                      }
                      title="مهلة Burst بين أحرف الماسح (مللي ثانية)"
                      className="w-1/2 rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={terminalCfg.autoPrintReceipt}
                    onChange={(e) => setTerminalCfg({ ...terminalCfg, autoPrintReceipt: e.target.checked })}
                    className="h-4 w-4 rounded"
                  />
                  <span>فتح نافذة الطباعة / الإيصال تلقائياً فور إتمام الدفع في نقطة البيع</span>
                </label>
                <button
                  type="submit"
                  className="rounded bg-[#0B4F9C] px-5 py-2 text-sm font-bold text-white hover:bg-[#083D7A]"
                >
                  حفظ تفضيلات هذه الطرفية
                </button>
              </div>
            </form>
          </div>

          {/* Complete Database JSON Export / Import Card */}
          {canManageSite && (
            <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
                <Database className="h-5 w-5 text-[#145632]" />
                <h2 className="text-lg font-bold text-slate-800">
                  النسخ الاحتياطي واستعادة قاعدة البيانات بالكامل (JSON)
                </h2>
              </div>
              <div className="space-y-4 p-5">
                {dbMsg && (
                  <div className="flex items-center gap-1.5 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>{dbMsg}</span>
                  </div>
                )}

                <div className="rounded border border-slate-200 bg-[#F3F6FA] p-4 text-xs leading-relaxed text-slate-700">
                  يشمل النسخ الاحتياطي تصدير واستيراد <strong>جميع جداول قاعدة البيانات بالكامل</strong> بصيغة{' '}
                  <span className="font-mono font-bold" dir="ltr">
                    JSON
                  </span>{' '}
                  (الأدوية والتشغيلات، التصنيفات، المستودعات، التحويلات والجرد، فواتير المبيعات والمرتجعات والورديات،
                  المشتريات والموردين، العملاء والأطباء والوصفات، الحسابات والقيود والسندات، الموظفين والرواتب،
                  المستخدمين والصلاحيات، إعدادات الصيدلية والعملات، وسجل التدقيق).
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {/* Export Panel */}
                  <div className="flex flex-col justify-between rounded border border-emerald-200 bg-emerald-50/40 p-4">
                    <div>
                      <div className="mb-1.5 flex items-center gap-2 text-sm font-bold text-[#145632]">
                        <Download className="h-4 w-4" />
                        <span>تصدير نسخة احتياطية كاملة</span>
                      </div>
                      <p className="mb-4 text-xs text-slate-600">
                        تحميل نسخة كاملة ومشفرة البنية لجميع السجلات في ملف JSON واحد يمكن حفظه واسترجاعه في أي وقت.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={exportingDb}
                      onClick={() => void handleExportDatabase()}
                      className="inline-flex items-center justify-center gap-2 rounded bg-[#145632] px-4 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-[#0f4126] disabled:opacity-60"
                    >
                      <Download className="h-4 w-4" />
                      <span>{exportingDb ? 'جاري تجهيز الملف...' : 'تصدير قاعدة البيانات (JSON)'}</span>
                    </button>
                  </div>

                  {/* Import Panel */}
                  <div className="flex flex-col justify-between rounded border border-amber-200 bg-amber-50/40 p-4">
                    <div>
                      <div className="mb-1.5 flex items-center gap-2 text-sm font-bold text-amber-900">
                        <Upload className="h-4 w-4" />
                        <span>استيراد واسترجاع نسخة احتياطية</span>
                      </div>
                      <p className="mb-3 text-xs text-slate-600">
                        اختر ملف النسخة الاحتياطية (JSON) لفحصه ومعاينة محتوياته قبل استبدال البيانات الحالية.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) => void handleSelectBackupFile(e)}
                        className="block w-full cursor-pointer rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 file:ml-3 file:rounded file:border-0 file:bg-[#0B4F9C] file:px-3 file:py-1 file:text-xs file:font-bold file:text-white hover:file:bg-[#083D7A]"
                      />
                    </div>
                  </div>
                </div>

                {/* Selected Backup Preview & Confirmation Trigger */}
                {pendingBackup && (
                  <div className="space-y-3 rounded border border-indigo-300 bg-indigo-50/40 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 pb-2">
                      <div className="flex items-center gap-2 text-sm font-bold text-indigo-950">
                        <FileJson className="h-4 w-4 text-indigo-700" />
                        <span>معاينة ملف النسخة الاحتياطية المحدد</span>
                      </div>
                      <span className="rounded bg-white px-2 py-0.5 font-mono text-xs font-bold text-indigo-800" dir="ltr">
                        {pendingFileName}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <div className="rounded border bg-white p-2">
                        <div className="text-slate-500">اسم الصيدلية</div>
                        <div className="font-bold text-slate-800">{pendingBackup.siteName || 'غير محدد'}</div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <div className="text-slate-500">تاريخ التصدير</div>
                        <div className="font-mono font-bold text-slate-800" dir="ltr">
                          {pendingBackup.exportedAt || '-'}
                        </div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <div className="text-slate-500">عدد الجداول</div>
                        <div className="font-bold text-indigo-700">
                          {Object.keys(pendingBackup.tables).length} جدول
                        </div>
                      </div>
                      <div className="rounded border bg-white p-2">
                        <div className="text-slate-500">إجمالي السجلات</div>
                        <div className="font-bold text-emerald-700">
                          {pendingBackup.totalRows ??
                            Object.values(pendingBackup.tables).reduce(
                              (sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0),
                              0,
                            )}{' '}
                          سجل
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-[11px] text-slate-700">
                      <span className="rounded bg-white px-2 py-1 border">
                        الأدوية: <strong>{pendingBackup.tables.inventeries?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        التشغيلات: <strong>{pendingBackup.tables.medicine_batches?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        فواتير البيع: <strong>{pendingBackup.tables.sold?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        المشتريات: <strong>{pendingBackup.tables.purchase_orders?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        العملاء: <strong>{pendingBackup.tables.customers?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        الموردون: <strong>{pendingBackup.tables.supplier?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        القيود المحاسبية: <strong>{pendingBackup.tables.journal_entries?.length || 0}</strong>
                      </span>
                      <span className="rounded bg-white px-2 py-1 border">
                        المستخدمون: <strong>{pendingBackup.tables.users?.length || 0}</strong>
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                      <div className="flex items-center gap-1.5">
                        <ShieldAlert className="h-4 w-4 shrink-0" />
                        <span>
                          تنبيه: استيراد هذه النسخة سيستبدل جميع البيانات الحالية بالبيانات الموجودة داخل الملف بشكل ذري
                          وآمن.
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingBackup(null);
                            setPendingFileName('');
                          }}
                          className="rounded border border-slate-300 bg-white px-3 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          إلغاء الملف
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmImportOpen(true)}
                          className="rounded bg-red-600 px-4 py-1.5 font-bold text-white hover:bg-red-700"
                        >
                          استيراد واسترجاع قاعدة البيانات
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <ConfirmModal
            open={confirmImportOpen}
            title="تأكيد استيراد واستعادة قاعدة البيانات"
            message={`هل أنت متأكد من استبدال قاعدة البيانات الحالية بالكامل ببيانات ملف "${pendingFileName}"؟ لا يمكن التراجع عن هذه العملية بعد تنفيذها (يُنصح بتصدير نسخة احتياطية حالية أولاً).`}
            confirmLabel="نعم، استيراد واسترجاع الآن"
            busy={importingDb}
            onConfirm={() => void handleConfirmImportDatabase()}
            onCancel={() => setConfirmImportOpen(false)}
          />
        </>
      )}
    </div>
  );
};
