import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  PlusCircle,
  Search,
  CheckCircle2,
  XCircle,
  KeyRound,
  ShieldAlert,
  Users,
  Pill,
  ShoppingBag,
  Coins,
  RefreshCw,
  Copy,
  Check,
  Eye,
  AlertTriangle,
  Upload,
  Lock,
  Edit3,
  Download,
  Database,
  Server,
  ShieldCheck,
  Calendar,
  Activity,
  Trash2,
} from 'lucide-react';
import { api, getActivePharmacyScope, setActivePharmacyScope } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type {
  DatabaseBackupPayload,
  PharmacyTenant,
  PlatformAuditLog,
  PlatformMetrics,
  SiteSettings,
  User,
} from '../types';
import { resolvePhotoSrc } from '../types';
import { ConfirmModal } from '../components/ConfirmModal';

interface DeveloperTenantsPageProps {
  currentUser: User;
  currentSite: SiteSettings;
  onSelectTenantScope: (tenant: PharmacyTenant | null) => Promise<void>;
}

interface ServerStatusInfo {
  nodeVersion: string;
  uptimeSeconds: number;
  memoryRssMb: number;
  platform: string;
  dbMode: string;
}

type PlatformTab = 'tenants' | 'audit' | 'system';

function addMonthsDate(startIso: string, months: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(startIso) ? new Date(`${startIso}T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + Math.max(1, months), base.getUTCDate()));
  return target.toISOString().slice(0, 10);
}

function addDaysFromToday(days: number): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days));
  return target.toISOString().slice(0, 10);
}

export const DeveloperTenantsPage: React.FC<DeveloperTenantsPageProps> = ({
  onSelectTenantScope,
}) => {
  const [activeTab, setActiveTab] = useState<PlatformTab>('tenants');
  const [loading, setLoading] = useState(true);
  const [tenants, setTenants] = useState<PharmacyTenant[]>([]);
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatusInfo | null>(null);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'expiring'>('all');
  const [toastMsg, setToastMsg] = useState('');

  // Create Tenant Modal State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Create Form Fields
  const [pharmacyName, setPharmacyName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [confirmOwnerPassword, setConfirmOwnerPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('السعودية');
  const [currencyCode, setCurrencyCode] = useState('SAR');
  const [currencySymbol, setCurrencySymbol] = useState('ر.س');
  const [currencyName, setCurrencyName] = useState('ريال سعودي');
  const [currencyDecimals, setCurrencyDecimals] = useState(2);
  const [taxNumber, setTaxNumber] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [subscriptionStart, setSubscriptionStart] = useState(new Date().toISOString().slice(0, 10));
  const [subscriptionMonths, setSubscriptionMonths] = useState(12);
  const [licenseExpiresAt, setLicenseExpiresAt] = useState(() =>
    addMonthsDate(new Date().toISOString().slice(0, 10), 12),
  );
  const [licenseManuallyEdited, setLicenseManuallyEdited] = useState(false);
  const [createIsActive, setCreateIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [logoBase64, setLogoBase64] = useState('');

  // Edit Tenant Modal State
  const [editModalTenant, setEditModalTenant] = useState<PharmacyTenant | null>(null);
  const [editName, setEditName] = useState('');
  const [editTradeName, setEditTradeName] = useState('');
  const [editLogo, setEditLogo] = useState('');
  const [editCurrencyCode, setEditCurrencyCode] = useState('SAR');
  const [editCurrencySymbol, setEditCurrencySymbol] = useState('ر.س');
  const [editCurrencyName, setEditCurrencyName] = useState('ريال سعودي');
  const [editCurrencyDecimals, setEditCurrencyDecimals] = useState(2);
  const [editOwnerName, setEditOwnerName] = useState('');
  const [editOwnerUsername, setEditOwnerUsername] = useState('');
  const [editOwnerEmail, setEditOwnerEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editTaxNumber, setEditTaxNumber] = useState('');
  const [editLicenseNumber, setEditLicenseNumber] = useState('');
  const [editSubscriptionStart, setEditSubscriptionStart] = useState('');
  const [editSubscriptionMonths, setEditSubscriptionMonths] = useState(12);
  const [editLicenseExpiresAt, setEditLicenseExpiresAt] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editNotes, setEditNotes] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Confirm Toggle Status Modal State (no window.confirm)
  const [statusConfirmTenant, setStatusConfirmTenant] = useState<PharmacyTenant | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);

  // Confirm Permanent Delete Tenant Modal State
  const [deleteConfirmTenant, setDeleteConfirmTenant] = useState<PharmacyTenant | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Restore Tenant Backup State
  const restoreFileRef = useRef<HTMLInputElement | null>(null);
  const [restoreTargetTenant, setRestoreTargetTenant] = useState<PharmacyTenant | null>(null);
  const [pendingRestorePayload, setPendingRestorePayload] = useState<DatabaseBackupPayload | null>(null);
  const [pendingRestoreFileName, setPendingRestoreFileName] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [backupBusyId, setBackupBusyId] = useState<number | null>(null);

  // Password Reset Modal State
  const [resetModalTenant, setResetModalTenant] = useState<PharmacyTenant | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState('');

  // Success Created Modal
  const [createdTenantData, setCreatedTenantData] = useState<{
    tenant: PharmacyTenant;
    initialPassword: string;
  } | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const activeScopeId = getActivePharmacyScope();

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 4500);
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const [dashRes, tenantsRes, auditRes] = await Promise.all([
        api.getPlatformDashboard(),
        api.getPlatformTenants(),
        api.getPlatformAuditLogs(),
      ]);
      setMetrics(dashRes.metrics);
      setServerStatus(dashRes.serverStatus);
      setTenants(tenantsRes.pharmacies || []);
      setAuditLogs(auditRes.logs || []);
    } catch (err) {
      showErrorPopup(err, 'تحميل بيانات المنصة والصيدليات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      validationError(
        'صيغة صورة الشعار غير مدعومة (المسموح PNG أو JPG أو WebP فقط)',
        'اختيار شعار الصيدلية',
        [`صيغة الملف المختار (${file.type || 'غير معروفة'}) غير مدعومة.`],
        'اختر صورة بصيغة PNG أو JPG أو WebP.',
      );
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      validationError(
        'حجم صورة الشعار كبير جداً (الحد الأقصى 2 ميغابايت)',
        'اختيار شعار الصيدلية',
        [`حجم الملف المختار هو ${(file.size / (1024 * 1024)).toFixed(2)} MB.`],
        'اضغط الصورة أو اختر صورة أصغر من 2 ميغابايت.',
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      showErrorPopup(new Error('تعذر قراءة ملف الصورة من الجهاز'), 'اختيار شعار الصيدلية');
    };
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoBase64(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = ownerUsername.trim().toLowerCase().replace(/\s+/g, '_');
    const resolvedEmail = ownerEmail.trim().toLowerCase() || `${cleanUsername}@pharmacy.local`;
    if (!pharmacyName.trim() || !ownerName.trim() || !cleanUsername || !ownerPassword.trim()) {
      validationError(
        'يرجى ملء جميع الحقول الإلزامية (*) قبل إنشاء الصيدلية',
        'إنشاء حساب صيدلية جديدة',
        ['أحد الحقول الأساسية (اسم الصيدلية، اسم المالك، اسم المستخدم، أو كلمة المرور) فارغ.'],
        'أكمل الحقول المطلوبة ثم اضغط تأكيد وإنشاء الصيدلية.',
      );
      return;
    }
    if (ownerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      validationError(
        'صيغة البريد الإلكتروني للمالك غير صحيحة',
        'إنشاء حساب صيدلية جديدة',
        ['البريد الإلكتروني المدخل لا يتبع الصيغة الصحيحة.'],
        'أدخل بريداً صحيحاً مثل owner@pharmacy.com أو اتركه فارغاً ليتم التوليد التلقائي.',
      );
      return;
    }
    if (ownerPassword.trim() !== confirmOwnerPassword.trim()) {
      validationError(
        'كلمة المرور وتأكيد كلمة المرور غير متطابقتين',
        'إنشاء حساب صيدلية جديدة',
        ['النص في خانة كلمة المرور يختلف عن خانة تأكيد كلمة المرور.'],
        'أعد كتابة كلمتي المرور بشكل متطابق.',
      );
      return;
    }
    if (ownerPassword.trim().length < 4) {
      validationError(
        'كلمة المرور يجب أن لا تقل عن 4 خانات',
        'إنشاء حساب صيدلية جديدة',
        ['كلمة المرور الأولية أقصر من الحد الأدنى المسموح (4 أحرف).'],
        'أدخل كلمة مرور مكونة من 4 أحرف أو أرقام على الأقل.',
      );
      return;
    }
    if (licenseExpiresAt.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(licenseExpiresAt.trim())) {
      validationError(
        'تاريخ انتهاء الترخيص غير صحيح',
        'إنشاء حساب صيدلية جديدة',
        ['صيغة تاريخ الانتهاء ليست بصيغة YYYY-MM-DD.'],
        'اختر تاريخ الانتهاء من التقويم أو اتركه مفتوحاً.',
      );
      return;
    }
    try {
      setSubmitting(true);
      const res = await api.createPlatformTenant({
        name: pharmacyName.trim(),
        tradeName: tradeName.trim() || undefined,
        code: tenantCode.trim() || undefined,
        ownerName: ownerName.trim(),
        ownerUsername: cleanUsername,
        ownerEmail: resolvedEmail,
        ownerPassword: ownerPassword.trim(),
        currencyCode: currencyCode.trim() || 'SAR',
        currencySymbol: currencySymbol.trim() || 'ر.س',
        currencyName: currencyName.trim() || 'ريال سعودي',
        currencyDecimals,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        city: city.trim() || undefined,
        country: country.trim() || 'السعودية',
        logo: logoBase64 || undefined,
        taxNumber: taxNumber.trim() || undefined,
        licenseNumber: licenseNumber.trim() || undefined,
        isActive: createIsActive,
        subscriptionStart,
        subscriptionMonths,
        licenseExpiresAt: licenseExpiresAt.trim(),
        notes: notes.trim() || undefined,
      });

      setCreatedTenantData({
        tenant: res.pharmacy,
        initialPassword: ownerPassword.trim(),
      });
      setIsCreateModalOpen(false);

      // Reset form
      const todayIso = new Date().toISOString().slice(0, 10);
      setPharmacyName('');
      setTradeName('');
      setTenantCode('');
      setOwnerName('');
      setOwnerUsername('');
      setOwnerEmail('');
      setOwnerPassword('');
      setConfirmOwnerPassword('');
      setPhone('');
      setAddress('');
      setCity('');
      setCountry('السعودية');
      setTaxNumber('');
      setLicenseNumber('');
      setSubscriptionStart(todayIso);
      setSubscriptionMonths(12);
      setLicenseExpiresAt(addMonthsDate(todayIso, 12));
      setLicenseManuallyEdited(false);
      setCreateIsActive(true);
      setNotes('');
      setLogoBase64('');

      await loadData();
    } catch (err) {
      showErrorPopup(err, 'إنشاء حساب صيدلية جديدة');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
      validationError(
        'صيغة صورة الشعار غير مدعومة (المسموح PNG أو JPG أو WebP فقط)',
        'تغيير شعار الصيدلية',
        [`صيغة الملف المختار (${file.type || 'غير معروفة'}) غير مدعومة.`],
        'اختر صورة بصيغة PNG أو JPG أو WebP.',
      );
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      validationError(
        'حجم صورة الشعار كبير جداً (الحد الأقصى 2 ميغابايت)',
        'تغيير شعار الصيدلية',
        [`حجم الملف المختار هو ${(file.size / (1024 * 1024)).toFixed(2)} MB.`],
        'اختر صورة أقل من 2 ميغابايت.',
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => {
      showErrorPopup(new Error('تعذر قراءة ملف الصورة'), 'تغيير شعار الصيدلية');
    };
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditLogo(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const openEditModal = (tenant: PharmacyTenant) => {
    setEditModalTenant(tenant);
    setEditName(tenant.name);
    setEditTradeName(tenant.tradeName || '');
    setEditLogo(tenant.logo || '');
    setEditCurrencyCode(tenant.currencyCode || 'SAR');
    setEditCurrencySymbol(tenant.currencySymbol || 'ر.س');
    setEditCurrencyName(tenant.currencyName || 'ريال سعودي');
    setEditCurrencyDecimals(tenant.currencyDecimals ?? 2);
    setEditOwnerName(tenant.ownerName || '');
    setEditOwnerUsername(tenant.ownerUsername || '');
    setEditOwnerEmail(tenant.ownerEmail || '');
    setEditPhone(tenant.phone || '');
    setEditAddress(tenant.address || '');
    setEditCity(tenant.city || '');
    setEditCountry(tenant.country || 'السعودية');
    setEditTaxNumber(tenant.taxNumber || '');
    setEditLicenseNumber(tenant.licenseNumber || '');
    setEditSubscriptionStart(tenant.subscriptionStart || tenant.createdAt?.slice(0, 10) || '');
    setEditSubscriptionMonths(tenant.subscriptionMonths ?? 12);
    setEditLicenseExpiresAt(tenant.licenseExpiresAt || '');
    setEditIsActive(tenant.isActive);
    setEditNotes(tenant.notes || '');
  };

  const handleSaveEditTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editModalTenant) return;
    if (!editName.trim()) {
      validationError(
        'اسم الصيدلية مطلوب ولا يمكن تركه فارغاً',
        'تعديل بيانات وترخيص الصيدلية',
        ['تم ترك حقل اسم الصيدلية فارغاً.'],
        'أدخل اسم الصيدلية ثم احفظ التعديلات.',
      );
      return;
    }
    if (editOwnerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editOwnerEmail.trim())) {
      validationError(
        'صيغة البريد الإلكتروني للمالك غير صالحة',
        'تعديل بيانات وترخيص الصيدلية',
        ['البريد الإلكتروني المدخل في نافذة التعديل غير صحيح.'],
        'أدخل بريداً إلكترونياً سليماً أو اترك الحقل فارغاً.',
      );
      return;
    }
    if (editLicenseExpiresAt.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(editLicenseExpiresAt.trim())) {
      validationError(
        'صيغة تاريخ انتهاء الترخيص غير صحيحة',
        'تعديل بيانات وترخيص الصيدلية',
        ['التاريخ المدخل لا يتبع الصيغة YYYY-MM-DD.'],
        'اختر تاريخاً من التقويم أو اضغط جعل الترخيص مفتوحاً.',
      );
      return;
    }
    try {
      setEditSubmitting(true);
      await api.updatePlatformTenant(editModalTenant.id, {
        name: editName.trim(),
        tradeName: editTradeName.trim(),
        logo: editLogo,
        currencyCode: editCurrencyCode.trim().toUpperCase() || 'SAR',
        currencySymbol: editCurrencySymbol.trim() || 'ر.س',
        currencyName: editCurrencyName.trim() || 'ريال سعودي',
        currencyDecimals: editCurrencyDecimals,
        ownerName: editOwnerName.trim(),
        ownerUsername: editOwnerUsername.trim().toLowerCase().replace(/\s+/g, '_'),
        ownerEmail: editOwnerEmail.trim().toLowerCase(),
        phone: editPhone.trim(),
        address: editAddress.trim(),
        city: editCity.trim(),
        country: editCountry.trim(),
        taxNumber: editTaxNumber.trim(),
        licenseNumber: editLicenseNumber.trim(),
        subscriptionStart: editSubscriptionStart.trim(),
        subscriptionMonths: editSubscriptionMonths,
        licenseExpiresAt: editLicenseExpiresAt.trim(),
        isActive: editModalTenant.id === 1 ? true : editIsActive,
        notes: editNotes.trim(),
      });
      setEditModalTenant(null);
      showToast(`تم تحديث بيانات وترخيص "${editName}" بنجاح`);
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'تعديل بيانات وترخيص الصيدلية');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleConfirmToggleStatus = async () => {
    if (!statusConfirmTenant) return;
    try {
      setStatusBusy(true);
      const nextStatus = !statusConfirmTenant.isActive;
      await api.togglePlatformTenantStatus(statusConfirmTenant.id, nextStatus);
      showToast(
        nextStatus
          ? `تم تفعيل حساب صيدلية "${statusConfirmTenant.name}" بنجاح`
          : `تم إيقاف وتعليق حساب "${statusConfirmTenant.name}" وإلغاء جميع الجلسات النشطة`,
      );
      setStatusConfirmTenant(null);
      await loadData();
    } catch (err) {
      showErrorPopup(err, statusConfirmTenant.isActive ? 'إيقاف حساب الصيدلية' : 'تفعيل حساب الصيدلية');
      setStatusConfirmTenant(null);
    } finally {
      setStatusBusy(false);
    }
  };

  const handleConfirmDeleteTenant = async () => {
    if (!deleteConfirmTenant) return;
    try {
      setDeleteBusy(true);
      const target = deleteConfirmTenant;
      await api.deletePlatformTenant(target.id);
      if (activeScopeId === target.id) {
        setActivePharmacyScope(null);
        await onSelectTenantScope(null);
      }
      setDeleteConfirmTenant(null);
      showToast(`تم حذف حساب صيدلية "${target.name}" وجميع بياناتها المعزولة بنجاح`);
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'حذف حساب الصيدلية نهائياً');
      setDeleteConfirmTenant(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleDownloadTenantBackup = async (tenant: PharmacyTenant) => {
    try {
      setBackupBusyId(tenant.id);
      const res = await api.backupPlatformTenant(tenant.id);
      const blob = new Blob([JSON.stringify(res.backup, null, 2)], {
        type: 'application/json;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`تم تنزيل نسخة احتياطية معزولة لصيدلية "${tenant.name}"`);
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'تنزيل نسخة احتياطية معزولة للصيدلية');
    } finally {
      setBackupBusyId(null);
    }
  };

  const handleTriggerRestoreFile = (tenant: PharmacyTenant) => {
    setRestoreTargetTenant(tenant);
    restoreFileRef.current?.click();
  };

  const handleRestoreFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !restoreTargetTenant) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as DatabaseBackupPayload;
      if (!parsed || typeof parsed !== 'object' || !parsed.tables) {
        throw new Error('ملف JSON غير صالح ولا يحتوي على الجداول المطلوبة');
      }
      setPendingRestorePayload(parsed);
      setPendingRestoreFileName(file.name);
    } catch (err) {
      setRestoreTargetTenant(null);
      showErrorPopup(err, 'قراءة ملف النسخة الاحتياطية للصيدلية');
    }
  };

  const handleConfirmRestoreTenant = async () => {
    if (!restoreTargetTenant || !pendingRestorePayload) return;
    try {
      setRestoreBusy(true);
      const res = await api.restorePlatformTenant(restoreTargetTenant.id, pendingRestorePayload);
      showToast(
        `تمت استعادة نسخة صيدلية "${restoreTargetTenant.name}" بنجاح (${res.restoredTables} جدول، ${res.restoredRows} سجل)`,
      );
      setPendingRestorePayload(null);
      setPendingRestoreFileName('');
      setRestoreTargetTenant(null);
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'استعادة نسخة الصيدلية الاحتياطية');
      setPendingRestorePayload(null);
      setRestoreTargetTenant(null);
    } finally {
      setRestoreBusy(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalTenant) return;
    if (!newPassword.trim() || newPassword.trim().length < 4) {
      validationError(
        'يرجى إدخال كلمة مرور جديدة لا تقل عن 4 أحرف أو أرقام',
        'إعادة تعيين كلمة مرور المالك',
        ['كلمة المرور الجديدة فارغة أو أقل من الحد الأدنى المطلوب (4 خانات).'],
        'أدخل كلمة مرور قوية من 4 خانات فأكثر ثم اضغط تأكيد التغيير.',
      );
      return;
    }
    try {
      setResetSubmitting(true);
      await api.resetPlatformTenantPassword(resetModalTenant.id, newPassword.trim());
      setResetSuccessMessage('تم تعيين كلمة المرور الجديدة بنجاح للمالك!');
      setTimeout(() => {
        setResetSuccessMessage('');
        setResetModalTenant(null);
        setNewPassword('');
      }, 2000);
      await loadData();
    } catch (err) {
      showErrorPopup(err, 'إعادة تعيين كلمة مرور المالك');
    } finally {
      setResetSubmitting(false);
    }
  };

  const copyToClipboard = (text: string, field: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const filteredTenants = tenants.filter((t) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      t.name.toLowerCase().includes(q) ||
      (t.tradeName && t.tradeName.toLowerCase().includes(q)) ||
      t.code.toLowerCase().includes(q) ||
      t.ownerName.toLowerCase().includes(q) ||
      t.ownerUsername.toLowerCase().includes(q) ||
      (t.city && t.city.toLowerCase().includes(q)) ||
      (t.phone && t.phone.includes(searchTerm));

    if (!matchesSearch) return false;
    if (statusFilter === 'active') return t.isActive;
    if (statusFilter === 'suspended') return !t.isActive;
    if (statusFilter === 'expiring') return Boolean(t.licenseExpiringSoon || t.licenseExpired);
    return true;
  });

  return (
    <div className="space-y-6 p-4 sm:p-6" dir="rtl">
      <input
        ref={restoreFileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(e) => void handleRestoreFileSelected(e)}
      />

      {/* Global Toast Banner */}
      {toastMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800 shadow-sm">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Scope Alert Banner */}
      {activeScopeId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 shadow-md">
          <div className="flex items-center gap-3 text-amber-900">
            <ShieldAlert className="h-6 w-6 shrink-0 text-amber-600" />
            <div>
              <div className="text-sm font-bold">
                أنت الآن في وضع معاينة وفحص صيدلية محددة (معرف المستأجر: #{activeScopeId})
              </div>
              <div className="text-xs text-amber-700">
                جميع العمليات والتقارير والأدوية الحالية معزولة تماماً وتخص هذه الصيدلية فقط.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              try {
                setActivePharmacyScope(null);
                await onSelectTenantScope(null);
              } catch (err) {
                showErrorPopup(err, 'إلغاء معاينة الصيدلية');
              }
            }}
            className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-bold text-white transition hover:bg-amber-800"
          >
            إلغاء المعاينة والعودة للنظام العام
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl bg-gradient-to-l from-[#0B4F9C] via-[#0E3A73] to-[#0A192F] p-6 text-white shadow-xl sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-sky-500/20 px-2.5 py-1 text-xs font-bold text-sky-200">
              Platform Super Admin · إتقان سوفت
            </span>
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2.5 py-0.5 text-xs text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              منصة SaaS متعددة المستأجرين
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">
            لوحة مالك النظام وإدارة الصيدليات (Multi-Tenant SaaS)
          </h1>
          <p className="mt-1 max-w-2xl text-xs text-sky-100 sm:text-sm">
            إنشاء وتعديل حسابات الصيدليات المستقلة، إدارة الاشتراكات، أخذ واستعادة نسخ احتياطية معزولة لكل صيدلية،
            ومراجعة سجل تدقيق المنصة وحالة الخادم.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={() => void loadData()}
            title="تحديث البيانات"
            className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2.5 text-xs font-semibold text-white transition hover:bg-white/20"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">تحديث</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-xl bg-[#F97316] px-4 py-2.5 text-xs font-bold text-white shadow-lg transition hover:bg-[#ea580c]"
          >
            <PlusCircle className="h-4 w-4" />
            <span>إضافة صيدلية جديدة</span>
          </button>
        </div>
      </div>

      {/* KPI Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium">إجمالي الصيدليات</span>
              <Building2 className="h-4 w-4 text-[#0B4F9C]" />
            </div>
            <div className="mt-1.5 text-xl font-black text-slate-800">{metrics.totalPharmacies}</div>
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-emerald-700">
              <span className="text-[11px] font-medium">الصيدليات النشطة</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-emerald-800">{metrics.activePharmacies}</div>
          </div>

          <div className="rounded-xl border border-red-100 bg-red-50/50 p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-red-700">
              <span className="text-[11px] font-medium">الموقوفة</span>
              <XCircle className="h-4 w-4 text-red-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-red-800">{metrics.suspendedPharmacies}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium">المستخدمين</span>
              <Users className="h-4 w-4 text-purple-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-slate-800">{metrics.totalUsers}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium">الأصناف الدوائية</span>
              <Pill className="h-4 w-4 text-teal-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-slate-800">{metrics.totalMedicines}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium">فواتير البيع</span>
              <ShoppingBag className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-slate-800">{metrics.totalSales}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium">عمليات الدخول</span>
              <Activity className="h-4 w-4 text-sky-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-slate-800">{metrics.totalLogins ?? 0}</div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-medium">النسخ الاحتياطية</span>
              <Database className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-1.5 text-xl font-black text-slate-800">{metrics.totalBackups ?? 0}</div>
          </div>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('tenants')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
            activeTab === 'tenants'
              ? 'bg-[#0B4F9C] text-white shadow'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Building2 className="h-4 w-4" />
          <span>إدارة الصيدليات والمستأجرين ({tenants.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
            activeTab === 'audit'
              ? 'bg-[#0B4F9C] text-white shadow'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ShieldCheck className="h-4 w-4" />
          <span>سجل تدقيق المنصة المستقل ({auditLogs.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('system')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition ${
            activeTab === 'system'
              ? 'bg-[#0B4F9C] text-white shadow'
              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Server className="h-4 w-4" />
          <span>حالة الخادم وقواعد البيانات</span>
        </button>
      </div>

      {/* TAB 1: TENANTS MANAGEMENT */}
      {activeTab === 'tenants' && (
        <>
          <div className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="بحث باسم الصيدلية، الكود، المدينة، المالك، اسم المستخدم، أو الهاتف..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-9 text-sm focus:border-[#0B4F9C] focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === 'all'
                    ? 'bg-[#0B4F9C] text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                الكل ({tenants.length})
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('active')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === 'active'
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                النشطة فقط
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('suspended')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === 'suspended'
                    ? 'bg-red-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                الموقوفة فقط
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter('expiring')}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  statusFilter === 'expiring'
                    ? 'bg-amber-600 text-white'
                    : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                }`}
              >
                قريبة/منتهية الترخيص
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs sm:text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold text-slate-600 sm:text-xs">
                  <tr>
                    <th className="px-4 py-3">الصيدلية / الشعار</th>
                    <th className="px-4 py-3">المالك / الحساب</th>
                    <th className="px-4 py-3">العملة والموقع</th>
                    <th className="px-4 py-3">إحصائيات البيانات</th>
                    <th className="px-4 py-3">الاشتراك وآخر دخول</th>
                    <th className="px-4 py-3">الحالة</th>
                    <th className="px-4 py-3 text-center">الإجراءات والنسخ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-400">
                        لا توجد صيدليات مطابقة لبحثك.
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map((tenant) => {
                      const isCurrentScope = activeScopeId === tenant.id;
                      return (
                        <tr
                          key={tenant.id}
                          className={`transition hover:bg-slate-50/80 ${
                            isCurrentScope ? 'bg-sky-50/70 font-semibold' : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
                                {tenant.logo ? (
                                  <img
                                    src={resolvePhotoSrc(tenant.logo)}
                                    alt={tenant.name}
                                    className="h-full w-full object-contain"
                                  />
                                ) : (
                                  <Building2 className="h-6 w-6 text-[#0B4F9C]" />
                                )}
                              </div>
                              <div>
                                <div className="font-bold text-slate-900">{tenant.name}</div>
                                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">
                                    {tenant.code}
                                  </span>
                                  <span>{tenant.id === 1 ? 'النظام التأسيسي' : `#${tenant.id}`}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-800">{tenant.ownerName}</div>
                            <div className="font-mono text-[11px] text-[#0B4F9C]" dir="ltr">
                              @{tenant.ownerUsername}
                            </div>
                            {tenant.ownerEmail && (
                              <div className="text-[11px] text-slate-500" dir="ltr">
                                {tenant.ownerEmail}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
                              <Coins className="h-3 w-3 text-amber-600" />
                              <span>
                                {tenant.currencyName} ({tenant.currencySymbol})
                              </span>
                            </span>
                            {(tenant.city || tenant.country) && (
                              <div className="mt-1 text-[11px] text-slate-500">
                                {[tenant.city, tenant.country].filter(Boolean).join(' - ')}
                              </div>
                            )}
                          </td>

                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-purple-700">
                                {tenant.userCount ?? 1} مستخدم
                              </span>
                              <span className="rounded bg-teal-50 px-1.5 py-0.5 text-teal-700">
                                {tenant.medicineCount ?? 0} دواء
                              </span>
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                                {(tenant.revenue ?? 0).toLocaleString()} {tenant.currencySymbol}
                              </span>
                            </div>
                          </td>

                          <td className="px-4 py-3 text-[11px] text-slate-600">
                            <div className="flex items-center gap-1 font-semibold text-slate-700">
                              <Calendar className="h-3 w-3 text-[#0B4F9C]" />
                              <span>{tenant.subscriptionMonths ?? 12} شهر</span>
                            </div>
                            <div className="font-mono text-[10px] text-slate-500" dir="ltr">
                              من: {tenant.subscriptionStart || tenant.createdAt?.slice(0, 10) || '—'}
                            </div>
                            <div className="mt-0.5">
                              {tenant.licenseExpired ? (
                                <span className="inline-flex items-center gap-1 rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-700">
                                  منتهي الترخيص ({tenant.licenseExpiresAt})
                                </span>
                              ) : tenant.licenseExpiringSoon ? (
                                <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800">
                                  ينتهي خلال {tenant.licenseDaysRemaining === 0 ? 'اليوم' : `${tenant.licenseDaysRemaining}ي`} ({tenant.licenseExpiresAt})
                                </span>
                              ) : tenant.licenseExpiresAt ? (
                                <span className="font-mono text-[10px] font-semibold text-emerald-700" dir="ltr">
                                  ينتهي: {tenant.licenseExpiresAt}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">ترخيص مفتوح</span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-slate-500" dir="ltr">
                              دخول: {tenant.lastLoginAt ? tenant.lastLoginAt.slice(0, 16).replace('T', ' ') : 'لم يسجل بعد'}
                            </div>
                          </td>

                          <td className="px-4 py-3">
                            {!tenant.isActive ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800">
                                <XCircle className="h-3.5 w-3.5" />
                                <span>موقوف</span>
                              </span>
                            ) : tenant.licenseExpired ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-bold text-red-800">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>ترخيص منتهي</span>
                              </span>
                            ) : tenant.licenseExpiringSoon ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span>تنبيه انتهاء</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>نشط</span>
                              </span>
                            )}
                          </td>

                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-wrap items-center justify-center gap-1">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    if (isCurrentScope) {
                                      setActivePharmacyScope(null);
                                      await onSelectTenantScope(null);
                                    } else {
                                      setActivePharmacyScope(tenant.id);
                                      await onSelectTenantScope(tenant);
                                    }
                                  } catch (err) {
                                    showErrorPopup(err, 'تبديل نطاق معاينة الصيدلية');
                                  }
                                }}
                                title={isCurrentScope ? 'إلغاء المعاينة' : 'معاينة بيانات الصيدلية'}
                                className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${
                                  isCurrentScope
                                    ? 'bg-amber-600 text-white hover:bg-amber-700'
                                    : 'bg-[#0B4F9C] text-white hover:bg-[#083D7A]'
                                }`}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>{isCurrentScope ? 'نشط' : 'معاينة'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => openEditModal(tenant)}
                                title="تعديل بيانات الصيدلية والاشتراك"
                                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setResetModalTenant(tenant);
                                  setNewPassword('');
                                }}
                                title="إعادة تعيين كلمة مرور المالك"
                                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 hover:bg-slate-100"
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                              </button>

                              <button
                                type="button"
                                disabled={backupBusyId === tenant.id}
                                onClick={() => void handleDownloadTenantBackup(tenant)}
                                title="تصدير نسخة احتياطية معزولة لهذه الصيدلية"
                                className="rounded-lg border border-indigo-200 bg-indigo-50 p-1.5 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleTriggerRestoreFile(tenant)}
                                title="استعادة نسخة احتياطية لهذه الصيدلية"
                                className="rounded-lg border border-amber-200 bg-amber-50 p-1.5 text-amber-700 hover:bg-amber-100"
                              >
                                <Upload className="h-3.5 w-3.5" />
                              </button>

                              {tenant.id !== 1 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setStatusConfirmTenant(tenant)}
                                    title={tenant.isActive ? 'تعليق / إيقاف الحساب' : 'تفعيل الحساب'}
                                    className={`rounded-lg p-1.5 transition ${
                                      tenant.isActive
                                        ? 'border border-orange-200 bg-orange-50 text-orange-600 hover:bg-orange-100'
                                        : 'border border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                                    }`}
                                  >
                                    {tenant.isActive ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setDeleteConfirmTenant(tenant)}
                                    title="حذف حساب الصيدلية نهائياً"
                                    className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-600 transition hover:bg-red-100"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* TAB 2: INDEPENDENT PLATFORM AUDIT LOGS */}
      {activeTab === 'audit' && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-sm font-bold text-slate-800">
              سجل التدقيق السيادي المستقل للمنصة (Platform Audit Logs)
            </h3>
            <p className="text-xs text-slate-500">
              يسجل عمليات إنشاء الصيدليات، تعديل الاشتراكات، التعليق والتفعيل، النسخ والاستعادة، ومحاولات الدخول الفاشلة.
            </p>
          </div>
          <div className="max-h-[540px] overflow-y-auto">
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 border-b border-slate-200 bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">الفاعل</th>
                  <th className="px-4 py-2.5">العملية</th>
                  <th className="px-4 py-2.5">الهدف</th>
                  <th className="px-4 py-2.5">التفاصيل</th>
                  <th className="px-4 py-2.5">الوقت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      لا توجد أحداث مسجلة في سجل المنصة حتى الآن.
                    </td>
                  </tr>
                ) : (
                  auditLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-slate-500">#{log.id}</td>
                      <td className="px-4 py-2 font-bold text-slate-800">{log.actor_name}</td>
                      <td className="px-4 py-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#0B4F9C]">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-slate-600">
                        {log.target_type} {log.target_id ? `#${log.target_id}` : ''}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{log.details}</td>
                      <td className="px-4 py-2 font-mono text-slate-500" dir="ltr">
                        {String(log.created_at || '').slice(0, 19).replace('T', ' ')}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: SERVER STATUS & DATABASE HEALTH */}
      {activeTab === 'system' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
              <Server className="h-5 w-5 text-[#0B4F9C]" />
              <span>مراقبة الخادم والبيئة التشغيلية</span>
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between rounded bg-slate-50 p-2.5">
                <span className="text-slate-500">محرك المنصة</span>
                <span className="font-bold text-slate-800">{serverStatus?.platform || 'itQAN Soft Cloud Engine'}</span>
              </div>
              <div className="flex justify-between rounded bg-slate-50 p-2.5">
                <span className="text-slate-500">بنية عزل قواعد البيانات</span>
                <span className="font-mono font-bold text-emerald-700" dir="ltr">
                  {serverStatus?.dbMode || 'Multi-Tenant Isolated SQLite'}
                </span>
              </div>
              <div className="flex justify-between rounded bg-slate-50 p-2.5">
                <span className="text-slate-500">إصدار Node.js</span>
                <span className="font-mono font-bold text-slate-800" dir="ltr">
                  {serverStatus?.nodeVersion || '—'}
                </span>
              </div>
              <div className="flex justify-between rounded bg-slate-50 p-2.5">
                <span className="text-slate-500">استهلاك الذاكرة (RSS)</span>
                <span className="font-mono font-bold text-slate-800" dir="ltr">
                  {serverStatus ? `${serverStatus.memoryRssMb} MB` : '—'}
                </span>
              </div>
              <div className="flex justify-between rounded bg-slate-50 p-2.5">
                <span className="text-slate-500">مدة التشغيل المتواصل (Uptime)</span>
                <span className="font-mono font-bold text-slate-800" dir="ltr">
                  {serverStatus ? `${Math.floor(serverStatus.uptimeSeconds / 60)}m ${serverStatus.uptimeSeconds % 60}s` : '—'}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <span>ضمانات الأمان والعزل متعدد المستأجرين</span>
            </div>
            <ul className="space-y-2 text-xs leading-relaxed text-slate-700">
              <li>• عزل فعلي في قاعدة البيانات عبر <code className="font-mono text-[#0B4F9C]">pharmacy_id</code> مستخلص حصراً من جلسة التوثيق بالخادم.</li>
              <li>• منع التلاعب بترويسة <code className="font-mono text-[#0B4F9C]">X-Pharmacy-Id</code> لأي مستخدم غير المطور العام.</li>
              <li>• كل صيدلية جديدة تبدأ ببيانات تشغيلية مصفّرة تماماً (0 أدوية، 0 مبيعات، 0 عملاء، 0 قيود).</li>
              <li>• دعم نسخ واستعادة قاعدة بيانات كل صيدلية بشكل مستقل دون التأثير على أي مستأجر آخر.</li>
              <li>• عند إيقاف أي صيدلية، يتم إنهاء جميع جلسات مستخدميها فوراً ومنعهم من الدخول.</li>
            </ul>
          </div>
        </div>
      )}

      {/* CREATE NEW PHARMACY MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-[#0B4F9C]">
                  <Building2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-800">إنشاء صيدلية جديدة وتجهيز البيئة المستقلة</h3>
                  <p className="text-xs text-slate-500">
                    سيتم إنشاء نسخة نظام مستقلة ببيانات نظيفة ومصفّرة (0 أدوية، 0 فواتير) وتعيين حساب المالك.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTenant} noValidate className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 text-xs font-bold text-slate-700">بيانات الصيدلية والهوية والموقع</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      اسم الصيدلية <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: صيدلية الأمل النموذجية"
                      value={pharmacyName}
                      onChange={(e) => setPharmacyName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">الاسم التجاري</label>
                    <input
                      type="text"
                      placeholder="شركة الأمل الطبية..."
                      value={tradeName}
                      onChange={(e) => setTradeName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">كود المستأجر الفريد (Tenant Code)</label>
                    <input
                      type="text"
                      dir="ltr"
                      placeholder="تلقائي إن ترك فارغاً (PHARM-AMAL)"
                      value={tenantCode}
                      onChange={(e) => setTenantCode(e.target.value.toUpperCase())}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">الهاتف / الموبايل</label>
                    <input
                      type="text"
                      dir="ltr"
                      placeholder="+966 50 123 4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">المدينة</label>
                    <input
                      type="text"
                      placeholder="الرياض / عدن / القاهرة..."
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">الدولة</label>
                    <input
                      type="text"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700">العنوان التفصيلي</label>
                    <input
                      type="text"
                      placeholder="الشارع - الحي..."
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-bold text-slate-700">شعار الصيدلية (اختياري)</label>
                  <div className="mt-1 flex items-center gap-3">
                    {logoBase64 ? (
                      <div className="relative h-14 w-14 overflow-hidden rounded-lg border border-slate-300 bg-white p-1">
                        <img src={logoBase64} alt="شعار" className="h-full w-full object-contain" />
                        <button
                          type="button"
                          onClick={() => setLogoBase64('')}
                          className="absolute right-0 top-0 rounded-bl bg-red-600 p-0.5 text-white"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:border-[#0B4F9C]">
                        <Upload className="h-4 w-4 text-[#0B4F9C]" />
                        <span>اختيار صورة الشعار (PNG, JPG, WebP)</span>
                        <input
                          type="file"
                          accept="image/png, image/jpeg, image/webp"
                          onChange={handleLogoUpload}
                          className="hidden"
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* Owner Account */}
              <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                <div className="mb-3 flex items-center gap-2 text-xs font-bold text-[#0B4F9C]">
                  <Lock className="h-4 w-4" />
                  <span>بيانات حساب مالك الصيدلية (Pharmacy Owner Credentials)</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      اسم المالك بالكامل <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="مثال: د. عبد الله السعيد"
                      value={ownerName}
                      onChange={(e) => setOwnerName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      اسم المستخدم للدخول <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      placeholder="dr_abdullah"
                      value={ownerUsername}
                      onChange={(e) => setOwnerUsername(e.target.value.toLowerCase())}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      كلمة المرور الأولية <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      dir="ltr"
                      placeholder="Pass@123456"
                      value={ownerPassword}
                      onChange={(e) => setOwnerPassword(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700">
                      تأكيد كلمة المرور <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="password"
                      required
                      dir="ltr"
                      placeholder="أعد كتابة كلمة المرور"
                      value={confirmOwnerPassword}
                      onChange={(e) => setConfirmOwnerPassword(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold text-slate-700">البريد الإلكتروني للمالك</label>
                    <input
                      type="email"
                      dir="ltr"
                      placeholder="owner@pharmacy.com"
                      value={ownerEmail}
                      onChange={(e) => setOwnerEmail(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs focus:border-[#0B4F9C] focus:outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Currency & Subscription */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <div className="mb-3 text-xs font-bold text-slate-700">العملة والاشتراك والبيانات الضريبية</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">رمز العملة (ISO)</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={currencyCode}
                      onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">رمز العرض</label>
                    <input
                      type="text"
                      value={currencySymbol}
                      onChange={(e) => setCurrencySymbol(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">اسم العملة</label>
                    <input
                      type="text"
                      value={currencyName}
                      onChange={(e) => setCurrencyName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">المنازل العشرية</label>
                    <select
                      value={currencyDecimals}
                      onChange={(e) => setCurrencyDecimals(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    >
                      <option value={0}>0</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">بداية الاشتراك</label>
                    <input
                      type="date"
                      dir="ltr"
                      value={subscriptionStart}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSubscriptionStart(val);
                        if (!licenseManuallyEdited) {
                          setLicenseExpiresAt(addMonthsDate(val, subscriptionMonths));
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">مدة الاشتراك (أشهر)</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={subscriptionMonths}
                      onChange={(e) => {
                        const m = Math.max(1, Number(e.target.value) || 12);
                        setSubscriptionMonths(m);
                        if (!licenseManuallyEdited) {
                          setLicenseExpiresAt(addMonthsDate(subscriptionStart, m));
                        }
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">تاريخ انتهاء الترخيص</label>
                    <input
                      type="date"
                      dir="ltr"
                      value={licenseExpiresAt}
                      onChange={(e) => {
                        setLicenseExpiresAt(e.target.value);
                        setLicenseManuallyEdited(true);
                      }}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                      placeholder="اتركه فارغاً لترخيص دائم"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
                      <input
                        type="checkbox"
                        checked={createIsActive}
                        onChange={(e) => setCreateIsActive(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-[#0B4F9C]"
                      />
                      <span>تفعيل الحساب مباشرة</span>
                    </label>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      setLicenseExpiresAt('');
                      setLicenseManuallyEdited(true);
                    }}
                    className="rounded border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 hover:bg-emerald-100 transition"
                  >
                    ✓ ترخيص دائم مفتوح (بدون تاريخ انتهاء)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setLicenseExpiresAt(addMonthsDate(subscriptionStart, 12));
                      setLicenseManuallyEdited(false);
                    }}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-100 transition"
                  >
                    ترخيص سنة (12 شهر)
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {licenseExpiresAt
                    ? `ينتهي الترخيص في ${licenseExpiresAt}. يظهر تنبيه لمالك الصيدلية قبل الانتهاء بـ 5 أيام.`
                    : 'الترخيص دائم ومفتوح للصيدلية بدون أي توقف أو انتهاء صلاحية.'}
                </p>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">الرقم الضريبي</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={taxNumber}
                      onChange={(e) => setTaxNumber(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">رقم الترخيص الدوائي</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={licenseNumber}
                      onChange={(e) => setLicenseNumber(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-bold text-slate-700">ملاحظات إدارية</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex items-center gap-2 rounded-xl bg-[#0B4F9C] px-5 py-2 text-xs font-bold text-white shadow transition hover:bg-[#083D7A] disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>جاري تهيئة البيئة...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>تأكيد وإنشاء الصيدلية</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT PHARMACY & SUBSCRIPTION MODAL */}
      {editModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="h-5 w-5 text-[#0B4F9C]" />
                <h3 className="font-black text-slate-900">تعديل وتغيير بيانات وترخيص: {editModalTenant.name}</h3>
              </div>
              <button type="button" onClick={() => setEditModalTenant(null)} className="text-slate-400 hover:text-slate-600">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditTenant} noValidate className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-700">اسم الصيدلية</label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">الاسم التجاري</label>
                  <input
                    type="text"
                    value={editTradeName}
                    onChange={(e) => setEditTradeName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">اسم المالك</label>
                  <input
                    type="text"
                    value={editOwnerName}
                    onChange={(e) => setEditOwnerName(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">اسم المستخدم للمالك (Username)</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editOwnerUsername}
                    onChange={(e) => setEditOwnerUsername(e.target.value.toLowerCase())}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">البريد الإلكتروني للمالك</label>
                  <input
                    type="email"
                    dir="ltr"
                    value={editOwnerEmail}
                    onChange={(e) => setEditOwnerEmail(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">الهاتف</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">المدينة</label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">الدولة</label>
                  <input
                    type="text"
                    value={editCountry}
                    onChange={(e) => setEditCountry(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700">العنوان</label>
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">الرقم الضريبي</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editTaxNumber}
                    onChange={(e) => setEditTaxNumber(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">رقم الترخيص</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={editLicenseNumber}
                    onChange={(e) => setEditLicenseNumber(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                  />
                </div>
              </div>

              {/* Currency & Logo Edit */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5">
                <div className="mb-2 text-xs font-bold text-slate-700">العملة الأساسية والشعار</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700">رمز العملة (ISO)</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={editCurrencyCode}
                      onChange={(e) => setEditCurrencyCode(e.target.value.toUpperCase())}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-1.5 font-mono text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700">رمز العرض</label>
                    <input
                      type="text"
                      value={editCurrencySymbol}
                      onChange={(e) => setEditCurrencySymbol(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700">اسم العملة</label>
                    <input
                      type="text"
                      value={editCurrencyName}
                      onChange={(e) => setEditCurrencyName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-700">المنازل العشرية</label>
                    <select
                      value={editCurrencyDecimals}
                      onChange={(e) => setEditCurrencyDecimals(Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-1.5 text-xs"
                    >
                      <option value={0}>0</option>
                      <option value={2}>2</option>
                      <option value={3}>3</option>
                      <option value={4}>4</option>
                    </select>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {editLogo ? (
                    <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-slate-300 bg-white p-1">
                      <img src={resolvePhotoSrc(editLogo)} alt="شعار الصيدلية" className="h-full w-full object-contain" />
                      <button
                        type="button"
                        onClick={() => setEditLogo('')}
                        title="حذف الشعار"
                        className="absolute right-0 top-0 rounded-bl bg-red-600 px-1 text-[10px] text-white"
                      >
                        ✕
                      </button>
                    </div>
                  ) : null}
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-[#0B4F9C]">
                    <Upload className="h-3.5 w-3.5 text-[#0B4F9C]" />
                    <span>{editLogo ? 'تغيير شعار الصيدلية' : 'رفع شعار للصيدلية'}</span>
                    <input
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      onChange={handleEditLogoUpload}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* License Expiration & Subscription */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3.5">
                <div className="mb-2 text-xs font-bold text-amber-900">
                  إعدادات الاشتراك وتاريخ انتهاء ترخيص استخدام النظام
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700">بداية الاشتراك</label>
                    <input
                      type="date"
                      dir="ltr"
                      value={editSubscriptionStart}
                      onChange={(e) => setEditSubscriptionStart(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">مدة الاشتراك (أشهر)</label>
                    <input
                      type="number"
                      min={1}
                      max={120}
                      value={editSubscriptionMonths}
                      onChange={(e) => setEditSubscriptionMonths(Math.max(1, Number(e.target.value) || 12))}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700">تاريخ انتهاء الترخيص</label>
                    <input
                      type="date"
                      dir="ltr"
                      value={editLicenseExpiresAt}
                      onChange={(e) => setEditLicenseExpiresAt(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs"
                    />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setEditLicenseExpiresAt(addDaysFromToday(5))}
                    className="rounded border border-amber-300 bg-white px-2 py-0.5 font-semibold text-amber-800 hover:bg-amber-100"
                  >
                    +5 أيام من اليوم
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditLicenseExpiresAt(addMonthsDate(new Date().toISOString().slice(0, 10), 12))}
                    className="rounded border border-emerald-300 bg-white px-2 py-0.5 font-semibold text-emerald-700 hover:bg-emerald-50"
                  >
                    تمديد سنة كاملة
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditLicenseExpiresAt('')}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    جعل الترخيص مفتوحاً
                  </button>
                </div>

                {editModalTenant.id !== 1 && (
                  <div className="mt-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-800">
                      <input
                        type="checkbox"
                        checked={editIsActive}
                        onChange={(e) => setEditIsActive(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-[#0B4F9C]"
                      />
                      <span>الحساب مفعّل ومسموح له بالدخول</span>
                    </label>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">ملاحظات</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditModalTenant(null)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="rounded-lg bg-[#0B4F9C] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#083D7A]"
                >
                  {editSubmitting ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUCCESS CREATED MODAL */}
      {createdTenantData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
              <div>
                <h3 className="text-lg font-black text-slate-900">تم إنشاء بيئة الصيدلية بنجاح!</h3>
                <p className="text-xs text-slate-500">تم عزل وتجهيز نسخة النظام بالكامل ببيانات مصفّرة ونظيفة.</p>
              </div>
            </div>

            <div className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-bold text-slate-700">بيانات تسجيل الدخول المخصصة لمالك الصيدلية:</div>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5">
                <div>
                  <span className="text-[11px] text-slate-500">اسم الصيدلية:</span>
                  <div className="font-bold text-slate-800">{createdTenantData.tenant.name}</div>
                </div>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
                  {createdTenantData.tenant.code}
                </span>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5">
                <div>
                  <span className="text-[11px] text-slate-500">اسم المستخدم (Username):</span>
                  <div className="font-mono font-bold text-[#0B4F9C]" dir="ltr">
                    {createdTenantData.tenant.ownerUsername}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(createdTenantData.tenant.ownerUsername, 'username')}
                  className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                >
                  {copiedField === 'username' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedField === 'username' ? 'تم النسخ' : 'نسخ'}</span>
                </button>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-2.5">
                <div>
                  <span className="text-[11px] text-slate-500">كلمة المرور الأولية (Password):</span>
                  <div className="font-mono font-bold text-slate-800" dir="ltr">
                    {createdTenantData.initialPassword}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => copyToClipboard(createdTenantData.initialPassword, 'password')}
                  className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                >
                  {copiedField === 'password' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedField === 'password' ? 'تم النسخ' : 'نسخ'}</span>
                </button>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setCreatedTenantData(null)}
                className="rounded-xl bg-[#0B4F9C] px-5 py-2 text-xs font-bold text-white hover:bg-[#083D7A]"
              >
                إغلاق والعودة للقائمة
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {resetModalTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-5 w-5 text-[#0B4F9C]" />
                <h3 className="font-black text-slate-900">إعادة تعيين كلمة مرور المالك</h3>
              </div>
              <button
                type="button"
                onClick={() => setResetModalTenant(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            {resetSuccessMessage ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                <span>{resetSuccessMessage}</span>
              </div>
            ) : (
              <form onSubmit={handleResetPassword} noValidate className="mt-4 space-y-4">
                <p className="text-xs text-slate-600">
                  إعادة تعيين كلمة المرور لمالك صيدلية <b>{resetModalTenant.name}</b> (المستخدم:{' '}
                  <span className="font-mono text-[#0B4F9C]" dir="ltr">
                    @{resetModalTenant.ownerUsername}
                  </span>
                  ):
                </p>
                <div>
                  <label className="block text-xs font-bold text-slate-700">كلمة المرور الجديدة</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    placeholder="أدخل كلمة مرور قوية..."
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs focus:border-[#0B4F9C] focus:outline-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setResetModalTenant(null)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    disabled={resetSubmitting}
                    className="rounded-lg bg-[#0B4F9C] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#083D7A]"
                  >
                    {resetSubmitting ? 'جاري الحفظ...' : 'تأكيد التغيير'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* CONFIRM SUSPEND / ACTIVATE MODAL */}
      <ConfirmModal
        open={Boolean(statusConfirmTenant)}
        title={statusConfirmTenant?.isActive ? 'تأكيد تعليق / إيقاف الصيدلية' : 'تأكيد تفعيل الصيدلية'}
        message={
          statusConfirmTenant?.isActive
            ? `هل أنت متأكد من تعليق وإيقاف حساب "${statusConfirmTenant.name}"؟ سيتم منع جميع مستخدميها من الدخول فوراً وإلغاء الجلسات المفتوحة.`
            : `هل تريد إعادة تفعيل حساب "${statusConfirmTenant?.name || ''}" والسماح لموظفيها بتسجيل الدخول؟`
        }
        confirmLabel={statusConfirmTenant?.isActive ? 'نعم، إيقاف الحساب' : 'نعم، تفعيل الحساب'}
        busy={statusBusy}
        onConfirm={() => void handleConfirmToggleStatus()}
        onCancel={() => setStatusConfirmTenant(null)}
      />

      {/* CONFIRM DELETE TENANT MODAL */}
      <ConfirmModal
        open={Boolean(deleteConfirmTenant)}
        title="تأكيد الحذف النهائي لحساب الصيدلية"
        message={`هل أنت متأكد من حذف حساب صيدلية "${deleteConfirmTenant?.name || ''}" (${deleteConfirmTenant?.code || ''}) نهائياً؟ سيتم حذف جميع المستخدمين والأدوية والفواتير والحسابات الخاصة بها فقط ولن تتأثر أي صيدلية أخرى أو ملفات النظام.`}
        confirmLabel="نعم، حذف الصيدلية نهائياً"
        busy={deleteBusy}
        onConfirm={() => void handleConfirmDeleteTenant()}
        onCancel={() => setDeleteConfirmTenant(null)}
      />

      {/* CONFIRM RESTORE TENANT BACKUP MODAL */}
      <ConfirmModal
        open={Boolean(pendingRestorePayload && restoreTargetTenant)}
        title={`استعادة نسخة احتياطية لصيدلية ${restoreTargetTenant?.name || ''}`}
        message={`هل أنت متأكد من استعادة بيانات ملف "${pendingRestoreFileName}" داخل صيدلية "${restoreTargetTenant?.name || ''}" (#${restoreTargetTenant?.id || ''}) فقط؟ لن تتأثر أي صيدلية أخرى بالمنصة.`}
        confirmLabel="نعم، استعادة الآن"
        busy={restoreBusy}
        onConfirm={() => void handleConfirmRestoreTenant()}
        onCancel={() => {
          setPendingRestorePayload(null);
          setPendingRestoreFileName('');
          setRestoreTargetTenant(null);
        }}
      />
    </div>
  );
};
