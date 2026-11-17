import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeftRight,
  Award,
  BarChart3,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  DatabaseBackup,
  FileWarning,
  FlaskConical,
  Gift,
  HardDriveDownload,
  Lock,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  Wallet,
  ScanBarcode,
  Wifi,
  Star,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type {
  BackupSnapshot,
  BatchTraceResult,
  BranchInfo,
  CartClinicalCheck,
  CashBox,
  Category,
  ControlledDispenseLog,
  DrugInteraction,
  DrugRecall,
  EnterpriseTabKey,
  HardwareAuditLogRecord,
  HardwareDeviceRecord,
  InsuranceClaim,
  InsuranceCompany,
  IntegrationConfig,
  InventoryItem,
  LoyaltyOverview,
  OperatingExpense,
  PageKey,
  PrintJobRecord,
  Promotion,
  SiteSettings,
  SmartAnalyticsData,
  SystemEvaluationData,
  User,
} from '../types';
import { formatMoney, hasPermission } from '../types';
import { ConfirmModal } from '../components/ConfirmModal';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import {
  checkLocalPrintBridgeHealth,
  getClientHardwareCapabilities,
  loadLocalTerminalConfig,
} from '../utils/localPrintService';
import { analyzeScannedCode, type ScannedPayloadEvent } from '../utils/scannerService';

interface EnterpriseModulesPageProps {
  user: User;
  site: SiteSettings;
  inventories: InventoryItem[];
  categories: Category[];
  initialTab: EnterpriseTabKey;
  onNavigate: (page: PageKey) => void;
  onDataMutated: () => Promise<void>;
  onDatabaseRestored: (restoredSite: SiteSettings, restoredUser: User) => Promise<void>;
}

const EXPENSE_CATEGORIES: Record<string, string> = {
  rent: 'إيجار ومرافق العقار',
  utilities: 'كهرباء ومياه واتصالات',
  cold_chain: 'صيانة سلسلة التبريد والتكييف',
  licensing: 'رسوم وتراخيص بلدية وصحية',
  packaging: 'مستلزمات تغليف وأكياس',
  maintenance: 'صيانة عامة وأجهزة',
  marketing: 'تسويق وحملات',
  other: 'مصروفات تشغيلية أخرى',
};

const TAB_ITEMS: Array<{
  key: EnterpriseTabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'evaluation', label: 'تقييم النظام والفجوات', icon: ClipboardCheck },
  { key: 'clinical', label: 'الرقابة السريرية والمقيدة', icon: ShieldAlert },
  { key: 'insurance', label: 'التأمين والمطالبات', icon: ShieldCheck },
  { key: 'recalls', label: 'التوريد والاستدعاءات', icon: FileWarning },
  { key: 'branches', label: 'إدارة الفروع المتعددة', icon: Building2 },
  { key: 'loyalty', label: 'العروض ونقاط الولاء', icon: Gift },
  { key: 'analytics', label: 'المصروفات ومؤشرات KPI', icon: TrendingUp },
  { key: 'integrations', label: 'الأجهزة والـ ZATCA والتعافي', icon: Cpu },
];

