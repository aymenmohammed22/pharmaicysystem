import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Clock,
  Wallet,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  Printer,
  Edit3,
  Search,
  RefreshCw,
  Download,
  Eye,
  X,
  Filter,
} from 'lucide-react';
import { api } from '../api';
import type {
  AuditLogRecord,
  CashBox,
  EmployeeAttendance,
  EmployeeProfile,
  EmployeeTransaction,
  SiteSettings,
  User,
} from '../types';
import { formatMoney, hasPermission } from '../types';
import {
  AUDIT_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditSeverity,
  getAuditSeverityBadge,
} from '../utils/auditLabels';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { showErrorPopup, validationError } from '../lib/errorPopup';

interface StaffHrPageProps {
  user: User;
  site: SiteSettings;
  initialTab?: 'employees' | 'attendance' | 'transactions' | 'audit';
}

const TX_TYPE_LABELS: Record<EmployeeTransaction['tx_type'], string> = {
  salary: 'صرف راتب',
  advance: 'سلفة',
  commission: 'عمولة مبيعات',
  bonus: 'مكافأة / حافز',
  deduction: 'خصم / جزاء',
};

export const StaffHrPage: React.FC<StaffHrPageProps> = ({ user, site, initialTab }) => {
  const canManageHr = hasPermission(user, 'manageHr');
  const canAudit = hasPermission(user, 'viewAuditLog');

  const resolveInitialTab = (): 'employees' | 'attendance' | 'transactions' | 'audit' => {
    if (initialTab === 'audit' && canAudit) return 'audit';
    if (canManageHr) return initialTab || 'employees';
    return 'audit';
  };

  const [tab, setTab] = useState<'employees' | 'attendance' | 'transactions' | 'audit'>(resolveInitialTab);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');

  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
  const [attendance, setAttendance] = useState<EmployeeAttendance[]>([]);
  const [transactions, setTransactions] = useState<EmployeeTransaction[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [auditTotalCount, setAuditTotalCount] = useState(0);
  const [auditSensitiveCount, setAuditSensitiveCount] = useState(0);
  const [auditActors, setAuditActors] = useState<Array<{ user_id: number; user_name: string }>>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);

  // Audit Log Filters & Inspection
  const [auditSearch, setAuditSearch] = useState('');
  const [auditActionFilter, setAuditActionFilter] = useState('');
  const [auditEntityFilter, setAuditEntityFilter] = useState('');
  const [auditUserFilter, setAuditUserFilter] = useState<number>(0);
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditSensitiveOnly, setAuditSensitiveOnly] = useState(false);
  const [auditLimit, setAuditLimit] = useState(200);
  const [auditLoading, setAuditLoading] = useState(false);
  const [selectedAuditLog, setSelectedAuditLog] = useState<AuditLogRecord | null>(null);

  // Employee Form
  const [editingEmp, setEditingEmp] = useState<EmployeeProfile | null>(null);
  const [fullName, setFullName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('');
  const [baseSalary, setBaseSalary] = useState('0');
  const [commissionRate, setCommissionRate] = useState('0');
  const [savingEmp, setSavingEmp] = useState(false);

  // Attendance Form
  const [attEmpId, setAttEmpId] = useState<number>(0);
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10));
  const [attCheckIn, setAttCheckIn] = useState('08:00');
  const [attCheckOut, setAttCheckOut] = useState('');
  const [attStatus, setAttStatus] = useState('present');
  const [attNotes, setAttNotes] = useState('');
  const [savingAtt, setSavingAtt] = useState(false);

  // Payroll / Advances / Commissions Form
  const [txEmpId, setTxEmpId] = useState<number>(0);
  const [txType, setTxType] = useState<EmployeeTransaction['tx_type']>('salary');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState(new Date().toISOString().slice(0, 10));
  const [txNotes, setTxNotes] = useState('');
  const [payFromCashBox, setPayFromCashBox] = useState(true);
  const [cashBoxId, setCashBoxId] = useState<number>(0);
  const [savingTx, setSavingTx] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    if (initialTab === 'audit' && canAudit) {
      setTab('audit');
    } else if (initialTab && initialTab !== 'audit' && canManageHr) {
      setTab(initialTab);
    }
  }, [initialTab, canAudit, canManageHr]);

  const loadAuditLogs = useCallback(async () => {
    if (!canAudit) return;
    setAuditLoading(true);
    try {
      const logRes = await api.getAuditLogs({
        limit: auditLimit,
        action: auditActionFilter || undefined,
        entityType: auditEntityFilter || undefined,
        userId: auditUserFilter || undefined,
        from: auditFrom || undefined,
        to: auditTo || undefined,
        search: auditSearch.trim() || undefined,
        sensitiveOnly: auditSensitiveOnly,
      });
      setAuditLogs(logRes.logs);
      setAuditTotalCount(logRes.totalCount ?? logRes.logs.length);
      setAuditSensitiveCount(
        logRes.sensitiveCount ??
          logRes.logs.filter((l) => getAuditSeverity(l) === 'high').length,
      );
      if (logRes.actors) setAuditActors(logRes.actors);
    } catch (err) {
      showErrorPopup(err, 'تحميل سجل التدقيق الأمني');
    } finally {
      setAuditLoading(false);
    }
  }, [
    canAudit,
    auditLimit,
    auditActionFilter,
    auditEntityFilter,
    auditUserFilter,
    auditFrom,
    auditTo,
    auditSearch,
    auditSensitiveOnly,
  ]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, attRes, txRes] = canManageHr
        ? await Promise.all([
            api.getEmployees(),
            api.getAttendance(),
            api.getEmployeeTransactions(),
          ])
        : [{ employees: [] }, { attendance: [] }, { transactions: [] }];

      setEmployees(empRes.employees);
      setAttendance(attRes.attendance);
      setTransactions(txRes.transactions);
      setAttEmpId((prev) =>
        empRes.employees.some((e) => e.id === prev) ? prev : (empRes.employees[0]?.id ?? 0),
      );
      setTxEmpId((prev) =>
        empRes.employees.some((e) => e.id === prev) ? prev : (empRes.employees[0]?.id ?? 0),
      );
      if (canManageHr && hasPermission(user, 'manageAccounting')) {
        const accRes = await api.getAccounts();
        setCashBoxes(accRes.cashBoxes);
        setCashBoxId((prev) =>
          accRes.cashBoxes.some((c) => c.id === prev) ? prev : (accRes.cashBoxes[0]?.id ?? 0),
        );
      } else {
        setCashBoxes([{ id: 0, name: 'الصندوق الرئيسي', box_type: 'cash', account_id: 0, balance: 0 }]);
        setCashBoxId(0);
      }
      await loadAuditLogs();
    } catch (err) {
      showErrorPopup(err, 'تحميل بيانات الموارد البشرية والموظفين');
    } finally {
      setLoading(false);
    }
  }, [canManageHr, user, loadAuditLogs]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim() || !jobTitle.trim()) {
      validationError('اسم الموظف الكامل والمسمى الوظيفي مطلوبان.', editingEmp ? 'تعديل ملف موظف' : 'إضافة ملف موظف');
      return;
    }
    const salaryNum = Number(baseSalary);
    const commNum = Number(commissionRate);
    if (!Number.isFinite(salaryNum) || salaryNum < 0) {
      validationError('الراتب الأساسي يجب أن يكون صفراً أو قيمة موجبة.', editingEmp ? 'تعديل ملف موظف' : 'إضافة ملف موظف');
      return;
    }
    if (!Number.isFinite(commNum) || commNum < 0 || commNum > 100) {
      validationError('نسبة العمولة يجب أن تكون بين 0% و 100%.', editingEmp ? 'تعديل ملف موظف' : 'إضافة ملف موظف');
      return;
    }
    setSavingEmp(true);
    setStatusMsg('');
    try {
      const payload = {
        fullName: fullName.trim(),
        jobTitle: jobTitle.trim(),
        specialty: specialty.trim(),
        phone: phone.trim(),
        baseSalary: Math.max(0, salaryNum),
        commissionRate: Math.max(0, commNum),
      };
      if (editingEmp) {
        await api.updateEmployee(editingEmp.id, payload);
        setStatusMsg('تم تحديث ملف الموظف بنجاح');
      } else {
        await api.createEmployee(payload);
        setStatusMsg('تم إضافة ملف الموظف بنجاح');
      }
      setEditingEmp(null);
      setFullName('');
      setJobTitle('');
      setSpecialty('');
      setPhone('');
      setBaseSalary('0');
      setCommissionRate('0');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, editingEmp ? 'تحديث ملف الموظف' : 'إضافة ملف موظف');
    } finally {
      setSavingEmp(false);
    }
  };

  const handleRecordAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attEmpId) {
      validationError('يرجى اختيار الموظف قبل تسجيل الحضور والانصراف.', 'تسجيل الحضور والانصراف');
      return;
    }
    if (!attDate.trim()) {
      validationError('يرجى تحديد تاريخ الدوام.', 'تسجيل الحضور والانصراف');
      return;
    }
    setSavingAtt(true);
    setStatusMsg('');
    try {
      await api.recordAttendance({
        employeeId: attEmpId,
        workDate: attDate,
        checkIn: attCheckIn,
        checkOut: attCheckOut,
        status: attStatus,
        notes: attNotes.trim(),
      });
      setAttNotes('');
      setStatusMsg('تم تسجيل حركة الحضور والانصراف');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'تسجيل الحضور والانصراف');
    } finally {
      setSavingAtt(false);
    }
  };

  const handleCreateTx = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(txAmount);
    if (!txEmpId) {
      validationError('يرجى تحديد الموظف أولاً.', 'تسجيل حركة مالية للموظف');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      validationError('يرجى إدخال مبلغ صحيح أكبر من صفر.', 'تسجيل حركة مالية للموظف');
      return;
    }
    if (!txDate.trim()) {
      validationError('يرجى تحديد تاريخ الحركة المالية.', 'تسجيل حركة مالية للموظف');
      return;
    }
    setSavingTx(true);
    setStatusMsg('');
    try {
      await api.createEmployeeTransaction({
        employeeId: txEmpId,
        txType,
        amount: amt,
        txDate,
        notes: txNotes.trim(),
        payFromCashBox: txType !== 'deduction' && payFromCashBox,
        cashBoxId,
      });
      setTxAmount('');
      setTxNotes('');
      setStatusMsg('تم تسجيل الحركة المالية للموظف بنجاح');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'تسجيل الحركة المالية للموظف');
    } finally {
      setSavingTx(false);
    }
  };

  const auditLoginCount = useMemo(
    () => auditLogs.filter((l) => l.action === 'login' || l.action === 'logout').length,
    [auditLogs],
  );

  const handleExportAuditCsv = () => {
    const header = ['رقم السجل', 'التاريخ والوقت', 'المستوى', 'رقم المستخدم', 'المستخدم', 'الإجراء', 'القسم/الكيان', 'رقم الكيان', 'التفاصيل'];
    const escapeCsv = (val: string | number | null | undefined) => {
      const str = String(val ?? '').replace(/"/g, '""');
      return `"${str}"`;
    };
    const rows = auditLogs.map((l) => [
      l.id,
      l.created_at,
      getAuditSeverityBadge(getAuditSeverity(l)).label,
      l.user_id,
      l.user_name,
      getAuditActionLabel(l.action),
      getAuditEntityLabel(l.entity_type),
      l.entity_id ?? '',
      l.details,
    ]);
    const csvContent =
      '\uFEFF' + [header.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">الموارد البشرية والموظفين</span>
          <span className="mx-1">/</span>
          <span>
            {tab === 'audit'
              ? 'مراقبة سجل التدقيق الأمني والعمليات الحساسة (Audit Log)'
              : 'ملفات الموظفين، الحضور والانصراف، الرواتب والعمولات والسلف، سجل التدقيق'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="inline-flex items-center gap-1 rounded bg-[#0B4F9C] px-3 py-1 text-xs font-bold text-white hover:bg-[#2b698d]"
        >
          <Printer className="h-3.5 w-3.5" />
          <span>{tab === 'audit' ? 'معاينة وطباعة سجل التدقيق' : 'معاينة شاشة كاملة للرواتب والموظفين'}</span>
        </button>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 rounded border border-slate-300 bg-white p-2 shadow-sm">
        {[
          ...(canManageHr
            ? [
                { key: 'employees', label: 'ملفات الموظفين والرواتب الأساسية', icon: Briefcase },
                { key: 'attendance', label: 'سجل الحضور والانصراف', icon: Clock },
                { key: 'transactions', label: 'الرواتب والسلف والعمولات والخصومات', icon: Wallet },
              ]
            : []),
          ...(canAudit
            ? [{ key: 'audit', label: 'سجل التدقيق والعمليات الحساسة (Audit Log)', icon: ShieldCheck }]
            : []),
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key as typeof tab)}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
                tab === t.key ? 'bg-[#0B4F9C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          جاري تحميل بيانات الموظفين...
        </div>
      ) : (
        <>
          {tab === 'employees' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  {editingEmp ? `تعديل ملف: ${editingEmp.full_name}` : 'إضافة ملف موظف'}
                </h3>
                <form noValidate onSubmit={handleSaveEmployee} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">الاسم الكامل *</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">المسمى الوظيفي *</label>
                    <input
                      type="text"
                      required
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="صيدلاني / كاشير / أمين مخزن"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">التخصص</label>
                    <input
                      type="text"
                      value={specialty}
                      onChange={(e) => setSpecialty(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الهاتف</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-semibold">الراتب الأساسي</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={baseSalary}
                        onChange={(e) => setBaseSalary(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold">نسبة العمولة %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="0.1"
                        value={commissionRate}
                        onChange={(e) => setCommissionRate(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingEmp}
                      className="flex-1 rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226]"
                    >
                      {savingEmp ? 'جاري الحفظ...' : editingEmp ? 'تحديث الملف' : 'حفظ الموظف'}
                    </button>
                    {editingEmp && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingEmp(null);
                          setFullName('');
                          setJobTitle('');
                          setSpecialty('');
                          setPhone('');
                          setBaseSalary('0');
                          setCommissionRate('0');
                        }}
                        className="rounded border border-slate-300 px-3 py-2"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  كادر الموظفين ({employees.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-2.5 py-2">الاسم</th>
                        <th className="border border-slate-300 px-2.5 py-2">المسمى الوظيفي</th>
                        <th className="border border-slate-300 px-2.5 py-2">الهاتف</th>
                        <th className="border border-slate-300 px-2.5 py-2">الراتب الأساسي</th>
                        <th className="border border-slate-300 px-2.5 py-2">العمولة</th>
                        <th className="border border-slate-300 px-2.5 py-2">تعديل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((e) => (
                        <tr key={e.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2.5 py-2 font-bold">{e.full_name}</td>
                          <td className="border border-slate-200 px-2.5 py-2">{e.job_title}</td>
                          <td className="border border-slate-200 px-2.5 py-2 font-mono">{e.phone || '—'}</td>
                          <td className="border border-slate-200 px-2.5 py-2 font-bold text-[#145632]">
                            {formatMoney(e.base_salary, site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2">{e.commission_rate}%</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingEmp(e);
                                setFullName(e.full_name);
                                setJobTitle(e.job_title);
                                setSpecialty(e.specialty);
                                setPhone(e.phone);
                                setBaseSalary(String(e.base_salary));
                                setCommissionRate(String(e.commission_rate));
                              }}
                              className="rounded bg-amber-500 px-2 py-1 text-[11px] text-white"
                            >
                              <Edit3 className="h-3 w-3" />
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

          {tab === 'attendance' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  تسجيل حضور / انصراف
                </h3>
                <form noValidate onSubmit={handleRecordAttendance} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">الموظف *</label>
                    <select
                      value={attEmpId}
                      onChange={(e) => setAttEmpId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name} ({e.job_title})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">التاريخ</label>
                    <input
                      type="date"
                      value={attDate}
                      onChange={(e) => setAttDate(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-semibold">وقت الحضور</label>
                      <input
                        type="time"
                        value={attCheckIn}
                        onChange={(e) => setAttCheckIn(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold">وقت الانصراف</label>
                      <input
                        type="time"
                        value={attCheckOut}
                        onChange={(e) => setAttCheckOut(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الحالة</label>
                    <select
                      value={attStatus}
                      onChange={(e) => setAttStatus(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value="present">حاضر</option>
                      <option value="late">متأخر</option>
                      <option value="leave">إجازة</option>
                      <option value="absent">غائب</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">ملاحظات</label>
                    <input
                      type="text"
                      value={attNotes}
                      onChange={(e) => setAttNotes(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingAtt}
                    className="w-full rounded bg-[#0B4F9C] py-2 font-bold text-white hover:bg-[#2b688c]"
                  >
                    {savingAtt ? 'جاري التسجيل...' : 'حفظ الحضور والانصراف'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل الدوام والحضور ({attendance.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                        <th className="border border-slate-300 px-2.5 py-2">الموظف</th>
                        <th className="border border-slate-300 px-2.5 py-2">الحضور</th>
                        <th className="border border-slate-300 px-2.5 py-2">الانصراف</th>
                        <th className="border border-slate-300 px-2.5 py-2">الحالة</th>
                        <th className="border border-slate-300 px-2.5 py-2">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {attendance.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد سجلات دوام بعد
                          </td>
                        </tr>
                      ) : (
                        attendance.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-mono">{a.work_date}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">{a.full_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono">{a.check_in || '—'}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono">{a.check_out || '—'}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{a.status}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{a.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'transactions' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  صرف راتب / سلفة / عمولة / خصم
                </h3>
                <form noValidate onSubmit={handleCreateTx} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">الموظف *</label>
                    <select
                      value={txEmpId}
                      onChange={(e) => setTxEmpId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      {employees.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.full_name} (راتب: {formatMoney(e.base_salary, site.currencySymbol)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-semibold">نوع الحركة</label>
                      <select
                        value={txType}
                        onChange={(e) => setTxType(e.target.value as EmployeeTransaction['tx_type'])}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      >
                        <option value="salary">صرف راتب</option>
                        <option value="advance">سلفة</option>
                        <option value="commission">عمولة</option>
                        <option value="bonus">مكافأة</option>
                        <option value="deduction">خصم</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold">المبلغ *</label>
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        required
                        value={txAmount}
                        onChange={(e) => setTxAmount(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">التاريخ</label>
                    <input
                      type="date"
                      value={txDate}
                      onChange={(e) => setTxDate(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  {txType !== 'deduction' && (
                    <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
                      <label className="flex items-center gap-2 font-semibold">
                        <input
                          type="checkbox"
                          checked={payFromCashBox}
                          onChange={(e) => setPayFromCashBox(e.target.checked)}
                        />
                        <span>صرف فوري من الصندوق وترحيل قيد رواتب</span>
                      </label>
                      {payFromCashBox && (
                        <select
                          value={cashBoxId}
                          onChange={(e) => setCashBoxId(Number(e.target.value))}
                          className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                        >
                          {cashBoxes.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {cb.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block font-semibold">ملاحظات</label>
                    <input
                      type="text"
                      value={txNotes}
                      onChange={(e) => setTxNotes(e.target.value)}
                      placeholder="راتب شهر..."
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingTx}
                    className="w-full rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226]"
                  >
                    {savingTx ? 'جاري التنفيذ...' : 'اعتماد الحركة المالية'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل الرواتب والسلف والعمولات ({transactions.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                        <th className="border border-slate-300 px-2.5 py-2">الموظف</th>
                        <th className="border border-slate-300 px-2.5 py-2">النوع</th>
                        <th className="border border-slate-300 px-2.5 py-2">المبلغ</th>
                        <th className="border border-slate-300 px-2.5 py-2">ملاحظات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد حركات مالية مسجلة للموظفين
                          </td>
                        </tr>
                      ) : (
                        transactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-mono">{tx.tx_date}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">{tx.full_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {TX_TYPE_LABELS[tx.tx_type] || tx.tx_type}
                            </td>
                            <td
                              className={`border border-slate-200 px-2.5 py-2 font-bold ${
                                tx.tx_type === 'deduction' ? 'text-red-700' : 'text-[#145632]'
                              }`}
                            >
                              {formatMoney(tx.amount, site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{tx.notes || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'audit' && canAudit && (
            <div className="space-y-4">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
                  <div className="text-xs font-semibold text-slate-500">إجمالي السجلات المطابقة</div>
                  <div className="mt-1 text-2xl font-extrabold text-slate-800">{auditTotalCount}</div>
                  <div className="mt-0.5 text-[11px] text-slate-500">معروض حالياً: {auditLogs.length} سجل</div>
                </div>
                <button
                  type="button"
                  onClick={() => setAuditSensitiveOnly((v) => !v)}
                  className={`rounded border p-3.5 text-right shadow-sm transition ${
                    auditSensitiveOnly
                      ? 'border-red-400 bg-red-50 ring-1 ring-red-400'
                      : 'border-red-200 bg-red-50/50 hover:bg-red-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold text-red-800">
                    <span>العمليات الحساسة وعالية الخطورة</span>
                    <ShieldAlert className="h-4 w-4 text-red-600" />
                  </div>
                  <div className="mt-1 text-2xl font-extrabold text-red-700">{auditSensitiveCount}</div>
                  <div className="mt-0.5 text-[11px] text-red-700">
                    {auditSensitiveOnly ? 'مفعل: عرض الحساس فقط (انقر لإلغاء)' : 'انقر لعرض العمليات الحساسة فقط'}
                  </div>
                </button>
                <div className="rounded border border-sky-200 bg-sky-50/50 p-3.5 shadow-sm">
                  <div className="text-xs font-semibold text-sky-800">المستخدمون المسجلون بالسجل</div>
                  <div className="mt-1 text-2xl font-extrabold text-sky-900">{auditActors.length}</div>
                  <div className="mt-0.5 text-[11px] text-sky-700">جميع الحسابات النشطة والمنفذة</div>
                </div>
                <div className="rounded border border-emerald-200 bg-emerald-50/50 p-3.5 shadow-sm">
                  <div className="text-xs font-semibold text-emerald-800">حركات الدخول والخروج المعروضة</div>
                  <div className="mt-1 text-2xl font-extrabold text-emerald-900">{auditLoginCount}</div>
                  <div className="mt-0.5 text-[11px] text-emerald-700">مراقبة الجلسات والأمان</div>
                </div>
              </div>

              {/* Filter & Export Controls */}
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-[#0B4F9C]" />
                    <div>
                      <h3 className="text-sm font-bold text-slate-800">
                        مراقبة سجل التدقيق الأمني والعمليات الحساسة (Audit Log)
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        يتتبع الحذف، إلغاء الفواتير، المرتجعات، تعديل الصلاحيات وحظر المستخدمين، النسخ الاحتياطي، وتعديلات العملة والمخزون.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void loadAuditLogs()}
                      disabled={auditLoading}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${auditLoading ? 'animate-spin' : ''}`} />
                      <span>تحديث</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleExportAuditCsv}
                      disabled={auditLogs.length === 0}
                      className="inline-flex items-center gap-1 rounded bg-[#145632] px-2.5 py-1.5 text-xs font-bold text-white hover:bg-[#0f4126] disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>تصدير CSV</span>
                    </button>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-1 gap-2.5 text-xs sm:grid-cols-2 lg:grid-cols-6">
                  <div className="relative lg:col-span-2">
                    <Search className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="بحث في التفاصيل أو اسم المستخدم..."
                      className="w-full rounded border border-slate-300 py-1.5 pr-8 pl-2.5"
                    />
                  </div>
                  <select
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">كل الإجراءات</option>
                    {Object.entries(AUDIT_ACTION_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                  <select
                    value={auditEntityFilter}
                    onChange={(e) => setAuditEntityFilter(e.target.value)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">كل الأقسام والكيانات</option>
                    {Object.entries(AUDIT_ENTITY_LABELS).map(([k, lbl]) => (
                      <option key={k} value={k}>
                        {lbl}
                      </option>
                    ))}
                  </select>
                  <select
                    value={auditUserFilter || ''}
                    onChange={(e) => setAuditUserFilter(e.target.value ? Number(e.target.value) : 0)}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value="">كل المستخدمين</option>
                    {auditActors.map((a) => (
                      <option key={a.user_id} value={a.user_id}>
                        {a.user_name} (#{a.user_id})
                      </option>
                    ))}
                  </select>
                  <select
                    value={auditLimit}
                    onChange={(e) => setAuditLimit(Number(e.target.value))}
                    className="rounded border border-slate-300 bg-white px-2.5 py-1.5"
                  >
                    <option value={150}>آخر 150 سجل</option>
                    <option value={300}>آخر 300 سجل</option>
                    <option value={500}>آخر 500 سجل</option>
                    <option value={1000}>آخر 1000 سجل</option>
                  </select>
                </div>

                <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="inline-flex items-center gap-1 font-semibold text-slate-600">
                      <Filter className="h-3.5 w-3.5" />
                      <span>نطاق التاريخ:</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span>من</span>
                      <input
                        type="date"
                        value={auditFrom}
                        onChange={(e) => setAuditFrom(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span>إلى</span>
                      <input
                        type="date"
                        value={auditTo}
                        onChange={(e) => setAuditTo(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                      />
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 font-bold text-red-700">
                      <input
                        type="checkbox"
                        checked={auditSensitiveOnly}
                        onChange={(e) => setAuditSensitiveOnly(e.target.checked)}
                        className="h-3.5 w-3.5 accent-red-600"
                      />
                      <span>العمليات الحساسة فقط</span>
                    </label>
                  </div>
                  {(auditSearch || auditActionFilter || auditEntityFilter || auditUserFilter || auditFrom || auditTo || auditSensitiveOnly) && (
                    <button
                      type="button"
                      onClick={() => {
                        setAuditSearch('');
                        setAuditActionFilter('');
                        setAuditEntityFilter('');
                        setAuditUserFilter(0);
                        setAuditFrom('');
                        setAuditTo('');
                        setAuditSensitiveOnly(false);
                      }}
                      className="text-xs font-bold text-[#0B4F9C] hover:underline"
                    >
                      إعادة ضبط الفلاتر
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto rounded border border-slate-200">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border-b border-slate-300 px-2.5 py-2">#</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">الوقت</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">مستوى الأهمية</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">المنفّذ</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">الإجراء</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">القسم / الكيان</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">التفاصيل الكاملة</th>
                        <th className="border-b border-slate-300 px-2.5 py-2">معاينة</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {auditLogs.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                            لا توجد سجلات مطابقة لمعايير البحث والتصفية الحالية.
                          </td>
                        </tr>
                      ) : (
                        auditLogs.map((l) => {
                          const sev = getAuditSeverity(l);
                          const badge = getAuditSeverityBadge(sev);
                          return (
                            <tr
                              key={l.id}
                              className={sev === 'high' ? 'bg-red-50/35 hover:bg-red-50/70' : 'hover:bg-slate-50'}
                            >
                              <td className="px-2.5 py-2 font-mono text-[11px] text-slate-500">#{l.id}</td>
                              <td className="px-2.5 py-2 font-mono text-[11px] whitespace-nowrap" dir="ltr">
                                {l.created_at}
                              </td>
                              <td className="px-2.5 py-2 whitespace-nowrap">
                                <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold ${badge.className}`}>
                                  {badge.label}
                                </span>
                              </td>
                              <td className="px-2.5 py-2">
                                <div className="font-bold text-slate-800">{l.user_name}</div>
                                <div className="font-mono text-[10px] text-slate-500">رقم #{l.user_id}</div>
                              </td>
                              <td className="px-2.5 py-2">
                                <div className="font-bold text-slate-800">{getAuditActionLabel(l.action)}</div>
                                <div className="font-mono text-[10px] text-slate-400">{l.action}</div>
                              </td>
                              <td className="px-2.5 py-2">
                                <div className="font-semibold text-sky-800">{getAuditEntityLabel(l.entity_type)}</div>
                                {l.entity_id !== null && l.entity_id !== undefined && (
                                  <div className="font-mono text-[10px] text-slate-500">معرّف #{l.entity_id}</div>
                                )}
                              </td>
                              <td className="max-w-md px-2.5 py-2 text-slate-700">{l.details}</td>
                              <td className="px-2.5 py-2">
                                <button
                                  type="button"
                                  onClick={() => setSelectedAuditLog(l)}
                                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                                >
                                  <Eye className="h-3 w-3" />
                                  <span>تفاصيل</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Selected Audit Log Entry Modal */}
      {selectedAuditLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-[#0B4F9C]" />
                <h3 className="text-sm font-bold text-slate-800">
                  تفاصيل سجل التدقيق رقم #{selectedAuditLog.id}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAuditLog(null)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4 text-xs">
              <div className="grid grid-cols-2 gap-3 rounded bg-slate-50 p-3">
                <div>
                  <span className="block text-[11px] text-slate-500">التاريخ والوقت</span>
                  <span className="font-mono font-bold text-slate-800" dir="ltr">
                    {selectedAuditLog.created_at}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">مستوى الحساسية</span>
                  <span
                    className={`mt-0.5 inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                      getAuditSeverityBadge(getAuditSeverity(selectedAuditLog)).className
                    }`}
                  >
                    {getAuditSeverityBadge(getAuditSeverity(selectedAuditLog)).label}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">المستخدم المنفّذ</span>
                  <span className="font-bold text-slate-800">
                    {selectedAuditLog.user_name} (رقم #{selectedAuditLog.user_id})
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">الإجراء</span>
                  <span className="font-bold text-slate-800">
                    {getAuditActionLabel(selectedAuditLog.action)}{' '}
                    <span className="font-mono text-[10px] text-slate-500">({selectedAuditLog.action})</span>
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">القسم / الكيان</span>
                  <span className="font-bold text-sky-800">
                    {getAuditEntityLabel(selectedAuditLog.entity_type)} ({selectedAuditLog.entity_type})
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-slate-500">رقم السجل / الكيان المرتبط</span>
                  <span className="font-mono font-bold text-slate-800">
                    {selectedAuditLog.entity_id ?? 'غير محدد'}
                  </span>
                </div>
              </div>
              <div className="rounded border border-slate-200 bg-white p-3">
                <div className="mb-1 text-[11px] font-bold text-slate-500">وصف وتفاصيل العملية:</div>
                <div className="leading-relaxed text-slate-800">{selectedAuditLog.details}</div>
              </div>
              <div className="flex justify-end border-t border-slate-200 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedAuditLog(null)}
                  className="rounded bg-[#0B4F9C] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#083D7A]"
                >
                  إغلاق
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <PrintPreviewModal
        open={previewOpen}
        title={
          tab === 'audit'
            ? 'تقرير سجل التدقيق الأمني والعمليات الحساسة'
            : 'كشف الموظفين والرواتب والحركات'
        }
        site={site}
        defaultPaperMode="a4"
        onClose={() => setPreviewOpen(false)}
      >
        {tab === 'audit' ? (
          <div className="space-y-3 text-xs">
            <div className="flex flex-wrap justify-between gap-2 rounded bg-slate-50 p-2.5 text-[11px]">
              <span>إجمالي السجلات: {auditLogs.length}</span>
              <span>العمليات الحساسة: {auditLogs.filter((l) => getAuditSeverity(l) === 'high').length}</span>
              {(auditFrom || auditTo) && (
                <span>
                  الفترة: {auditFrom || 'البداية'} إلى {auditTo || 'اليوم'}
                </span>
              )}
            </div>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">#</th>
                  <th className="border border-slate-300 px-2 py-1.5">الوقت</th>
                  <th className="border border-slate-300 px-2 py-1.5">الأهمية</th>
                  <th className="border border-slate-300 px-2 py-1.5">المستخدم</th>
                  <th className="border border-slate-300 px-2 py-1.5">الإجراء</th>
                  <th className="border border-slate-300 px-2 py-1.5">القسم</th>
                  <th className="border border-slate-300 px-2 py-1.5">التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="border border-slate-300 px-2 py-1.5 font-mono">#{l.id}</td>
                    <td className="border border-slate-300 px-2 py-1.5 font-mono" dir="ltr">
                      {l.created_at}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">
                      {getAuditSeverityBadge(getAuditSeverity(l)).label}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">{l.user_name}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{getAuditActionLabel(l.action)}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{getAuditEntityLabel(l.entity_type)}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{l.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <h4 className="font-bold">قائمة الموظفين</h4>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">الاسم</th>
                  <th className="border border-slate-300 px-2 py-1.5">المسمى</th>
                  <th className="border border-slate-300 px-2 py-1.5">الراتب الأساسي</th>
                  <th className="border border-slate-300 px-2 py-1.5">العمولة</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">{e.full_name}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{e.job_title}</td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      {formatMoney(e.base_salary, site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5">{e.commission_rate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {transactions.length > 0 && (
              <>
                <h4 className="pt-2 font-bold">آخر حركات الرواتب والسلف</h4>
                <table className="w-full border-collapse text-right">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-2 py-1.5">التاريخ</th>
                      <th className="border border-slate-300 px-2 py-1.5">الموظف</th>
                      <th className="border border-slate-300 px-2 py-1.5">النوع</th>
                      <th className="border border-slate-300 px-2 py-1.5">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 30).map((t) => (
                      <tr key={t.id}>
                        <td className="border border-slate-300 px-2 py-1.5">{t.tx_date}</td>
                        <td className="border border-slate-300 px-2 py-1.5">{t.full_name}</td>
                        <td className="border border-slate-300 px-2 py-1.5">{TX_TYPE_LABELS[t.tx_type]}</td>
                        <td className="border border-slate-300 px-2 py-1.5 font-bold">
                          {formatMoney(t.amount, site.currencySymbol)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </PrintPreviewModal>
    </div>
  );
};