export const EnterpriseModulesPage: React.FC<EnterpriseModulesPageProps> = ({
  user,
  site,
  inventories,
  categories,
  initialTab,
  onNavigate,
  onDataMutated,
  onDatabaseRestored,
}) => {
  const [tab, setTab] = useState<EnterpriseTabKey>(initialTab);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // 0. Evaluation State
  const [evaluation, setEvaluation] = useState<SystemEvaluationData | null>(null);
  const [evalPreviewOpen, setEvalPreviewOpen] = useState(false);

  // 1 & 7. Clinical & Controlled
  const [interactions, setInteractions] = useState<DrugInteraction[]>([]);
  const [controlledLogs, setControlledLogs] = useState<ControlledDispenseLog[]>([]);
  const [controlledPreviewOpen, setControlledPreviewOpen] = useState(false);
  const [testMedIds, setTestMedIds] = useState<number[]>([]);
  const [clinicalCheckResult, setClinicalCheckResult] = useState<CartClinicalCheck | null>(null);
  const [newIntA, setNewIntA] = useState('');
  const [newIntB, setNewIntB] = useState('');
  const [newIntSeverity, setNewIntSeverity] = useState<'major' | 'moderate' | 'minor'>('major');
  const [newIntEffect, setNewIntEffect] = useState('');
  const [newIntRec, setNewIntRec] = useState('');

  const [ctrlMedId, setCtrlMedId] = useState<number>(inventories[0]?.id || 0);
  const [ctrlPatientName, setCtrlPatientName] = useState('');
  const [ctrlNationalId, setCtrlNationalId] = useState('');
  const [ctrlRxNumber, setCtrlRxNumber] = useState('');
  const [ctrlDoctorName, setCtrlDoctorName] = useState('');
  const [ctrlQty, setCtrlQty] = useState('1');

  // 2. Insurance
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [claims, setClaims] = useState<InsuranceClaim[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [selectedCashBoxId, setSelectedCashBoxId] = useState<number>(0);
  const [compName, setCompName] = useState('');
  const [compCode, setCompCode] = useState('');
  const [compPhone, setCompPhone] = useState('');
  const [compCovPct, setCompCovPct] = useState('80');
  const [compMaxLimit, setCompMaxLimit] = useState('5000');

  // 3. Recalls & Trace
  const [recalls, setRecalls] = useState<DrugRecall[]>([]);
  const [traceQuery, setTraceQuery] = useState('');
  const [traceResult, setTraceResult] = useState<BatchTraceResult | null>(null);
  const [rclMedId, setRclMedId] = useState<number>(inventories[0]?.id || 0);
  const [rclBatchNo, setRclBatchNo] = useState('');
  const [rclSource, setRclSource] = useState('sfda');
  const [rclSeverity, setRclSeverity] = useState('class_1');
  const [rclReason, setRclReason] = useState('');

  // 4. Branches
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [editingBranch, setEditingBranch] = useState<BranchInfo | null>(null);

  // 5. Promotions & Loyalty
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loyalty, setLoyalty] = useState<LoyaltyOverview | null>(null);
  const [promoName, setPromoName] = useState('');
  const [promoScope, setPromoScope] = useState<'all' | 'category' | 'medicine'>('all');
  const [promoTargetId, setPromoTargetId] = useState<string>('');
  const [promoPct, setPromoPct] = useState('10');
  const [promoMinQty, setPromoMinQty] = useState('1');
  const [promoEndDate, setPromoEndDate] = useState('');

  // 6 & 10. Operating Expenses & Smart Analytics
  const [smartAnalytics, setSmartAnalytics] = useState<SmartAnalyticsData | null>(null);
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [expTitle, setExpTitle] = useState('');
  const [expCat, setExpCat] = useState('utilities');
  const [expBranchId, setExpBranchId] = useState<number>(0);
  const [expCashBoxId, setExpCashBoxId] = useState<number>(0);
  const [expAmount, setExpAmount] = useState('');
  const [expRef, setExpRef] = useState('');

  // 8 & 9. Integrations, ZATCA & Disaster Recovery
  const [integrations, setIntegrations] = useState<IntegrationConfig[]>([]);
  const [editingIntegration, setEditingIntegration] = useState<IntegrationConfig | null>(null);
  const [editingConfigJson, setEditingConfigJson] = useState('{}');
  const [zatcaTotal, setZatcaTotal] = useState('115.00');
  const [zatcaVat, setZatcaVat] = useState('15.00');
  const [zatcaTlvResult, setZatcaTlvResult] = useState('');
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [restoreConfirmSnap, setRestoreConfirmSnap] = useState<BackupSnapshot | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // Hardware & Print Center State (Stages 6 & 7)
  const [hardwareDevices, setHardwareDevices] = useState<HardwareDeviceRecord[]>([]);
  const [printJobs, setPrintJobs] = useState<PrintJobRecord[]>([]);
  const [hardwareLogs, setHardwareLogs] = useState<HardwareAuditLogRecord[]>([]);
  const [newDevName, setNewDevName] = useState('');
  const [newDevType, setNewDevType] = useState<HardwareDeviceRecord['device_type']>('thermal_printer');
  const [newDevConn, setNewDevConn] = useState<HardwareDeviceRecord['connection_type']>('browser_print');
  const [newDevProtocol, setNewDevProtocol] = useState<HardwareDeviceRecord['protocol']>('ESCPOS');
  const [newDevHost, setNewDevHost] = useState('');
  const [newDevPort, setNewDevPort] = useState('9100');
  const [newDevPaperMm, setNewDevPaperMm] = useState('80');
  const [newDevDefault, setNewDevDefault] = useState(false);
  const [bridgeCheckStatus, setBridgeCheckStatus] = useState<{
    checked: boolean;
    reachable: boolean;
    reason: string;
    printers?: string[];
  } | null>(null);
  const [scannerTestInput, setScannerTestInput] = useState('');
  const [scannerTestResult, setScannerTestResult] = useState<{
    parsed: ScannedPayloadEvent;
    serverMatch?: { matchedMedicine?: Record<string, unknown> | null; matchedBatch?: Record<string, unknown> | null; matchedUnit?: { unitType: string; unitName: string; unitFactor: number } | null };
  } | null>(null);

  const canManageMeds = hasPermission(user, 'manageMedicines');
  const canPos = hasPermission(user, 'posBilling');
  const canManageCustomers = hasPermission(user, 'manageCustomers');
  const canManageAccounting = hasPermission(user, 'manageAccounting');
  const canManageBatches = hasPermission(user, 'manageBatches');
  const canManageWarehouses = hasPermission(user, 'manageWarehouses');
  const canManageSettings = hasPermission(user, 'manageSiteSettings');
  const canViewReports = hasPermission(user, 'viewReports');

  useEffect(() => {
    if (inventories.length > 0 && !inventories.some((m) => m.id === ctrlMedId)) {
      setCtrlMedId(inventories[0].id);
    }
    if (inventories.length > 0 && !inventories.some((m) => m.id === rclMedId)) {
      setRclMedId(inventories[0].id);
    }
  }, [inventories, ctrlMedId, rclMedId]);

  const loadActiveTab = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'evaluation') {
        const res = await api.getSystemEvaluation();
        setEvaluation(res);
      } else if (tab === 'clinical') {
        const [iRes, cRes] = await Promise.all([api.getInteractions(), api.getControlledLogs(200)]);
        setInteractions(iRes.interactions);
        setControlledLogs(cRes.logs);
      } else if (tab === 'insurance') {
        const tasks: Array<Promise<unknown>> = [api.getInsuranceCompanies(), api.getInsuranceClaims()];
        if (canManageAccounting) tasks.push(api.getAccounts());
        const results = await Promise.all(tasks);
        setCompanies((results[0] as { companies: InsuranceCompany[] }).companies);
        setClaims((results[1] as { claims: InsuranceClaim[] }).claims);
        if (results[2]) {
          const accRes = results[2] as { cashBoxes: CashBox[] };
          setCashBoxes(accRes.cashBoxes);
          const bank = accRes.cashBoxes.find((cb) => cb.box_type === 'bank') || accRes.cashBoxes[0];
          setSelectedCashBoxId((prev) =>
            accRes.cashBoxes.some((cb) => cb.id === prev) ? prev : bank?.id || 0,
          );
        }
      } else if (tab === 'recalls') {
        const res = await api.getRecalls();
        setRecalls(res.recalls);
      } else if (tab === 'branches') {
        const res = await api.getBranches();
        setBranches(res.branches);
      } else if (tab === 'loyalty') {
        const [pRes, lRes] = await Promise.all([api.getPromotions(), api.getLoyaltyOverview()]);
        setPromotions(pRes.promotions);
        setLoyalty(lRes);
      } else if (tab === 'analytics') {
        const [saRes, brRes, expRes, accRes] = await Promise.all([
          canViewReports ? api.getSmartAnalytics() : Promise.resolve(null),
          api.getBranches(),
          canManageAccounting ? api.getOperatingExpenses() : Promise.resolve({ expenses: [] }),
          canManageAccounting ? api.getAccounts() : Promise.resolve({ cashBoxes: [] }),
        ]);
        if (saRes) setSmartAnalytics(saRes);
        setBranches(brRes.branches);
        setExpenses(expRes.expenses);
        setCashBoxes(accRes.cashBoxes);
        setExpBranchId((prev) =>
          brRes.branches.some((b) => b.id === prev) ? prev : brRes.branches[0]?.id || 0,
        );
        setExpCashBoxId((prev) =>
          accRes.cashBoxes.some((cb) => cb.id === prev) ? prev : accRes.cashBoxes[0]?.id || 0,
        );
      } else if (tab === 'integrations') {
        const [intRes, snapRes, hwRes, pjRes] = await Promise.all([
          api.getIntegrations(),
          canManageSettings ? api.getBackupSnapshots() : Promise.resolve({ snapshots: [] }),
          api.getHardwareDevices(),
          api.getPrintJobs(),
        ]);
        setIntegrations(intRes.integrations);
        setSnapshots(snapRes.snapshots);
        setHardwareDevices(hwRes.devices);
        setPrintJobs(pjRes.jobs);
        setHardwareLogs(pjRes.logs);
      }
    } catch (err) {
      showErrorPopup(err, 'تحميل بيانات الوحدة المتقدمة');
    } finally {
      setLoading(false);
    }
  }, [tab, canManageAccounting, canViewReports, canManageSettings]);

  useEffect(() => {
    void loadActiveTab();
  }, [loadActiveTab]);

  const showSuccess = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 4000);
  };

  // Clinical Handlers
  const handleRunClinicalCheck = async () => {
    if (testMedIds.length < 2) {
      validationError(
        'يرجى تحديد دواءين على الأقل لفحص التداخلات السريرية',
        'فحص التداخلات الدوائية',
        ['لم يتم اختيار دواءين أو أكثر للمقارنة بين موادهما الفعالة.'],
        'اختر دواءين على الأقل من القائمة أعلاه ثم اضغط فحص الأدوية المحددة الآن.',
      );
      return;
    }
    try {
      const res = await api.clinicalCheckCart({ medicineIds: testMedIds });
      setClinicalCheckResult(res);
    } catch (err) {
      showErrorPopup(err, 'إجراء الفحص السريري للتداخلات');
    }
  };

  const handleAddInteraction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIntA.trim() || !newIntB.trim() || !newIntEffect.trim()) {
      validationError(
        'المادتان الفعالتان (أ و ب) والأثر السريري حقول مطلوبة',
        'إضافة قاعدة تداخل دوائي',
        ['أحد الحقول الأساسية لقاعدة التداخل الدوائي فارغ.'],
        'أدخل المادة الفعالة الأولى والثانية والأثر السريري قبل الحفظ.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.createInteraction({
        ingredientA: newIntA.trim(),
        ingredientB: newIntB.trim(),
        severity: newIntSeverity,
        clinicalEffect: newIntEffect.trim(),
        recommendation: newIntRec.trim(),
      });
      setNewIntA('');
      setNewIntB('');
      setNewIntEffect('');
      setNewIntRec('');
      showSuccess('تمت إضافة قاعدة التداخل الدوائي وتفعيلها في نقطة البيع');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'إضافة قاعدة تداخل دوائي');
    } finally {
      setBusyAction(false);
    }
  };

  const handleAddControlledLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ctrlMedId || !ctrlPatientName.trim() || !ctrlNationalId.trim() || !ctrlRxNumber.trim()) {
      validationError(
        'يجب تحديد الدواء وإدخال اسم المريض ورقم الهوية ورقم الوصفة المعتمدة',
        'توثيق صرف دواء مقيد',
        ['سجلات الأدوية المقيدة تتطلب اكتمال بيانات الهوية والوصفة الطبية قانونياً.'],
        'اختر الدواء وأكمل اسم المريض ورقم الهوية ورقم الوصفة.',
      );
      return;
    }
    const qty = Number(ctrlQty);
    if (!Number.isFinite(qty) || qty <= 0) {
      validationError(
        'الكمية المصروفة يجب أن تكون 1 على الأقل',
        'توثيق صرف دواء مقيد',
        ['قيمة الكمية المدخلة غير صالحة أو أقل من 1.'],
        'أدخل كمية صحيحة موجبة.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.createControlledLog({
        medicineId: ctrlMedId,
        patientName: ctrlPatientName.trim(),
        patientNationalId: ctrlNationalId.trim(),
        doctorName: ctrlDoctorName.trim(),
        prescriptionNumber: ctrlRxNumber.trim(),
        qty: Math.round(qty),
      });
      setCtrlPatientName('');
      setCtrlNationalId('');
      setCtrlRxNumber('');
      setCtrlDoctorName('');
      setCtrlQty('1');
      showSuccess('تم توثيق سجل الصرف الرقابي للدواء المقيد');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'توثيق صرف دواء مقيد');
    } finally {
      setBusyAction(false);
    }
  };

  // Insurance Handlers
  const handleAddInsuranceCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!compName.trim()) {
      validationError(
        'اسم شركة التأمين مطلوب',
        'إضافة شركة تأمين',
        ['لم يتم إدخال اسم شركة التأمين في الحقل المخصص.'],
        'أدخل اسم شركة التأمين ثم أعد المحاولة.',
      );
      return;
    }
    const covPct = Number(compCovPct);
    const maxLimit = Number(compMaxLimit);
    if (!Number.isFinite(covPct) || covPct < 0 || covPct > 100 || !Number.isFinite(maxLimit) || maxLimit < 0) {
      validationError(
        'نسبة التغطية (0–100%) والسقف الأعلى للمطالبة يجب أن يكونا أرقاماً صالحة',
        'إضافة شركة تأمين',
        ['نسبة التغطية خارج النطاق (0 إلى 100) أو السقف سالب.'],
        'تحقق من نسبة التغطية وسقف المطالبة وأعد الحفظ.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.createInsuranceCompany({
        name: compName.trim(),
        code: compCode.trim(),
        contactPhone: compPhone.trim(),
        defaultCoveragePct: covPct,
        maxClaimLimit: maxLimit,
      });
      setCompName('');
      setCompCode('');
      setCompPhone('');
      showSuccess('تمت إضافة شركة التأمين وتفعيلها');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'إضافة شركة تأمين');
    } finally {
      setBusyAction(false);
    }
  };

  const handleUpdateClaimStatus = async (claimId: number, status: InsuranceClaim['status']) => {
    if (status === 'paid' && !selectedCashBoxId) {
      validationError(
        'يرجى تحديد حساب الصندوق أو البنك المستلم للتحصيل',
        'تحصيل مطالبة تأمينية',
        ['لا يوجد صندوق أو حساب بنكي محدد للترحيل المحاسبي.'],
        'أضف صندوقاً أو حساباً بنكياً في وحدة المحاسبة ثم اختره قبل التحصيل.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.updateInsuranceClaimStatus(claimId, { status, cashBoxId: selectedCashBoxId });
      showSuccess(
        status === 'paid'
          ? 'تم تحصيل مطالبة التأمين وإثبات القيد المحاسبي بالبنك/الصندوق تلقائياً'
          : 'تم تحديث حالة المطالبة التأمينية',
      );
      await Promise.all([loadActiveTab(), onDataMutated()]);
    } catch (err) {
      showErrorPopup(err, 'تحديث حالة المطالبة التأمينية');
    } finally {
      setBusyAction(false);
    }
  };

  // Supply Chain & Recalls Handlers
  const handleTraceBatch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!traceQuery.trim()) {
      validationError(
        'يرجى إدخال رقم التشغيلة المطلوب تتبعها',
        'تتبع سلسلة التوريد للتشغيلة',
        ['حقل البحث عن رقم التشغيلة فارغ.'],
        'اكتب رقم التشغيلة أو جزءاً منه ثم اضغط تتبع التشغيلة.',
      );
      return;
    }
    setBusyAction(true);
    try {
      const res = await api.traceBatch(traceQuery.trim());
      setTraceResult(res);
    } catch (err) {
      showErrorPopup(err, 'تتبع التشغيلة الدوائية');
    } finally {
      setBusyAction(false);
    }
  };

  const handleCreateRecall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rclMedId || !rclBatchNo.trim() || !rclReason.trim()) {
      validationError(
        'يجب اختيار الدواء وإدخال رقم التشغيلة وسبب الاستدعاء',
        'إصدار استدعاء دوائي وعزل تشغيلة',
        ['أحد الحقول المطلوبة للاستدعاء الدوائي فارغ.'],
        'أكمل الدواء ورقم التشغيلة وسبب الاستدعاء والحجر الصحي.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.createRecall({
        medicineId: rclMedId,
        batchNumber: rclBatchNo.trim(),
        source: rclSource,
        severity: rclSeverity,
        reason: rclReason.trim(),
      });
      setRclBatchNo('');
      setRclReason('');
      showSuccess('تم إصدار الاستدعاء وحجز التشغيلة في الحجر الصحي ومنع بيعها فوراً');
      await Promise.all([loadActiveTab(), onDataMutated()]);
    } catch (err) {
      showErrorPopup(err, 'تنفيذ الاستدعاء الدوائي');
    } finally {
      setBusyAction(false);
    }
  };

  // Branches Handlers
  const handleSaveBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBranch) return;
    if (!editingBranch.name.trim()) {
      validationError(
        'اسم الفرع مطلوب ولا يمكن تركه فارغاً',
        'تعديل إعدادات الفرع',
        ['تم مسح اسم الفرع قبل الحفظ.'],
        'أدخل اسم الفرع ثم أعد الحفظ.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.updateBranch(editingBranch.id, {
        name: editingBranch.name.trim(),
        code: editingBranch.code,
        managerName: editingBranch.manager_name,
        phone: editingBranch.phone,
        location: editingBranch.location,
        isBranchPos: Boolean(editingBranch.is_branch_pos),
        targetDailySales: Math.max(0, Number(editingBranch.target_daily_sales || 0)),
      });
      setEditingBranch(null);
      showSuccess('تم تحديث إعدادات ومستهدفات الفرع بنجاح');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'تحديث إعدادات الفرع');
    } finally {
      setBusyAction(false);
    }
  };

  // Promotions Handlers
  const handleAddPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoName.trim()) {
      validationError(
        'اسم العرض الترويجي مطلوب',
        'إضافة عرض ترويجي',
        ['لم يتم إدخال اسم العرض الترويجي.'],
        'أدخل اسماً واضحاً للعرض مثل خصم العناية بالبشرة.',
      );
      return;
    }
    if (promoScope !== 'all' && !promoTargetId) {
      validationError(
        promoScope === 'category' ? 'يرجى اختيار التصنيف المستهدف للعرض' : 'يرجى اختيار الدواء المستهدف للعرض',
        'إضافة عرض ترويجي',
        ['نطاق العرض محدد على تصنيف أو دواء معين ولكن لم يتم اختيار العنصر من القائمة.'],
        'اختر التصنيف أو الصنف الدوائي المطلوب تفعيل العرض عليه.',
      );
      return;
    }
    const pct = Number(promoPct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
      validationError(
        'نسبة الخصم يجب أن تكون أكبر من 0 وأقل من أو تساوي 100%',
        'إضافة عرض ترويجي',
        ['قيمة نسبة الخصم خارج النطاق المسموح (1% إلى 100%).'],
        'أدخل نسبة خصم صحيحة.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.createPromotion({
        name: promoName.trim(),
        scope: promoScope,
        targetId: promoTargetId ? Number(promoTargetId) : null,
        discountPct: pct,
        minQty: Math.max(1, Number(promoMinQty) || 1),
        endDate: promoEndDate,
      });
      setPromoName('');
      setPromoTargetId('');
      showSuccess('تم إنشاء العرض الترويجي وتفعيله في نقطة البيع');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'إنشاء العرض الترويجي');
    } finally {
      setBusyAction(false);
    }
  };

  // Operating Expenses Handler
  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expTitle.trim()) {
      validationError(
        'بيان المصروف التشغيلي مطلوب',
        'ترحيل مصروف تشغيلي',
        ['لم يتم كتابة وصف أو بيان للمصروف.'],
        'أدخل بيان المصروف ثم أعد الترحيل.',
      );
      return;
    }
    const amt = Number(expAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      validationError(
        'مبلغ المصروف يجب أن يكون رقماً موجباً أكبر من الصفر',
        'ترحيل مصروف تشغيلي',
        ['المبلغ المدخل فارغ أو يساوي صفراً أو سالباً.'],
        'أدخل مبلغ المصروف الصحيح.',
      );
      return;
    }
    if (!expBranchId || !expCashBoxId) {
      validationError(
        'يرجى اختيار الفرع/المستودع والصندوق أو الحساب البنكي للصرف',
        'ترحيل مصروف تشغيلي',
        ['لم يتم العثور على فرع أو صندوق متاح لصرف المبلغ منه.'],
        'تأكد من وجود مستودع وصندوق مالي فعالين ثم اخترهما من القائمة.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.createOperatingExpense({
        title: expTitle.trim(),
        category: expCat,
        warehouseId: expBranchId,
        cashBoxId: expCashBoxId,
        amount: amt,
        receiptRef: expRef.trim(),
      });
      setExpTitle('');
      setExpAmount('');
      setExpRef('');
      showSuccess('تم قيد المصروف التشغيلي وربطه بمركز التكلفة والقيد المحاسبي');
      await Promise.all([loadActiveTab(), onDataMutated()]);
    } catch (err) {
      showErrorPopup(err, 'قيد مصروف تشغيلي');
    } finally {
      setBusyAction(false);
    }
  };

  // Integrations & Disaster Recovery Handlers
  const handleTestIntegration = async (key: string) => {
    setBusyAction(true);
    try {
      const res = await api.testIntegration(key);
      showSuccess(res.message);
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'اختبار التكامل الخارجي');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSaveIntegrationConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIntegration) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editingConfigJson) as Record<string, unknown>;
    } catch (parseErr) {
      validationError(
        'صيغة بيانات الإعدادات (JSON) غير صالحة',
        'حفظ إعدادات التكامل',
        [
          parseErr instanceof Error ? parseErr.message : 'خطأ في بناء كائن JSON',
          'تأكد من وجود علامات التنصيص المزدوجة " والأقواس بشكل صحيح.',
        ],
        'صحح صيغة JSON ثم أعد الحفظ.',
      );
      return;
    }
    setBusyAction(true);
    try {
      await api.updateIntegration(editingIntegration.integration_key, {
        enabled: Boolean(editingIntegration.enabled),
        config: parsed,
        notes: editingIntegration.notes,
      });
      setEditingIntegration(null);
      showSuccess('تم حفظ إعدادات التكامل بنجاح');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'حفظ إعدادات التكامل');
    } finally {
      setBusyAction(false);
    }
  };

  const handleGenerateZatcaTlv = async (e: React.FormEvent) => {
    e.preventDefault();
    const totalAmount = Number(zatcaTotal);
    const vatAmount = Number(zatcaVat);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0 || !Number.isFinite(vatAmount) || vatAmount < 0) {
      validationError(
        'يجب إدخال إجمالي فاتورة موجب ومبلغ ضريبة صالح لتوليد بصمة ZATCA TLV',
        'توليد رمز الفوترة الإلكترونية ZATCA TLV',
        ['مبلغ الإجمالي أو الضريبة غير رقمي أو أقل من الحد المسموح.'],
        'أدخل مبالغ صالحة ثم اضغط توليد بصمة TLV QR.',
      );
      return;
    }
    try {
      const res = await api.generateZatcaQr({
        totalAmount,
        vatAmount,
      });
      setZatcaTlvResult(res.tlvBase64);
    } catch (err) {
      showErrorPopup(err, 'توليد رمز الفوترة الإلكترونية ZATCA TLV');
    }
  };

  const handleCreateCheckpoint = async () => {
    setBusyAction(true);
    try {
      const res = await api.createBackupCheckpoint(checkpointLabel.trim() || undefined);
      setCheckpointLabel('');
      showSuccess(`تم إنشاء نقطة استعادة SHA-256: ${res.snapshot.file_name}`);
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'إنشاء نقطة استعادة سريعة');
    } finally {
      setBusyAction(false);
    }
  };

  const handleConfirmRestoreSnapshot = async () => {
    if (!restoreConfirmSnap) return;
    setBusyAction(true);
    try {
      const res = await api.restoreBackupSnapshot(restoreConfirmSnap.id);
      setRestoreConfirmSnap(null);
      await onDatabaseRestored(res.site, res.user);
      showSuccess(`تمت استعادة النظام بالكامل (${res.restoredRows} سجل) والتحقق من بصمة SHA-256`);
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'استعادة نقطة التعافي من الكوارث');
      setRestoreConfirmSnap(null);
    } finally {
      setBusyAction(false);
    }
  };

  // Hardware Center Handlers (Stages 6 & 7)
  const clientCapabilities = useMemo(() => getClientHardwareCapabilities(), []);

  const handleAddHardwareDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDevName.trim()) {
      validationError('يرجى إدخال اسم الجهاز الطرفي قبل الإضافة', 'إضافة جهاز طرفي', ['اسم الجهاز فارغ.']);
      return;
    }
    setBusyAction(true);
    try {
      await api.createHardwareDevice({
        name: newDevName.trim(),
        deviceType: newDevType,
        connectionType: newDevConn,
        protocol: newDevProtocol,
        host: newDevHost.trim(),
        port: Number(newDevPort) || 9100,
        paperWidthMm: Number(newDevPaperMm) || 80,
        labelWidthMm: newDevType === 'label_printer' ? 50 : 80,
        labelHeightMm: newDevType === 'label_printer' ? 25 : 0,
        isDefault: newDevDefault,
        terminalId: loadLocalTerminalConfig().terminalId,
      });
      setNewDevName('');
      setNewDevHost('');
      setNewDevDefault(false);
      showSuccess('تم تسجيل الجهاز الطرفي في مركز الأجهزة بنجاح');
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'إضافة جهاز طرفي');
    } finally {
      setBusyAction(false);
    }
  };

  const handleSetDefaultDevice = async (dev: HardwareDeviceRecord) => {
    setBusyAction(true);
    try {
      await api.updateHardwareDevice(dev.id, { isDefault: true });
      showSuccess(`تم تعيين "${dev.name}" كجهاز افتراضي للنظام`);
      await loadActiveTab();
    } catch (err) {
      showErrorPopup(err, 'تعيين الجهاز الافتراضي');
    } finally {
      setBusyAction(false);
    }
  };

  const handleProbeBridgeAndDevice = async (dev?: HardwareDeviceRecord) => {
    setBusyAction(true);
    try {
      const cfg = loadLocalTerminalConfig();
      const probe = await checkLocalPrintBridgeHealth(cfg.bridgeUrl);
      setBridgeCheckStatus({ checked: true, ...probe });
      if (dev) {
        await api.recordHardwareAudit(dev.id, {
          eventType: 'client_bridge_probe',
          transport: dev.connection_type,
          status: probe.reachable ? 'bridge_online' : 'browser_fallback',
          details: probe.reason,
        });
        await loadActiveTab();
      }
    } catch (err) {
      showErrorPopup(err, 'فحص الجسر المحلي للطباعة');
    } finally {
      setBusyAction(false);
    }
  };

  const handleScannerLiveTest = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const raw = scannerTestInput;
    if (!raw.trim()) return;
    const analyzed = analyzeScannedCode(raw);
    try {
      const srv = await api.parseGs1Barcode(raw);
      setScannerTestResult({ parsed: analyzed, serverMatch: srv });
      const scannerDev = hardwareDevices.find((d) => d.device_type === 'barcode_scanner');
      if (scannerDev) {
        await api.recordHardwareAudit(scannerDev.id, {
          eventType: 'hid_scan_test',
          transport: 'usb_hid',
          status: 'verified_by_user_scan',
          details: `فحص رمز ${analyzed.symbology}: ${analyzed.normalized}${srv.matchedMedicine ? ` (تطابق مع: ${String(srv.matchedMedicine.name)})` : ' (لم يطابق صنفاً مسجلاً)'}`,
        });
        const pjRes = await api.getPrintJobs();
        setHardwareLogs(pjRes.logs);
        const hwRes = await api.getHardwareDevices();
        setHardwareDevices(hwRes.devices);
      }
    } catch (err) {
      showErrorPopup(err, 'تحليل مسح الماسح الضوئي');
    }
  };

  const handleUpdatePrintJobStatus = async (jobId: number, status: PrintJobRecord['status']) => {
    setBusyAction(true);
    try {
      await api.updatePrintJob(jobId, { status });
      const pjRes = await api.getPrintJobs();
      setPrintJobs(pjRes.jobs);
    } catch (err) {
      showErrorPopup(err, 'تحديث حالة مهمة الطباعة');
    } finally {
      setBusyAction(false);
    }
  };

  const activeTabMeta = useMemo(() => TAB_ITEMS.find((t) => t.key === tab) || TAB_ITEMS[0], [tab]);

  return (
    <div className="space-y-4">
      {/* Header Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#DCE4F0] bg-white px-4 py-3 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EDF4FC] text-[#0B4F9C]">
            <activeTabMeta.icon className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900 sm:text-lg">
              {tab === 'evaluation'
                ? 'تقييم النظام الحالي وتحديد الفجوات والجاهزية التشغيلية'
                : `مركز التوسعات والوحدات المتقدمة — ${activeTabMeta.label}`}
            </h1>
            <p className="text-xs text-slate-500">
              منصة إتقان سوفت المتكاملة: 7 وحدات أساسية + 10 وحدات توسعية مترابطة مع قاعدة البيانات
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadActiveTab()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-[#0B4F9C] ${loading ? 'animate-spin' : ''}`} />
          <span>تحديث البيانات الحية</span>
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-[#DCE4F0] bg-white p-2 shadow-xs">
        {TAB_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = tab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setTab(item.key);
              }}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold transition ${
                active
                  ? 'bg-[#0B4F9C] text-white shadow-xs'
                  : 'bg-[#F3F6FA] text-slate-700 hover:bg-[#EDF4FC] hover:text-[#0B4F9C]'
              }`}
            >
              <Icon className={`h-3.5 w-3.5 ${active ? 'text-[#F97316]' : 'text-[#0B4F9C]'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-[#DCE4F0] bg-white p-10 text-center text-sm text-slate-500">
          جاري قراءة البيانات وتحليل المؤشرات من قاعدة البيانات...
        </div>
      ) : (
        <>
          {/* ================================================================
              TAB 0: SYSTEM EVALUATION & GAP CLOSURE
             ================================================================ */}
          {tab === 'evaluation' && evaluation && (
            <div className="space-y-4">
              {/* Top Scorecards */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500">الجاهزية الإجمالية للنظام</span>
                    <Award className="h-5 w-5 text-[#F97316]" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <span className="text-3xl font-extrabold text-[#0B4F9C]">{evaluation.overallScore}%</span>
                    <span className="text-xs font-semibold text-emerald-700">تغطية تشغيلية متكاملة</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-[#0B4F9C] transition-all"
                      style={{ width: `${evaluation.overallScore}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500">الوحدات الأساسية (7 وحدات)</span>
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <span className="text-3xl font-extrabold text-emerald-700">{evaluation.overallCoreScore}%</span>
                    <span className="text-xs text-slate-500">تغطية جيدة ومستقرة</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-emerald-600 transition-all"
                      style={{ width: `${evaluation.overallCoreScore}%` }}
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500">مجالات التوسع المستكملة (10 مجالات)</span>
                    <Sparkles className="h-5 w-5 text-[#0B4F9C]" />
                  </div>
                  <div className="mt-2 flex items-baseline gap-2 tabular-nums">
                    <span className="text-3xl font-extrabold text-[#083D7A]">{evaluation.overallExpansionScore}%</span>
                    <span className="text-xs text-slate-500">تم بناء الجداول والواجهات والربط</span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full bg-[#F97316] transition-all"
                      style={{ width: `${evaluation.overallExpansionScore}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Operational Live Findings */}
              {evaluation.operationalFindings.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h2 className="flex items-center gap-2 text-sm font-bold text-amber-900">
                      <Activity className="h-4 w-4 text-[#F97316]" />
                      <span>تنبيهات وتوصيات تشغيلية حية بناءً على فحص قاعدة البيانات الآن</span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => setEvalPreviewOpen(true)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <Printer className="h-3.5 w-3.5 text-[#0B4F9C]" />
                      <span>طباعة تقرير التقييم</span>
                    </button>
                  </div>
                  <div className="space-y-2">
                    {evaluation.operationalFindings.map((f, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-200 bg-white px-3 py-2 text-xs"
                      >
                        <span className="font-semibold text-slate-800">{f.title}</span>
                        <button
                          type="button"
                          onClick={() => setTab(f.targetTab)}
                          className="rounded bg-[#0B4F9C] px-2.5 py-1 font-bold text-white hover:bg-[#083D7A]"
                        >
                          {f.actionLabel}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Matrix 1: Core 7 Modules */}
              <div className="rounded-lg border border-[#DCE4F0] bg-white shadow-xs">
                <div className="flex items-center justify-between border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-2.5">
                  <h2 className="text-sm font-bold text-slate-800">
                    أولاً: الوحدات الأساسية الموجودة (تغطية جيدة — 7 وحدات)
                  </h2>
                  <span className="text-xs font-bold text-emerald-700 tabular-nums">
                    متوسط الإنجاز: {evaluation.overallCoreScore}%
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="border-b px-3 py-2.5">الوحدة</th>
                        <th className="border-b px-3 py-2.5">الأدلة الفعلية من قاعدة البيانات</th>
                        <th className="border-b px-3 py-2.5">الحالة</th>
                        <th className="border-b px-3 py-2.5">النسبة</th>
                        <th className="border-b px-3 py-2.5">انتقال</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {evaluation.coreModules.map((m) => (
                        <tr key={m.key} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-bold text-slate-900">{m.title}</td>
                          <td className="px-3 py-2.5 text-slate-600">{m.evidence}</td>
                          <td className="px-3 py-2.5">
                            <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">
                              مكتملة وفعّالة
                            </span>
                          </td>
                          <td className="px-3 py-2.5 font-bold tabular-nums text-[#0B4F9C]">{m.score}%</td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => onNavigate(m.actionPage)}
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700 hover:bg-[#EDF4FC] hover:text-[#0B4F9C]"
                            >
                              فتح الوحدة
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Matrix 2: 10 Expansion Modules (Gap Closure) */}
              <div className="rounded-lg border border-[#DCE4F0] bg-white shadow-xs">
                <div className="flex items-center justify-between border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-2.5">
                  <h2 className="text-sm font-bold text-slate-800">
                    ثانياً: المجالات العشرة التي كانت تحتاج استكمالاً وتوسعاً (تم بناء وسد الفجوات بالكامل)
                  </h2>
                  <span className="text-xs font-bold text-[#0B4F9C] tabular-nums">
                    متوسط الجاهزية: {evaluation.overallExpansionScore}%
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="border-b px-3 py-2.5">#</th>
                        <th className="border-b px-3 py-2.5">المجال التوسعي</th>
                        <th className="border-b px-3 py-2.5">التقييم قبل التطوير</th>
                        <th className="border-b px-3 py-2.5">التطبيق الفعلي الحالي</th>
                        <th className="border-b px-3 py-2.5">النسبة</th>
                        <th className="border-b px-3 py-2.5">الإدارة والتشغيل</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {evaluation.expansionModules.map((ex, idx) => (
                        <tr key={ex.key} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-mono text-slate-500">{idx + 1}</td>
                          <td className="px-3 py-2.5 font-bold text-slate-900">{ex.title}</td>
                          <td className="px-3 py-2.5">
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                              {ex.previousGap}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{ex.details}</td>
                          <td className="px-3 py-2.5 font-bold tabular-nums text-emerald-700">{ex.score}%</td>
                          <td className="px-3 py-2.5">
                            <button
                              type="button"
                              onClick={() => setTab(ex.tab)}
                              className="rounded bg-[#0B4F9C] px-2.5 py-1 font-bold text-white hover:bg-[#083D7A]"
                            >
                              تشغيل / إدارة
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 1 & 7: CLINICAL VIGILANCE & CONTROLLED DRUGS
             ================================================================ */}
          {tab === 'clinical' && (
            <div className="space-y-4">
              {/* Interactive Clinical Interaction Simulator */}
              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-[#0B4F9C]" />
                    <h2 className="text-sm font-bold text-slate-800">فاحص التداخلات الدوائية التفاعلي (يعمل تلقائياً أيضاً داخل POS)</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRunClinicalCheck()}
                    className="rounded bg-[#0B4F9C] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#083D7A]"
                  >
                    فحص الأدوية المحددة الآن
                  </button>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {inventories.slice(0, 20).map((m) => {
                    const checked = testMedIds.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() =>
                          setTestMedIds((prev) =>
                            checked ? prev.filter((id) => id !== m.id) : [...prev, m.id],
                          )
                        }
                        className={`rounded border px-2.5 py-1 text-xs font-semibold transition ${
                          checked
                            ? 'border-[#0B4F9C] bg-[#EDF4FC] text-[#0B4F9C]'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        {m.name} {m.scientificName ? `(${m.scientificName})` : ''}
                      </button>
                    );
                  })}
                </div>
                {clinicalCheckResult && (
                  <div className="rounded border border-slate-200 bg-[#F3F6FA] p-3 text-xs">
                    {clinicalCheckResult.interactionWarnings.length === 0 &&
                    clinicalCheckResult.alerts.length === 0 &&
                    clinicalCheckResult.controlledMedicines.length === 0 ? (
                      <div className="flex items-center gap-2 font-bold text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" />
                        <span>لا توجد تداخلات دوائية مسجلة بين الأصناف المختارة.</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {clinicalCheckResult.interactionWarnings.map((w, i) => (
                          <div key={i} className="rounded border border-red-200 bg-red-50 p-2 text-red-900">
                            <div className="font-bold">
                              تحذير تداخل ({w.severity === 'major' ? 'خطير' : w.severity === 'moderate' ? 'متوسط' : 'بسيط'}): {w.pair}
                            </div>
                            <div>الأثر السريري: {w.effect}</div>
                            {w.recommendation && <div className="text-slate-700">التوصية: {w.recommendation}</div>}
                          </div>
                        ))}
                        {clinicalCheckResult.controlledMedicines.map((cm) => (
                          <div key={cm.id} className="rounded border border-amber-300 bg-amber-50 p-2 font-bold text-amber-900">
                            دواء مقيد بالرقابة ({cm.schedule}): {cm.name} — يتطلب هوية وطنية ووصفة عند البيع في POS.
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* Drug Interaction Rules */}
                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                    قواعد التداخلات الدوائية الفعّالة ({interactions.length})
                  </h3>
                  {canManageMeds && (
                    <form onSubmit={handleAddInteraction} noValidate className="mb-4 grid grid-cols-1 gap-2 rounded border border-slate-200 bg-[#F3F6FA] p-3 text-xs sm:grid-cols-2">
                      <input
                        type="text"
                        required
                        value={newIntA}
                        onChange={(e) => setNewIntA(e.target.value)}
                        placeholder="المادة الفعالة (أ) مثال: Warfarin"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        required
                        value={newIntB}
                        onChange={(e) => setNewIntB(e.target.value)}
                        placeholder="المادة الفعالة (ب) مثال: Aspirin"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <select
                        value={newIntSeverity}
                        onChange={(e) => setNewIntSeverity(e.target.value as 'major' | 'moderate' | 'minor')}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="major">خطير (Major)</option>
                        <option value="moderate">متوسط (Moderate)</option>
                        <option value="minor">طفيف (Minor)</option>
                      </select>
                      <input
                        type="text"
                        required
                        value={newIntEffect}
                        onChange={(e) => setNewIntEffect(e.target.value)}
                        placeholder="الأثر السريري..."
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        value={newIntRec}
                        onChange={(e) => setNewIntRec(e.target.value)}
                        placeholder="التوصية الصيدلانية..."
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 sm:col-span-2"
                      />
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="rounded bg-[#0B4F9C] py-1.5 font-bold text-white hover:bg-[#083D7A] sm:col-span-2"
                      >
                        إضافة قاعدة تداخل دوائي
                      </button>
                    </form>
                  )}
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {interactions.map((r) => (
                      <div key={r.id} className="flex items-start justify-between gap-2 rounded border border-slate-200 p-2.5 text-xs">
                        <div>
                          <div className="font-bold text-slate-900">
                            <span dir="ltr">{r.ingredient_a}</span> × <span dir="ltr">{r.ingredient_b}</span>
                            <span
                              className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                r.severity === 'major'
                                  ? 'bg-red-100 text-red-800'
                                  : r.severity === 'moderate'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {r.severity}
                            </span>
                          </div>
                          <div className="mt-1 text-slate-700">{r.clinical_effect}</div>
                          {r.recommendation && <div className="text-slate-500">التوصية: {r.recommendation}</div>}
                        </div>
                        {canManageMeds && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.deleteInteraction(r.id);
                                await loadActiveTab();
                              } catch (err) {
                                showErrorPopup(err, 'حذف قاعدة التداخل الدوائي');
                              }
                            }}
                            className="rounded p-1 text-red-600 hover:bg-red-50"
                            title="حذف القاعدة"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Controlled Substances Register */}
                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                      <Lock className="h-4 w-4 text-red-600" />
                      <span>سجل صرف الأدوية المقيدة والمراقبة ({controlledLogs.length})</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => setControlledPreviewOpen(true)}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700"
                    >
                      <Printer className="h-3.5 w-3.5 text-[#0B4F9C]" />
                      <span>طباعة السجل الرقابي</span>
                    </button>
                  </div>
                  {canPos && (
                    <form onSubmit={handleAddControlledLog} noValidate className="mb-4 grid grid-cols-1 gap-2 rounded border border-amber-200 bg-amber-50/50 p-3 text-xs sm:grid-cols-2">
                      <select
                        value={ctrlMedId}
                        onChange={(e) => setCtrlMedId(Number(e.target.value))}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5 sm:col-span-2"
                      >
                        {inventories.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} {m.isControlled ? `[مقيد: ${m.controlledSchedule}]` : ''}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        value={ctrlPatientName}
                        onChange={(e) => setCtrlPatientName(e.target.value)}
                        placeholder="اسم المريض الكامل *"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <input
                        type="text"
                        required
                        dir="ltr"
                        value={ctrlNationalId}
                        onChange={(e) => setCtrlNationalId(e.target.value)}
                        placeholder="رقم الهوية / الإقامة *"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-left"
                      />
                      <input
                        type="text"
                        required
                        value={ctrlRxNumber}
                        onChange={(e) => setCtrlRxNumber(e.target.value)}
                        placeholder="رقم الوصفة المعتمدة *"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={ctrlDoctorName}
                          onChange={(e) => setCtrlDoctorName(e.target.value)}
                          placeholder="اسم الطبيب"
                          className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                        />
                        <input
                          type="number"
                          min={1}
                          value={ctrlQty}
                          onChange={(e) => setCtrlQty(e.target.value)}
                          className="w-16 rounded border border-slate-300 bg-white px-2 py-1.5 text-center"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="rounded bg-red-700 py-1.5 font-bold text-white hover:bg-red-800 sm:col-span-2"
                      >
                        توثيق قيد صرف دواء مقيد
                      </button>
                    </form>
                  )}

                  <div className="max-h-80 overflow-y-auto overflow-x-auto">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="border-b px-2 py-2">الدواء</th>
                          <th className="border-b px-2 py-2">المريض والهوية</th>
                          <th className="border-b px-2 py-2">الوصفة / الكمية</th>
                          <th className="border-b px-2 py-2">الصيدلاني والتاريخ</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {controlledLogs.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                              لا توجد عمليات صرف مقيدة مسجلة بعد.
                            </td>
                          </tr>
                        ) : (
                          controlledLogs.map((l) => (
                            <tr key={l.id}>
                              <td className="px-2 py-2 font-bold text-slate-900">
                                {l.medicine_name}
                                <div className="text-[10px] text-red-700">{l.schedule}</div>
                              </td>
                              <td className="px-2 py-2">
                                {l.patient_name}
                                <div className="font-mono text-[11px] text-slate-500">{l.patient_national_id}</div>
                              </td>
                              <td className="px-2 py-2">
                                {l.prescription_number} ({l.qty})
                              </td>
                              <td className="px-2 py-2 text-[11px] text-slate-600">
                                {l.pharmacist_name}
                                <div className="font-mono">{l.dispensed_at}</div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 2: INSURANCE COMPANIES & CLAIMS
             ================================================================ */}
          {tab === 'insurance' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  شركات التأمين المعتمدة ({companies.length})
                </h3>
                {canManageCustomers && (
                  <form onSubmit={handleAddInsuranceCompany} noValidate className="mb-4 space-y-2 rounded border border-slate-200 bg-[#F3F6FA] p-3 text-xs">
                    <input
                      type="text"
                      required
                      value={compName}
                      onChange={(e) => setCompName(e.target.value)}
                      placeholder="اسم شركة التأمين *"
                      className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        dir="ltr"
                        value={compCode}
                        onChange={(e) => setCompCode(e.target.value)}
                        placeholder="الرمز (BUPA)"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5 text-left"
                      />
                      <input
                        type="text"
                        value={compPhone}
                        onChange={(e) => setCompPhone(e.target.value)}
                        placeholder="هاتف التواصل"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={compCovPct}
                        onChange={(e) => setCompCovPct(e.target.value)}
                        placeholder="نسبة التغطية %"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                      <input
                        type="number"
                        min={0}
                        value={compMaxLimit}
                        onChange={(e) => setCompMaxLimit(e.target.value)}
                        placeholder="السقف للمطالبة"
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="w-full rounded bg-[#0B4F9C] py-1.5 font-bold text-white hover:bg-[#083D7A]"
                    >
                      إضافة شركة تأمين
                    </button>
                  </form>
                )}

                <div className="space-y-2">
                  {companies.map((c) => (
                    <div key={c.id} className="rounded border border-slate-200 p-2.5 text-xs">
                      <div className="flex items-center justify-between font-bold text-slate-900">
                        <span>
                          {c.name} <span className="font-mono text-slate-500">({c.code || '-'})</span>
                        </span>
                        <span className={c.is_active ? 'text-emerald-700' : 'text-red-600'}>
                          {c.is_active ? 'نشطة' : 'موقفة'}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap justify-between gap-2 text-slate-600 tabular-nums">
                        <span>التغطية: {c.default_coverage_pct}% (سقف {formatMoney(c.max_claim_limit, site.currencySymbol)})</span>
                        <span className="font-bold text-[#0B4F9C]">
                          ذمة مستحقة: {formatMoney(c.balance, site.currencySymbol)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs lg:col-span-2">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <h3 className="text-sm font-bold text-slate-800">
                    سجل المطالبات التأمينية ({claims.length})
                  </h3>
                  {canManageAccounting && cashBoxes.length > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-bold text-slate-600">حساب التحصيل:</span>
                      <select
                        value={selectedCashBoxId}
                        onChange={(e) => setSelectedCashBoxId(Number(e.target.value))}
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                      >
                        {cashBoxes.map((cb) => (
                          <option key={cb.id} value={cb.id}>
                            {cb.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr>
                        <th className="border-b px-2.5 py-2">رقم المطالبة</th>
                        <th className="border-b px-2.5 py-2">شركة التأمين</th>
                        <th className="border-b px-2.5 py-2">المؤمن له / البوليصة</th>
                        <th className="border-b px-2.5 py-2">حصة التأمين</th>
                        <th className="border-b px-2.5 py-2">تحمل المريض</th>
                        <th className="border-b px-2.5 py-2">الحالة</th>
                        {canManageAccounting && <th className="border-b px-2.5 py-2">إجراء التحصيل</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {claims.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-slate-500">
                            لا توجد مطالبات تأمينية مسجلة بعد — اختر شركة تأمين عند إتمام الفاتورة في نقطة البيع.
                          </td>
                        </tr>
                      ) : (
                        claims.map((cl) => (
                          <tr key={cl.id} className="hover:bg-slate-50">
                            <td className="px-2.5 py-2 font-mono font-bold text-[#0B4F9C]">{cl.claim_number}</td>
                            <td className="px-2.5 py-2 font-semibold">{cl.insurance_name}</td>
                            <td className="px-2.5 py-2">
                              {cl.customer_name}
                              <div className="font-mono text-[10px] text-slate-500">
                                {cl.policy_number || '-'} {cl.approval_code ? `· موافقة ${cl.approval_code}` : ''}
                              </div>
                            </td>
                            <td className="px-2.5 py-2 font-bold tabular-nums text-[#0B4F9C]">
                              {formatMoney(cl.insurance_share, site.currencySymbol)}
                            </td>
                            <td className="px-2.5 py-2 tabular-nums">
                              {formatMoney(cl.patient_copay, site.currencySymbol)}
                            </td>
                            <td className="px-2.5 py-2">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                  cl.status === 'paid'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : cl.status === 'approved'
                                      ? 'bg-sky-100 text-sky-800'
                                      : cl.status === 'rejected'
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {cl.status === 'paid'
                                  ? 'محصلة محاسبياً'
                                  : cl.status === 'approved'
                                    ? 'معتمدة'
                                    : cl.status === 'rejected'
                                      ? 'مرفوضة'
                                      : 'قيد المطالبة'}
                              </span>
                            </td>
                            {canManageAccounting && (
                              <td className="px-2.5 py-2">
                                {cl.status !== 'paid' && (
                                  <div className="flex flex-wrap gap-1">
                                    {cl.status !== 'approved' && (
                                      <button
                                        type="button"
                                        disabled={busyAction}
                                        onClick={() => void handleUpdateClaimStatus(cl.id, 'approved')}
                                        className="rounded bg-sky-600 px-2 py-1 text-[11px] font-bold text-white"
                                      >
                                        اعتماد
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      disabled={busyAction}
                                      onClick={() => void handleUpdateClaimStatus(cl.id, 'paid')}
                                      className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white"
                                    >
                                      تحصيل بالبنك
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 3: SUPPLY CHAIN TRACEABILITY & DRUG RECALLS
             ================================================================ */}
          {tab === 'recalls' && (
            <div className="space-y-4">
              {/* Batch Trace Engine */}
              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                <h3 className="mb-2 text-sm font-bold text-slate-800">
                  محرك تتبع سلسلة التوريد الشامل للتشغيلة (End-to-End Batch Traceability)
                </h3>
                <form onSubmit={handleTraceBatch} noValidate className="flex flex-wrap gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      type="text"
                      dir="ltr"
                      value={traceQuery}
                      onChange={(e) => setTraceQuery(e.target.value)}
                      placeholder="أدخل رقم التشغيلة أو جزءاً منه (مثال: B-2026) لتتبع المورد، المخزن، الحركات، وفواتير المرضى..."
                      className="w-full rounded border border-slate-300 bg-white py-2 pr-9 pl-3 text-left text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busyAction}
                    className="rounded bg-[#0B4F9C] px-5 py-2 text-sm font-bold text-white hover:bg-[#083D7A]"
                  >
                    تتبع التشغيلة
                  </button>
                </form>

                {traceResult && (
                  <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                    <div className="rounded border border-slate-200 bg-[#F3F6FA] p-3">
                      <div className="mb-1.5 font-bold text-[#0B4F9C]">
                        التشغيلات الموجودة بالمخازن ({traceResult.batches.length})
                      </div>
                      {traceResult.batches.map((b) => (
                        <div key={b.id} className="mb-1 rounded bg-white p-2">
                          <div className="font-bold">{b.medicine_name}</div>
                          <div className="font-mono text-[11px] text-slate-600">
                            {b.batch_number} · المتبقي: {b.qty_remaining} · الحالة: {b.status}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded border border-slate-200 bg-[#F3F6FA] p-3">
                      <div className="mb-1.5 font-bold text-[#0B4F9C]">
                        أوامر الشراء والموردين ({traceResult.purchaseOrders.length})
                      </div>
                      {traceResult.purchaseOrders.map((po, i) => (
                        <div key={i} className="mb-1 rounded bg-white p-2">
                          <div className="font-bold">{String(po.supplier_name)}</div>
                          <div className="text-[11px] text-slate-600">
                            أمر #{String(po.id)} · كمية {String(po.qty)} · {String(po.created_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded border border-slate-200 bg-[#F3F6FA] p-3">
                      <div className="mb-1.5 font-bold text-red-700">
                        فواتير العملاء المصروف لهم ({traceResult.affectedInvoices.length})
                      </div>
                      {traceResult.affectedInvoices.map((inv, i) => (
                        <div key={i} className="mb-1 rounded bg-white p-2">
                          <div className="font-bold">
                            فاتورة #{String(inv.sold_id)} — {String(inv.customer_name)}
                          </div>
                          <div className="text-[11px] text-slate-600">
                            هاتف: {String(inv.contact || '-')} · كمية {String(inv.qty)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {canManageBatches && (
                  <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                    <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-red-700">
                      إصدار استدعاء دوائي وعزل فوري للتشغيلة
                    </h3>
                    <form onSubmit={handleCreateRecall} noValidate className="space-y-2.5 text-xs">
                      <select
                        value={rclMedId}
                        onChange={(e) => setRclMedId(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-2"
                      >
                        {inventories.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (تشغيلة حالية: {m.batchNumber})
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        dir="ltr"
                        value={rclBatchNo}
                        onChange={(e) => setRclBatchNo(e.target.value)}
                        placeholder="رقم التشغيلة المطلوب عزلها *"
                        className="w-full rounded border border-slate-300 px-2.5 py-2 text-left"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={rclSource}
                          onChange={(e) => setRclSource(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-2"
                        >
                          <option value="sfda">هيئة الغذاء والدواء</option>
                          <option value="manufacturer">الشركة المصنعة</option>
                          <option value="internal_qa">رقابة الجودة الداخلية</option>
                        </select>
                        <select
                          value={rclSeverity}
                          onChange={(e) => setRclSeverity(e.target.value)}
                          className="rounded border border-slate-300 bg-white px-2 py-2"
                        >
                          <option value="class_1">الفئة 1 (عاجل)</option>
                          <option value="class_2">الفئة 2 (متوسط)</option>
                          <option value="class_3">الفئة 3 (توجيهي)</option>
                        </select>
                      </div>
                      <textarea
                        rows={2}
                        required
                        value={rclReason}
                        onChange={(e) => setRclReason(e.target.value)}
                        placeholder="سبب الاستدعاء والحجر الصحي..."
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="w-full rounded bg-red-600 py-2 font-bold text-white hover:bg-red-700"
                      >
                        تفعيل الاستدعاء وعزل التشغيلة فوراً
                      </button>
                    </form>
                  </div>
                )}

                <div className={`rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs ${canManageBatches ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
                  <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                    سجل الاستدعاءات والحجر الصحي للتشغيلات ({recalls.length})
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-right text-xs">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="border-b px-2.5 py-2">رقم الاستدعاء</th>
                          <th className="border-b px-2.5 py-2">الدواء / التشغيلة</th>
                          <th className="border-b px-2.5 py-2">المصدر والسبب</th>
                          <th className="border-b px-2.5 py-2">الكمية المعزولة</th>
                          <th className="border-b px-2.5 py-2">الحالة</th>
                          {canManageBatches && <th className="border-b px-2.5 py-2">تحكم</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {recalls.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                              لا توجد استدعاءات دوائية مسجلة حالياً.
                            </td>
                          </tr>
                        ) : (
                          recalls.map((rc) => (
                            <tr key={rc.id}>
                              <td className="px-2.5 py-2 font-mono font-bold text-red-700">{rc.recall_number}</td>
                              <td className="px-2.5 py-2">
                                <div className="font-bold">{rc.medicine_name}</div>
                                <div className="font-mono text-[11px] text-slate-500">{rc.batch_number}</div>
                              </td>
                              <td className="px-2.5 py-2">{rc.reason}</td>
                              <td className="px-2.5 py-2 font-bold tabular-nums">{rc.affected_qty}</td>
                              <td className="px-2.5 py-2">
                                <span
                                  className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                    rc.status === 'resolved'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-red-100 text-red-800'
                                  }`}
                                >
                                  {rc.status === 'resolved' ? 'تمت المعالجة' : 'معزولة / حجر'}
                                </span>
                              </td>
                              {canManageBatches && (
                                <td className="px-2.5 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setTraceQuery(rc.batch_number);
                                        try {
                                          const res = await api.traceBatch(rc.batch_number);
                                          setTraceResult(res);
                                        } catch (err) {
                                          showErrorPopup(err, 'تتبع التشغيلة المعزولة');
                                        }
                                      }}
                                      className="rounded border border-slate-300 px-2 py-1 text-[11px] font-bold"
                                    >
                                      تتبع المتأثرين
                                    </button>
                                    {rc.status !== 'resolved' && (
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          try {
                                            await api.updateRecallStatus(rc.id, 'resolved');
                                            showSuccess('تم إغلاق حالة الاستدعاء وفك الحجر بنجاح');
                                            await Promise.all([loadActiveTab(), onDataMutated()]);
                                          } catch (err) {
                                            showErrorPopup(err, 'إغلاق وفك حجر الاستدعاء');
                                          }
                                        }}
                                        className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white"
                                      >
                                        إغلاق وفك الحجر
                                      </button>
                                    )}
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 4: MULTI-BRANCH OPERATIONS
             ================================================================ */}
          {tab === 'branches' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {branches.map((br) => {
                  const target = Number(br.target_daily_sales || 0);
                  const today = Number(br.todaySales || 0);
                  const pct = target > 0 ? Math.min(100, Math.round((today / target) * 100)) : 100;
                  return (
                    <div key={br.id} className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                      <div className="flex items-start justify-between border-b border-slate-200 pb-2.5">
                        <div>
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <Building2 className="h-4 w-4 text-[#0B4F9C]" />
                            <span>{br.name}</span>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            الرمز: <span className="font-mono font-bold">{br.code || `BR-0${br.id}`}</span> ·{' '}
                            {br.location || 'غير محدد'}
                          </div>
                        </div>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                            br.is_branch_pos ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {br.is_branch_pos ? 'نقطة بيع نشطة' : 'مستودع مخزني'}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs tabular-nums">
                        <div className="rounded bg-[#F3F6FA] p-2">
                          <div className="text-slate-500">الوحدات بالتشغيلات</div>
                          <div className="font-bold text-slate-900">{br.totalUnits || 0}</div>
                        </div>
                        <div className="rounded bg-[#F3F6FA] p-2">
                          <div className="text-slate-500">قيمة المخزون بالتكلفة</div>
                          <div className="font-bold text-[#0B4F9C]">
                            {formatMoney(br.costValuation || 0, site.currencySymbol)}
                          </div>
                        </div>
                        <div className="rounded bg-[#F3F6FA] p-2">
                          <div className="text-slate-500">مبيعات اليوم / المستهدف</div>
                          <div className="font-bold text-emerald-700">
                            {formatMoney(today, site.currencySymbol)} / {formatMoney(target, site.currencySymbol)}
                          </div>
                        </div>
                        <div className="rounded bg-[#F3F6FA] p-2">
                          <div className="text-slate-500">إجمالي المبيعات ({br.totalInvoices || 0})</div>
                          <div className="font-bold text-slate-900">
                            {formatMoney(br.totalSales || 0, site.currencySymbol)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="mb-1 flex justify-between text-[11px] text-slate-600 tabular-nums">
                          <span>نسبة تحقيق الهدف اليومي</span>
                          <span className="font-bold">{pct}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full bg-[#0B4F9C]" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs">
                        <span className="text-slate-600">المدير: {br.manager_name || '-'}</span>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => onNavigate('warehouses')}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 font-semibold text-slate-700"
                          >
                            <ArrowLeftRight className="h-3 w-3" />
                            تحويل مخزون
                          </button>
                          {canManageWarehouses && (
                            <button
                              type="button"
                              onClick={() => setEditingBranch(br)}
                              className="rounded bg-[#0B4F9C] px-2.5 py-1 font-bold text-white"
                            >
                              تعديل الإعدادات
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {editingBranch && (
                <form onSubmit={handleSaveBranch} noValidate className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs text-xs">
                  <h3 className="mb-3 font-bold text-slate-800">تعديل إعدادات الفرع: {editingBranch.name}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <input
                      type="text"
                      value={editingBranch.name}
                      onChange={(e) => setEditingBranch({ ...editingBranch, name: e.target.value })}
                      placeholder="اسم الفرع"
                      className="rounded border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="text"
                      dir="ltr"
                      value={editingBranch.code || ''}
                      onChange={(e) => setEditingBranch({ ...editingBranch, code: e.target.value })}
                      placeholder="كود الفرع"
                      className="rounded border border-slate-300 px-2.5 py-2 text-left"
                    />
                    <input
                      type="text"
                      value={editingBranch.manager_name || ''}
                      onChange={(e) => setEditingBranch({ ...editingBranch, manager_name: e.target.value })}
                      placeholder="مدير الفرع"
                      className="rounded border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="text"
                      value={editingBranch.phone || ''}
                      onChange={(e) => setEditingBranch({ ...editingBranch, phone: e.target.value })}
                      placeholder="هاتف الفرع"
                      className="rounded border border-slate-300 px-2.5 py-2"
                    />
                    <input
                      type="number"
                      min={0}
                      value={editingBranch.target_daily_sales ?? 3000}
                      onChange={(e) =>
                        setEditingBranch({ ...editingBranch, target_daily_sales: Number(e.target.value) })
                      }
                      placeholder="الهدف اليومي للمبيعات"
                      className="rounded border border-slate-300 px-2.5 py-2"
                    />
                    <label className="flex items-center gap-2 rounded border border-slate-200 px-3 py-2 font-bold">
                      <input
                        type="checkbox"
                        checked={Boolean(editingBranch.is_branch_pos)}
                        onChange={(e) =>
                          setEditingBranch({ ...editingBranch, is_branch_pos: e.target.checked ? 1 : 0 })
                        }
                      />
                      <span>تشغيل نقطة بيع (POS) مستقلة بالفرع</span>
                    </label>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingBranch(null)}
                      className="rounded border px-3 py-1.5"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="rounded bg-[#0B4F9C] px-4 py-1.5 font-bold text-white"
                    >
                      حفظ التغييرات
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* ================================================================
              TAB 5: PROMOTIONS & LOYALTY PROGRAM
             ================================================================ */}
          {tab === 'loyalty' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  التسعير الترويجي والعروض الآلية ({promotions.length})
                </h3>
                {canManageSettings && (
                  <form onSubmit={handleAddPromo} noValidate className="mb-4 grid grid-cols-1 gap-2 rounded border border-slate-200 bg-[#F3F6FA] p-3 text-xs sm:grid-cols-2">
                    <input
                      type="text"
                      required
                      value={promoName}
                      onChange={(e) => setPromoName(e.target.value)}
                      placeholder="اسم العرض الترويجي *"
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5 sm:col-span-2"
                    />
                    <select
                      value={promoScope}
                      onChange={(e) => {
                        setPromoScope(e.target.value as 'all' | 'category' | 'medicine');
                        setPromoTargetId('');
                      }}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    >
                      <option value="all">جميع الأصناف</option>
                      <option value="category">تصنيف دوائي محدد</option>
                      <option value="medicine">صنف دوائي محدد</option>
                    </select>
                    {promoScope === 'category' ? (
                      <select
                        value={promoTargetId}
                        onChange={(e) => setPromoTargetId(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="">اختر التصنيف...</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : promoScope === 'medicine' ? (
                      <select
                        value={promoTargetId}
                        onChange={(e) => setPromoTargetId(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      >
                        <option value="">اختر الدواء...</option>
                        {inventories.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center px-2 text-slate-500">يشمل كافة أصناف الصيدلية</div>
                    )}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step="0.5"
                      required
                      value={promoPct}
                      onChange={(e) => setPromoPct(e.target.value)}
                      placeholder="نسبة الخصم %"
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <input
                      type="number"
                      min={1}
                      value={promoMinQty}
                      onChange={(e) => setPromoMinQty(e.target.value)}
                      placeholder="الحد الأدنى للكمية"
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <input
                      type="date"
                      value={promoEndDate}
                      onChange={(e) => setPromoEndDate(e.target.value)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <button
                      type="submit"
                      disabled={busyAction}
                      className="rounded bg-[#0B4F9C] py-1.5 font-bold text-white hover:bg-[#083D7A]"
                    >
                      تفعيل العرض
                    </button>
                  </form>
                )}

                <div className="space-y-2 text-xs">
                  {promotions.map((pr) => (
                    <div key={pr.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 p-2.5">
                      <div>
                        <div className="font-bold text-slate-900">
                          {pr.name} — <span className="text-emerald-700">خصم {pr.discount_pct}%</span>
                        </div>
                        <div className="text-[11px] text-slate-500">
                          النطاق: {pr.scope === 'all' ? 'شامل' : pr.scope === 'category' ? `تصنيف #${pr.target_id}` : `دواء #${pr.target_id}`} · حد أدنى: {pr.min_qty}
                        </div>
                      </div>
                      {canManageSettings && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.updatePromotion(pr.id, { isActive: !pr.is_active });
                                await loadActiveTab();
                              } catch (err) {
                                showErrorPopup(err, 'تغيير حالة العرض الترويجي');
                              }
                            }}
                            className={`rounded px-2 py-1 text-[11px] font-bold text-white ${
                              pr.is_active ? 'bg-emerald-600' : 'bg-slate-500'
                            }`}
                          >
                            {pr.is_active ? 'مفعل' : 'متوقف'}
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await api.deletePromotion(pr.id);
                                showSuccess('تم حذف العرض الترويجي');
                                await loadActiveTab();
                              } catch (err) {
                                showErrorPopup(err, 'حذف العرض الترويجي');
                              }
                            }}
                            className="rounded bg-red-600 p-1 text-white"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  برنامج نقاط ولاء العملاء (الكسب والاستبدال التلقائي في POS)
                </h3>
                <div className="mb-3 rounded border border-sky-200 bg-[#EDF4FC] p-2.5 text-xs text-slate-700">
                  يكتسب العميل المسجل نقطة واحدة مقابل كل 10 وحدات عملة من مدفوعاته، ويمكنه استبدال كل نقطة بخصم 0.05 من قيمة الفاتورة مع ترقية تلقائية للمستوى (عادي → فضي → ذهبي → بلاتيني).
                </div>
                {loyalty && (
                  <div className="space-y-3 text-xs">
                    <table className="w-full border-collapse text-right">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr>
                          <th className="border-b px-2.5 py-2">العميل</th>
                          <th className="border-b px-2.5 py-2">المستوى</th>
                          <th className="border-b px-2.5 py-2">رصيد النقاط</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {loyalty.customers.map((c) => (
                          <tr key={c.id}>
                            <td className="px-2.5 py-2 font-bold">{c.name}</td>
                            <td className="px-2.5 py-2">
                              <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
                                {c.loyalty_tier || 'عادي'}
                              </span>
                            </td>
                            <td className="px-2.5 py-2 font-bold tabular-nums text-[#0B4F9C]">
                              {c.loyalty_points || 0} نقطة
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {loyalty.transactions.length > 0 && (
                      <div>
                        <div className="mb-1.5 font-bold text-slate-700">آخر حركات النقاط</div>
                        <div className="max-h-40 space-y-1 overflow-y-auto">
                          {loyalty.transactions.map((t) => (
                            <div key={t.id} className="flex justify-between rounded border border-slate-100 bg-slate-50 px-2.5 py-1.5">
                              <span>
                                {t.customer_name} — {t.notes}
                              </span>
                              <span className={`font-bold tabular-nums ${t.points_delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {t.points_delta >= 0 ? `+${t.points_delta}` : t.points_delta}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 6 & 10: OPERATING EXPENSES & SMART KPI ANALYTICS
             ================================================================ */}
          {tab === 'analytics' && (
            <div className="space-y-4">
              {smartAnalytics && (
                <>
                  {/* Profitability KPI Waterfall */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-[#DCE4F0] bg-white p-3.5 shadow-xs">
                      <div className="text-xs font-bold text-slate-500">إجمالي الربح (بعد التكلفة COGS)</div>
                      <div className="mt-1 text-lg font-extrabold tabular-nums text-[#0B4F9C]">
                        {formatMoney(smartAnalytics.profitability.grossProfit, site.currencySymbol)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#DCE4F0] bg-white p-3.5 shadow-xs">
                      <div className="text-xs font-bold text-slate-500">المصروفات التشغيلية + الرواتب</div>
                      <div className="mt-1 text-lg font-extrabold tabular-nums text-amber-700">
                        {formatMoney(
                          smartAnalytics.profitability.operatingExpensesTotal +
                            smartAnalytics.profitability.payrollExpensesTotal,
                          site.currencySymbol,
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#DCE4F0] bg-white p-3.5 shadow-xs">
                      <div className="text-xs font-bold text-slate-500">صافي الربح التشغيلي الحقيقي</div>
                      <div className="mt-1 text-lg font-extrabold tabular-nums text-emerald-700">
                        {formatMoney(smartAnalytics.profitability.netOperatingProfit, site.currencySymbol)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#DCE4F0] bg-white p-3.5 shadow-xs">
                      <div className="text-xs font-bold text-slate-500">قيمة المخزون المعرض للانتهاء (90 يوم)</div>
                      <div className="mt-1 text-lg font-extrabold tabular-nums text-red-700">
                        {formatMoney(
                          smartAnalytics.expiryRisk.expiredValue +
                            smartAnalytics.expiryRisk.within30DaysValue +
                            smartAnalytics.expiryRisk.within60DaysValue +
                            smartAnalytics.expiryRisk.within90DaysValue,
                          site.currencySymbol,
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ABC & Reorder Table */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                      <h3 className="mb-3 flex items-center gap-1.5 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                        <BarChart3 className="h-4 w-4 text-[#0B4F9C]" />
                        <span>تصنيف المخزون الذكي (ABC Analysis) وسرعة الدوران</span>
                      </h3>
                      <div className="max-h-72 overflow-y-auto">
                        <table className="w-full border-collapse text-right text-xs">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <th className="border-b px-2 py-2">الدواء</th>
                              <th className="border-b px-2 py-2">الفئة</th>
                              <th className="border-b px-2 py-2">حصة الإيراد</th>
                              <th className="border-b px-2 py-2">أيام التغطية</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {smartAnalytics.abcItems.map((it) => (
                              <tr key={it.medicineId}>
                                <td className="px-2 py-2 font-bold">{it.medicineName}</td>
                                <td className="px-2 py-2">
                                  <span
                                    className={`rounded px-2 py-0.5 font-bold ${
                                      it.abcClass === 'A'
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : it.abcClass === 'B'
                                          ? 'bg-sky-100 text-sky-800'
                                          : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    فئة {it.abcClass}
                                  </span>
                                </td>
                                <td className="px-2 py-2 tabular-nums font-semibold">{it.revenueSharePct}%</td>
                                <td className="px-2 py-2 tabular-nums">
                                  {it.daysOfStockLeft !== null ? `${it.daysOfStockLeft} يوم` : 'كافٍ'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                      <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                        توصيات إعادة الطلب التلقائية ({smartAnalytics.reorderRecommendations.length})
                      </h3>
                      <div className="max-h-72 overflow-y-auto">
                        <table className="w-full border-collapse text-right text-xs">
                          <thead className="bg-slate-100 text-slate-700">
                            <tr>
                              <th className="border-b px-2 py-2">الدواء</th>
                              <th className="border-b px-2 py-2">المتاح / الأدنى</th>
                              <th className="border-b px-2 py-2">الكمية المقترح طلبها</th>
                              <th className="border-b px-2 py-2">إجراء</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {smartAnalytics.reorderRecommendations.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-3 py-6 text-center text-emerald-700 font-semibold">
                                  جميع الأصناف فوق حد الأمان التشغيلي حالياً.
                                </td>
                              </tr>
                            ) : (
                              smartAnalytics.reorderRecommendations.map((r) => (
                                <tr key={r.medicineId}>
                                  <td className="px-2 py-2 font-bold">{r.medicineName}</td>
                                  <td className="px-2 py-2 tabular-nums">
                                    {r.currentQty} / {r.minStock}
                                  </td>
                                  <td className="px-2 py-2 font-bold tabular-nums text-[#F97316]">
                                    +{r.suggestedReorderQty} علبة
                                  </td>
                                  <td className="px-2 py-2">
                                    <button
                                      type="button"
                                      onClick={() => onNavigate('purchases')}
                                      className="rounded bg-[#0B4F9C] px-2 py-1 text-[11px] font-bold text-white"
                                    >
                                      أمر شراء
                                    </button>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Operating Expenses by Cost Center */}
              {canManageAccounting && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                    <h3 className="mb-3 flex items-center gap-1.5 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                      <Wallet className="h-4 w-4 text-[#0B4F9C]" />
                      <span>قيد مصروف تشغيلي (مراكز التكلفة)</span>
                    </h3>
                    <form onSubmit={handleAddExpense} noValidate className="space-y-2.5 text-xs">
                      <input
                        type="text"
                        required
                        value={expTitle}
                        onChange={(e) => setExpTitle(e.target.value)}
                        placeholder="بيان المصروف (مثال: فاتورة كهرباء الفرع) *"
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                      <select
                        value={expCat}
                        onChange={(e) => setExpCat(e.target.value)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-2"
                      >
                        {Object.entries(EXPENSE_CATEGORIES).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={expBranchId}
                          onChange={(e) => setExpBranchId(Number(e.target.value))}
                          className="rounded border border-slate-300 bg-white px-2 py-2"
                        >
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={expCashBoxId}
                          onChange={(e) => setExpCashBoxId(Number(e.target.value))}
                          className="rounded border border-slate-300 bg-white px-2 py-2"
                        >
                          {cashBoxes.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {cb.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          value={expAmount}
                          onChange={(e) => setExpAmount(e.target.value)}
                          placeholder={`المبلغ (${site.currencySymbol}) *`}
                          className="rounded border border-slate-300 px-2.5 py-2"
                        />
                        <input
                          type="text"
                          value={expRef}
                          onChange={(e) => setExpRef(e.target.value)}
                          placeholder="رقم الإيصال"
                          className="rounded border border-slate-300 px-2.5 py-2"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="w-full rounded bg-[#0B4F9C] py-2 font-bold text-white hover:bg-[#083D7A]"
                      >
                        ترحيل المصروف والقيد المحاسبي
                      </button>
                    </form>
                  </div>

                  <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs lg:col-span-2">
                    <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                      سجل المصروفات التشغيلية حسب الفرع ومركز التكلفة ({expenses.length})
                    </h3>
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full border-collapse text-right text-xs">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr>
                            <th className="border-b px-2.5 py-2">البيان</th>
                            <th className="border-b px-2.5 py-2">الفئة</th>
                            <th className="border-b px-2.5 py-2">مركز التكلفة / الفرع</th>
                            <th className="border-b px-2.5 py-2">المبلغ</th>
                            <th className="border-b px-2.5 py-2">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {expenses.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                                لا توجد مصروفات تشغيلية مسجلة حتى الآن.
                              </td>
                            </tr>
                          ) : (
                            expenses.map((ex) => (
                              <tr key={ex.id}>
                                <td className="px-2.5 py-2 font-bold">{ex.title}</td>
                                <td className="px-2.5 py-2">{EXPENSE_CATEGORIES[ex.category] || ex.category}</td>
                                <td className="px-2.5 py-2">{ex.warehouse_name}</td>
                                <td className="px-2.5 py-2 font-bold tabular-nums text-red-700">
                                  {formatMoney(ex.amount, site.currencySymbol)}
                                </td>
                                <td className="px-2.5 py-2 font-mono">{ex.expense_date}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              TAB 8 & 9: HARDWARE CENTER, INTEGRATIONS, ZATCA QR & DISASTER RECOVERY
             ================================================================ */}
          {tab === 'integrations' && (
            <div className="space-y-4">
              {/* Stage 6 & 7: Hardware Center, Honest Client Diagnostics, Live Scanner Pad & Print Queue */}
              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                      <Printer className="h-4 w-4 text-[#0B4F9C]" />
                      <span>مركز الأجهزة الطرفية، الطابعات والماسح الضوئي ({hardwareDevices.length})</span>
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      فحص فعلي لقدرات المتصفح والجهاز الطرفي (بدون نتائج وهمية) + طابور مهام الطباعة وسجل الأحداث
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => void handleProbeBridgeAndDevice(hardwareDevices[0])}
                    className="inline-flex items-center gap-1.5 rounded bg-[#0B4F9C] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#083D7A]"
                  >
                    <Wifi className="h-3.5 w-3.5" />
                    <span>فحص الاتصال المحلي الفعلي (Print Bridge)</span>
                  </button>
                </div>

                {/* Honest Client Capabilities & Local Bridge Probe */}
                <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">طباعة المتصفح و PDF</div>
                    <div className={`font-bold ${clientCapabilities.browserPrintSupported ? 'text-emerald-700' : 'text-red-700'}`}>
                      {clientCapabilities.browserPrintSupported ? 'مدعوم وجاهز (CSS/PDF)' : 'غير متاح'}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">منفذ WebSerial (ESC/POS / TSPL)</div>
                    <div className={`font-bold ${clientCapabilities.webSerialSupported ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {clientCapabilities.webSerialSupported ? 'مدعوم عبر Chrome/Edge' : 'غير مدعوم في هذا المتصفح'}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">واجهة WebHID للماسح</div>
                    <div className={`font-bold ${clientCapabilities.webHidSupported ? 'text-emerald-700' : 'text-slate-600'}`}>
                      {clientCapabilities.webHidSupported ? 'WebHID متاح + HID Wedge' : 'HID Keyboard Wedge جاهز'}
                    </div>
                  </div>
                  <div className="rounded border border-slate-200 bg-slate-50 p-2.5">
                    <div className="text-[11px] text-slate-500">جسر الطباعة المحلي (Bridge)</div>
                    <div className={`font-bold ${bridgeCheckStatus?.reachable ? 'text-emerald-700' : 'text-amber-800'}`}>
                      {!bridgeCheckStatus
                        ? 'لم يُفحص من المتصفح بعد'
                        : bridgeCheckStatus.reachable
                          ? 'متصل ونشط'
                          : 'غير متصل (بديل CSS/PDF)'}
                    </div>
                  </div>
                </div>

                {bridgeCheckStatus && (
                  <div
                    className={`rounded border px-3 py-2 text-xs ${
                      bridgeCheckStatus.reachable
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    <strong>نتيجة الفحص الفعلي من جهازك:</strong> {bridgeCheckStatus.reason}
                    {bridgeCheckStatus.printers && bridgeCheckStatus.printers.length > 0 && (
                      <span className="mr-2 font-mono">({bridgeCheckStatus.printers.join(', ')})</span>
                    )}
                  </div>
                )}

                {/* Registered Devices Grid */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                  {hardwareDevices.map((dev) => (
                    <div key={dev.id} className="flex flex-col justify-between rounded border border-slate-200 bg-[#F3F6FA] p-3 text-xs">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-slate-900">{dev.name}</span>
                          {dev.is_default === 1 && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800">
                              <Star className="h-2.5 w-2.5" />
                              افتراضي
                            </span>
                          )}
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-slate-600" dir="ltr">
                          {dev.device_type} · {dev.connection_type} · {dev.protocol}
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          الأبعاد: {dev.paper_width_mm || dev.label_width_mm}mm · {dev.dpi || '-'} DPI · محطة {dev.terminal_id}
                        </div>
                        <div className="mt-1 font-mono text-[10px] text-slate-500">
                          الحالة: {dev.last_status} {dev.last_seen_at ? `(${dev.last_seen_at.slice(0, 16).replace('T', ' ')})` : ''}
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => void handleProbeBridgeAndDevice(dev)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          فحص فعلي
                        </button>
                        {canManageSettings && dev.is_default === 0 && (
                          <button
                            type="button"
                            disabled={busyAction}
                            onClick={() => void handleSetDefaultDevice(dev)}
                            className="rounded bg-[#0B4F9C] px-2 py-1 font-bold text-white"
                          >
                            تعيين كافتراضي
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add Hardware Device Form */}
                {canManageSettings && (
                  <form onSubmit={handleAddHardwareDevice} noValidate className="grid grid-cols-2 gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs md:grid-cols-7">
                    <input
                      type="text"
                      value={newDevName}
                      onChange={(e) => setNewDevName(e.target.value)}
                      placeholder="اسم الطابعة / الماسح الجديد..."
                      className="col-span-2 rounded border border-slate-300 bg-white px-2.5 py-1.5"
                    />
                    <select
                      value={newDevType}
                      onChange={(e) => setNewDevType(e.target.value as HardwareDeviceRecord['device_type'])}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="thermal_printer">طابعة حرارية (Receipt)</option>
                      <option value="label_printer">طابعة ملصقات (Label)</option>
                      <option value="a4_printer">طابعة A4 / PDF</option>
                      <option value="barcode_scanner">ماسح باركود (Scanner)</option>
                    </select>
                    <select
                      value={newDevConn}
                      onChange={(e) => setNewDevConn(e.target.value as HardwareDeviceRecord['connection_type'])}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="browser_print">Browser Print / CSS</option>
                      <option value="usb_hid">USB HID Wedge</option>
                      <option value="usb_serial">USB / WebSerial</option>
                      <option value="network_tcp">شبكة TCP (RAW 9100)</option>
                      <option value="local_bridge">Local Print Bridge</option>
                    </select>
                    <select
                      value={newDevProtocol}
                      onChange={(e) => setNewDevProtocol(e.target.value as HardwareDeviceRecord['protocol'])}
                      className="rounded border border-slate-300 bg-white px-2 py-1.5"
                    >
                      <option value="ESCPOS">ESC/POS</option>
                      <option value="TSPL">TSPL</option>
                      <option value="ZPL">ZPL</option>
                      <option value="HTML_CSS">HTML/CSS</option>
                      <option value="HID">HID</option>
                    </select>
                    <input
                      type="text"
                      dir="ltr"
                      value={newDevHost}
                      onChange={(e) => setNewDevHost(e.target.value)}
                      placeholder="IP (مثل 192.168.1.50)"
                      className="rounded border border-slate-300 bg-white px-2 py-1.5 text-left font-mono"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        value={newDevPaperMm}
                        onChange={(e) => setNewDevPaperMm(e.target.value)}
                        title="عرض الورق mm"
                        className="w-14 rounded border border-slate-300 bg-white px-1.5 py-1.5 text-center"
                      />
                      <button
                        type="submit"
                        disabled={busyAction}
                        className="flex-1 rounded bg-[#145632] px-2.5 py-1.5 font-bold text-white hover:bg-[#0f4126]"
                      >
                        إضافة
                      </button>
                    </div>
                  </form>
                )}

                {/* Live Scanner & GS1 Test Pad + Print Queue */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded border border-sky-200 bg-[#F8FBFF] p-3 text-xs space-y-2.5">
                    <div className="flex items-center gap-1.5 font-bold text-[#0B4F9C]">
                      <ScanBarcode className="h-4 w-4" />
                      <span>لوحة اختبار الماسح الضوئي الحية ومحلل GS1 DataMatrix</span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      امسح الآن بالماسح الضوئي الحقيقي (1D EAN-13 أو 2D GS1 DataMatrix) داخل الحقل لاختبار التنسيق وتوثيق المسح الفعلي.
                    </p>
                    <form
                      onSubmit={(e) => void handleScannerLiveTest(e)}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        dir="ltr"
                        value={scannerTestInput}
                        onChange={(e) => setScannerTestInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.ctrlKey && (e.key === ']' || e.code === 'BracketRight')) {
                            e.preventDefault();
                            setScannerTestInput((prev) => `${prev}\x1D`);
                          }
                        }}
                        placeholder="امسح هنا بالماسح أو الصق: (01)06281234567897(17)271231(10)BATCH01"
                        className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-left font-mono text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded bg-[#0B4F9C] px-3 py-1.5 font-bold text-white hover:bg-[#083D7A]"
                      >
                        تحليل واختبار
                      </button>
                    </form>
                    {scannerTestResult && (
                      <div className="space-y-1 rounded border border-emerald-200 bg-white p-2.5 text-[11px]">
                        <div className="flex flex-wrap gap-3 font-mono">
                          <span>
                            التنسيق: <strong>{scannerTestResult.parsed.symbology}</strong>
                          </span>
                          <span>
                            الرمز المستخرج: <strong dir="ltr">{scannerTestResult.parsed.normalized}</strong>
                          </span>
                          {scannerTestResult.parsed.gs1.expiryDate && (
                            <span>
                              الانتهاء (17): <strong dir="ltr">{scannerTestResult.parsed.gs1.expiryDate}</strong>
                            </span>
                          )}
                          {scannerTestResult.parsed.gs1.batchNumber && (
                            <span>
                              التشغيلة (10): <strong dir="ltr">{scannerTestResult.parsed.gs1.batchNumber}</strong>
                            </span>
                          )}
                        </div>
                        <div className="text-slate-700">
                          {scannerTestResult.serverMatch?.matchedMedicine ? (
                            <span className="font-bold text-emerald-700">
                              ✓ طابق الدواء: {String(scannerTestResult.serverMatch.matchedMedicine.name)}
                              {scannerTestResult.serverMatch.matchedUnit
                                ? ` (${scannerTestResult.serverMatch.matchedUnit.unitName})`
                                : ''}
                            </span>
                          ) : (
                            <span className="text-amber-700">
                              ⚠ قراءة سليمة للماسح — الرمز غير مربوط بدواء في المخزون بعد.
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Print Jobs Queue & Hardware Audit Logs */}
                  <div className="rounded border border-slate-200 bg-white p-3 text-xs space-y-2">
                    <div className="flex items-center justify-between font-bold text-slate-800">
                      <span>طابور مهام الطباعة وسجل الأحداث ({printJobs.length} مهمة · {hardwareLogs.length} حدث)</span>
                    </div>
                    <div className="max-h-44 space-y-1.5 overflow-y-auto">
                      {printJobs.length === 0 ? (
                        <div className="rounded border border-slate-100 bg-slate-50 p-4 text-center text-slate-500">
                          لا توجد مهام طباعة مسجلة في هذا الفرع بعد.
                        </div>
                      ) : (
                        printJobs.slice(0, 20).map((job) => (
                          <div key={job.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2.5 py-1.5">
                            <div>
                              <div className="font-bold text-slate-800">{job.title}</div>
                              <div className="font-mono text-[10px] text-slate-500" dir="ltr">
                                {job.protocol} · {job.transport} · ×{job.copies} · {job.created_at.slice(0, 16).replace('T', ' ')}
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                  job.status === 'completed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : job.status === 'failed'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {job.status}
                              </span>
                              {job.status !== 'completed' && (
                                <button
                                  type="button"
                                  disabled={busyAction}
                                  onClick={() => void handleUpdatePrintJobStatus(job.id, 'completed')}
                                  className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800"
                                >
                                  اكتمل
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Hardware & External APIs */}
              <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  التكاملات الخارجية والأنظمة السحابية ({integrations.length})
                </h3>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                  {integrations.map((cfg) => (
                    <div key={cfg.integration_key} className="rounded border border-slate-200 bg-[#F3F6FA] p-3 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-bold text-slate-900">{cfg.display_name}</div>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                            cfg.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {cfg.enabled ? 'مفعل' : 'معطل'}
                        </span>
                      </div>
                      <div className="mt-1 text-slate-600">{cfg.notes}</div>
                      <div className="mt-2 font-mono text-[11px] text-slate-500">
                        آخر اختبار: {cfg.last_tested_at || 'لم يختبر بعد'} ({cfg.last_status})
                      </div>
                      <div className="mt-3 flex gap-1.5">
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => void handleTestIntegration(cfg.integration_key)}
                          className="rounded bg-[#0B4F9C] px-2.5 py-1 font-bold text-white hover:bg-[#083D7A]"
                        >
                          اختبار الآن
                        </button>
                        {canManageSettings && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingIntegration(cfg);
                              setEditingConfigJson(cfg.config_json || '{}');
                            }}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 font-semibold text-slate-700"
                          >
                            تهيئة الإعدادات
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {editingIntegration && (
                  <form onSubmit={handleSaveIntegrationConfig} noValidate className="mt-4 rounded border border-[#DCE4F0] bg-white p-3 text-xs">
                    <div className="mb-2 flex items-center justify-between font-bold text-slate-800">
                      <span>تعديل إعدادات: {editingIntegration.display_name}</span>
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(editingIntegration.enabled)}
                          onChange={(e) =>
                            setEditingIntegration({ ...editingIntegration, enabled: e.target.checked ? 1 : 0 })
                          }
                        />
                        <span>مفعل</span>
                      </label>
                    </div>
                    <textarea
                      rows={3}
                      dir="ltr"
                      value={editingConfigJson}
                      onChange={(e) => setEditingConfigJson(e.target.value)}
                      className="w-full rounded border border-slate-300 p-2 font-mono text-left text-xs"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button type="button" onClick={() => setEditingIntegration(null)} className="rounded border px-3 py-1">
                        إلغاء
                      </button>
                      <button type="submit" disabled={busyAction} className="rounded bg-[#0B4F9C] px-3 py-1 font-bold text-white">
                        حفظ التهيئة
                      </button>
                    </div>
                  </form>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {/* ZATCA TLV Base64 Generator */}
                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <h3 className="mb-3 flex items-center gap-1.5 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                    <QrCode className="h-4 w-4 text-[#0B4F9C]" />
                    <span>مولد تشفير الفوترة الإلكترونية ZATCA TLV Base64</span>
                  </h3>
                  <form onSubmit={handleGenerateZatcaTlv} noValidate className="space-y-3 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-1 block font-semibold">إجمالي الفاتورة مع الضريبة</label>
                        <input
                          type="number"
                          step="0.01"
                          value={zatcaTotal}
                          onChange={(e) => setZatcaTotal(e.target.value)}
                          className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block font-semibold">مبلغ الضريبة (VAT)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={zatcaVat}
                          onChange={(e) => setZatcaVat(e.target.value)}
                          className="w-full rounded border border-slate-300 px-2.5 py-1.5"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="rounded bg-[#0B4F9C] px-4 py-1.5 font-bold text-white hover:bg-[#083D7A]"
                    >
                      توليد بصمة TLV QR
                    </button>
                    {zatcaTlvResult && (
                      <div className="rounded border border-emerald-200 bg-emerald-50 p-2.5">
                        <div className="mb-1 font-bold text-emerald-800">سلسلة TLV Base64 الناتجة:</div>
                        <div dir="ltr" className="break-all font-mono text-[11px] text-slate-800">
                          {zatcaTlvResult}
                        </div>
                      </div>
                    )}
                  </form>
                </div>

                {/* Disaster Recovery Checkpoints */}
                <div className="rounded-lg border border-[#DCE4F0] bg-white p-4 shadow-xs">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                    <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-800">
                      <DatabaseBackup className="h-4 w-4 text-[#0B4F9C]" />
                      <span>نقاط الاستعادة السريعة والتعافي من الكوارث ({snapshots.length})</span>
                    </h3>
                    <button
                      type="button"
                      onClick={() => onNavigate('accountSetting')}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700"
                    >
                      <HardDriveDownload className="h-3 w-3" />
                      <span>تصدير/استيراد JSON</span>
                    </button>
                  </div>
                  {canManageSettings ? (
                    <>
                      <div className="mb-3 flex gap-2 text-xs">
                        <input
                          type="text"
                          value={checkpointLabel}
                          onChange={(e) => setCheckpointLabel(e.target.value)}
                          placeholder="تسمية نقطة الاستعادة (اختياري)..."
                          className="flex-1 rounded border border-slate-300 px-2.5 py-1.5"
                        />
                        <button
                          type="button"
                          disabled={busyAction}
                          onClick={() => void handleCreateCheckpoint()}
                          className="inline-flex items-center gap-1 rounded bg-[#0B4F9C] px-3 py-1.5 font-bold text-white hover:bg-[#083D7A]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>إنشاء نقطة استعادة SHA-256</span>
                        </button>
                      </div>
                      <div className="max-h-56 space-y-2 overflow-y-auto text-xs">
                        {snapshots.length === 0 ? (
                          <div className="rounded border border-slate-200 bg-slate-50 p-4 text-center text-slate-500">
                            لم يتم إنشاء نقاط استعادة سريعة داخل الخادم بعد.
                          </div>
                        ) : (
                          snapshots.map((sn) => (
                            <div key={sn.id} className="flex items-center justify-between gap-2 rounded border border-slate-200 p-2.5">
                              <div className="min-w-0">
                                <div className="truncate font-bold text-slate-900">{sn.file_name}</div>
                                <div className="font-mono text-[10px] text-slate-500">
                                  {sn.table_count} جدول · {sn.row_count} سجل · SHA256: {sn.checksum_sha256.slice(0, 14)}...
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRestoreConfirmSnap(sn)}
                                className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-600 px-2.5 py-1 font-bold text-white hover:bg-amber-700"
                              >
                                <RotateCcw className="h-3 w-3" />
                                <span>استعادة فورية</span>
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
                      إدارة نقاط الاستعادة والنسخ الاحتياطي متاحة للمدير العام أو لمن يملك صلاحية إعدادات النظام.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Disaster Recovery Restore Confirm */}
      <ConfirmModal
        open={Boolean(restoreConfirmSnap)}
        title="تأكيد الاستعادة الفورية لنقطة التعافي"
        message={`هل تريد استعادة قاعدة البيانات بالكامل إلى نقطة "${restoreConfirmSnap?.file_name || ''}" (${restoreConfirmSnap?.row_count || 0} سجل)؟ سيتم التحقق من بصمة SHA-256 أولاً.`}
        confirmLabel="نعم، استعادة النظام"
        busy={busyAction}
        onConfirm={handleConfirmRestoreSnapshot}
        onCancel={() => setRestoreConfirmSnap(null)}
      />

      {/* Print Preview: System Evaluation Report */}
      <PrintPreviewModal
        open={evalPreviewOpen}
        title="تقرير التقييم الوظيفي وسد الفجوات - نظام إتقان سوفت لإدارة الصيدليات"
        site={site}
        defaultPaperMode="a4"
        onClose={() => setEvalPreviewOpen(false)}
      >
        {evaluation && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-2 rounded border border-slate-300 bg-slate-50 p-3 font-bold">
              <div>الجاهزية الإجمالية: {evaluation.overallScore}%</div>
              <div>الوحدات الأساسية (7): {evaluation.overallCoreScore}%</div>
              <div>التوسعات المتقدمة (10): {evaluation.overallExpansionScore}%</div>
            </div>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">المجال التوسعي</th>
                  <th className="border border-slate-300 px-2 py-1.5">الحالة السابقة</th>
                  <th className="border border-slate-300 px-2 py-1.5">التغطية الحالية</th>
                  <th className="border border-slate-300 px-2 py-1.5">النسبة</th>
                </tr>
              </thead>
              <tbody>
                {evaluation.expansionModules.map((ex) => (
                  <tr key={ex.key}>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">{ex.title}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{ex.previousGap}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{ex.details}</td>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">{ex.score}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PrintPreviewModal>

      {/* Print Preview: Controlled Substances Register */}
      <PrintPreviewModal
        open={controlledPreviewOpen}
        title="السجل الرقابي لصرف الأدوية المقيدة والمراقبة"
        site={site}
        defaultPaperMode="a4"
        onClose={() => setControlledPreviewOpen(false)}
      >
        <table className="w-full border-collapse text-right text-xs">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-300 px-2 py-1.5">الدواء</th>
              <th className="border border-slate-300 px-2 py-1.5">الجدول</th>
              <th className="border border-slate-300 px-2 py-1.5">المريض</th>
              <th className="border border-slate-300 px-2 py-1.5">رقم الهوية</th>
              <th className="border border-slate-300 px-2 py-1.5">رقم الوصفة</th>
              <th className="border border-slate-300 px-2 py-1.5">الكمية</th>
              <th className="border border-slate-300 px-2 py-1.5">الصيدلاني</th>
              <th className="border border-slate-300 px-2 py-1.5">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {controlledLogs.map((l) => (
              <tr key={l.id}>
                <td className="border border-slate-300 px-2 py-1.5 font-bold">{l.medicine_name}</td>
                <td className="border border-slate-300 px-2 py-1.5">{l.schedule}</td>
                <td className="border border-slate-300 px-2 py-1.5">{l.patient_name}</td>
                <td className="border border-slate-300 px-2 py-1.5 font-mono">{l.patient_national_id}</td>
                <td className="border border-slate-300 px-2 py-1.5 font-mono">{l.prescription_number}</td>
                <td className="border border-slate-300 px-2 py-1.5">{l.qty}</td>
                <td className="border border-slate-300 px-2 py-1.5">{l.pharmacist_name}</td>
                <td className="border border-slate-300 px-2 py-1.5 font-mono">{l.dispensed_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PrintPreviewModal>
    </div>
  );
};
