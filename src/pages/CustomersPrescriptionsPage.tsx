import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Stethoscope,
  FileText,
  Plus,
  Edit3,
  Trash2,
  Printer,
  ShoppingBag,
  AlertCircle,
  CheckCircle2,
  X,
  Info,
} from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type {
  Customer,
  Doctor,
  InventoryItem,
  Prescription,
  SiteSettings,
  User,
} from '../types';
import { formatMoney, hasPermission } from '../types';
import { ConfirmModal } from '../components/ConfirmModal';
import { PrintPreviewModal } from '../components/PrintPreviewModal';

interface CustomersPrescriptionsPageProps {
  user: User;
  site: SiteSettings;
  inventories: InventoryItem[];
  onDispensePrescription: (prescription: Prescription) => Promise<void>;
  onCustomersChanged: () => Promise<void>;
}

export const CustomersPrescriptionsPage: React.FC<CustomersPrescriptionsPageProps> = ({
  user,
  site,
  inventories,
  onDispensePrescription,
  onCustomersChanged,
}) => {
  const canCustomers = hasPermission(user, 'manageCustomers');
  const canPrescriptions = hasPermission(user, 'managePrescriptions');

  const [tab, setTab] = useState<'customers' | 'prescriptions' | 'doctors'>(
    canCustomers ? 'customers' : 'prescriptions',
  );
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);

  // Customer Form
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [custName, setCustName] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custAddress, setCustAddress] = useState('');
  const [custCreditLimit, setCustCreditLimit] = useState('0');
  const [custNotes, setCustNotes] = useState('');
  const [custAllergies, setCustAllergies] = useState('');
  const [custChronic, setCustChronic] = useState('');
  const [savingCust, setSavingCust] = useState(false);
  const [confirmDeleteCust, setConfirmDeleteCust] = useState<Customer | null>(null);

  // Customer Statement & Print Preview
  const [custStatement, setCustStatement] = useState<{
    customer: Customer;
    invoices: Array<Record<string, unknown>>;
    payments: Array<Record<string, unknown>>;
    prescriptions: Array<Record<string, unknown>>;
  } | null>(null);

  // Doctor Form
  const [editingDoctor, setEditingDoctor] = useState<Doctor | null>(null);
  const [docName, setDocName] = useState('');
  const [docSpecialty, setDocSpecialty] = useState('');
  const [docClinic, setDocClinic] = useState('');
  const [docPhone, setDocPhone] = useState('');
  const [docLicense, setDocLicense] = useState('');
  const [savingDoc, setSavingDoc] = useState(false);

  // Prescription Form
  const [rxCustomerId, setRxCustomerId] = useState<number>(0);
  const [rxDoctorId, setRxDoctorId] = useState<number>(0);
  const [rxDate, setRxDate] = useState(new Date().toISOString().slice(0, 10));
  const [rxNotes, setRxNotes] = useState('');
  const [rxType, setRxType] = useState('standard');
  const [rxRefillsAllowed, setRxRefillsAllowed] = useState('0');
  const [rxItems, setRxItems] = useState<
    Array<{ medicineId: number | null; medicineName: string; dosage: string; frequency: string; duration: string; qty: number }>
  >([{ medicineId: null, medicineName: '', dosage: '1 قرص', frequency: 'كل 12 ساعة', duration: '5 أيام', qty: 1 }]);
  const [savingRx, setSavingRx] = useState(false);
  const [previewRx, setPreviewRx] = useState<Prescription | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [custRes, docRes, rxRes] = await Promise.all([
        api.getCustomers(),
        api.getDoctors(),
        canPrescriptions ? api.getPrescriptions() : Promise.resolve({ prescriptions: [] }),
      ]);
      setCustomers(custRes.customers);
      setDoctors(docRes.doctors);
      setPrescriptions(rxRes.prescriptions);
      setRxCustomerId((prev) =>
        custRes.customers.some((c) => c.id === prev) ? prev : (custRes.customers[0]?.id ?? 0),
      );
      setRxDoctorId((prev) =>
        prev === 0 || docRes.doctors.some((d) => d.id === prev) ? prev : (docRes.doctors[0]?.id ?? 0),
      );
    } catch (err) {
      showErrorPopup(err, 'تحميل بيانات العملاء والوصفات الطبية');
    } finally {
      setLoading(false);
    }
  }, [canPrescriptions]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!custName.trim()) {
      validationError(
        'يرجى إدخال اسم العميل أو المريض قبل الحفظ.',
        editingCustomer ? 'تعديل بيانات عميل' : 'إضافة عميل جديد',
        ['حقل اسم العميل الإلزامي فارغ.'],
      );
      return;
    }
    const creditNum = Number(custCreditLimit);
    if (custCreditLimit !== '' && (!Number.isFinite(creditNum) || creditNum < 0)) {
      validationError(
        'حد الائتمان يجب أن يكون رقماً صفرياً أو موجباً.',
        editingCustomer ? 'تعديل بيانات عميل' : 'إضافة عميل جديد',
        ['تم إدخال قيمة سالبة أو غير رقمية في حقل حد الائتمان.'],
      );
      return;
    }
    setSavingCust(true);
    setStatusMsg('');
    try {
      const payload = {
        name: custName.trim(),
        phone: custPhone.trim(),
        address: custAddress.trim(),
        creditLimit: Math.max(0, Number(custCreditLimit) || 0),
        notes: custNotes.trim(),
        allergies: custAllergies.trim(),
        chronicConditions: custChronic.trim(),
      };
      if (editingCustomer) {
        await api.updateCustomer(editingCustomer.id, payload);
        setStatusMsg('تم تعديل بيانات العميل بنجاح');
      } else {
        await api.createCustomer(payload);
        setStatusMsg('تم إضافة العميل بنجاح');
      }
      setEditingCustomer(null);
      setCustName('');
      setCustPhone('');
      setCustAddress('');
      setCustCreditLimit('0');
      setCustNotes('');
      setCustAllergies('');
      setCustChronic('');
      await Promise.all([loadAll(), onCustomersChanged()]);
    } catch (err) {
      showErrorPopup(err, editingCustomer ? 'تعديل بيانات عميل' : 'إضافة عميل جديد');
    } finally {
      setSavingCust(false);
    }
  };

  const handleDeleteCustomer = async () => {
    if (!confirmDeleteCust) return;
    try {
      await api.deleteCustomer(confirmDeleteCust.id);
      setConfirmDeleteCust(null);
      setStatusMsg('تم حذف العميل');
      await Promise.all([loadAll(), onCustomersChanged()]);
    } catch (err) {
      showErrorPopup(err, `حذف العميل: ${confirmDeleteCust.name}`);
      setConfirmDeleteCust(null);
    }
  };

  const openCustomerStatement = async (c: Customer) => {
    try {
      const res = await api.getCustomerStatement(c.id);
      setCustStatement(res);
    } catch (err) {
      showErrorPopup(err, `فتح كشف حساب العميل: ${c.name}`);
    }
  };

  const handleSaveDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName.trim()) {
      validationError(
        'يرجى إدخال اسم الطبيب المعالج قبل الحفظ.',
        editingDoctor ? 'تعديل بيانات طبيب' : 'تسجيل طبيب جديد',
        ['حقل اسم الطبيب الإلزامي فارغ.'],
      );
      return;
    }
    setSavingDoc(true);
    setStatusMsg('');
    try {
      const payload = {
        name: docName.trim(),
        specialty: docSpecialty.trim(),
        clinic: docClinic.trim(),
        phone: docPhone.trim(),
        licenseNumber: docLicense.trim(),
      };
      if (editingDoctor) {
        await api.updateDoctor(editingDoctor.id, payload);
        setStatusMsg('تم تحديث بيانات الطبيب');
      } else {
        await api.createDoctor(payload);
        setStatusMsg('تم تسجيل الطبيب بنجاح');
      }
      setEditingDoctor(null);
      setDocName('');
      setDocSpecialty('');
      setDocClinic('');
      setDocPhone('');
      setDocLicense('');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, editingDoctor ? 'تعديل بيانات طبيب' : 'تسجيل طبيب جديد');
    } finally {
      setSavingDoc(false);
    }
  };

  const handleCreateRx = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = rxItems.filter((it) => it.medicineName.trim() !== '' && it.qty > 0);
    if (!rxCustomerId || !customers.some((c) => c.id === rxCustomerId)) {
      validationError(
        'يرجى اختيار المريض / العميل من القائمة قبل حفظ الوصفة.',
        'تسجيل وصفة طبية جديدة',
        ['لم يتم تحديد عميل أو مريض صالح من سجل العملاء الحاليين.'],
      );
      return;
    }
    if (valid.length === 0) {
      validationError(
        'يرجى إضافة دواء واحد على الأقل مع تحديد اسمه وكمية أكبر من الصفر.',
        'تسجيل وصفة طبية جديدة',
        ['قائمة الأدوية في الوصفة فارغة أو تحتوي على كميات غير صالحة.'],
      );
      return;
    }
    setSavingRx(true);
    setStatusMsg('');
    try {
      await api.createPrescription({
        customerId: rxCustomerId,
        doctorId: rxDoctorId || null,
        prescriptionDate: rxDate,
        referenceNotes: rxNotes.trim(),
        rxType,
        refillsAllowed: Math.max(0, Number(rxRefillsAllowed) || 0),
        items: valid,
      });
      setRxNotes('');
      setRxType('standard');
      setRxRefillsAllowed('0');
      setRxItems([{ medicineId: null, medicineName: '', dosage: '1 قرص', frequency: 'كل 12 ساعة', duration: '5 أيام', qty: 1 }]);
      setStatusMsg('تم تسجيل الوصفة الطبية بنجاح');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'تسجيل وصفة طبية جديدة');
    } finally {
      setSavingRx(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">العملاء والأطباء والوصفات الطبية</span>
          <span className="mx-1">/</span>
          <span>الذمم والائتمان وكشف الحساب والوصفات المرتبطة بنقطة البيع</span>
        </div>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded border border-slate-300 bg-white p-2 shadow-sm">
        {canCustomers && (
          <button
            type="button"
            onClick={() => setTab('customers')}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
              tab === 'customers' ? 'bg-[#0B4F9C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>دليل العملاء وحد الائتمان</span>
          </button>
        )}
        {canPrescriptions && (
          <>
            <button
              type="button"
              onClick={() => setTab('prescriptions')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
                tab === 'prescriptions' ? 'bg-[#0B4F9C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>سجل الوصفات الطبية والصرف</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('doctors')}
              className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-bold ${
                tab === 'doctors' ? 'bg-[#0B4F9C] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Stethoscope className="h-3.5 w-3.5" />
              <span>دليل الأطباء المعتمدين</span>
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          جاري التحميل...
        </div>
      ) : (
        <>
          {/* Tab 1: Customers */}
          {tab === 'customers' && canCustomers && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  {editingCustomer ? `تعديل العميل: ${editingCustomer.name}` : 'إضافة عميل جديد'}
                </h3>
                <form onSubmit={handleSaveCustomer} noValidate className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">اسم العميل / المريض *</label>
                    <input
                      type="text"
                      required
                      value={custName}
                      onChange={(e) => setCustName(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">رقم الهاتف</label>
                    <input
                      type="text"
                      value={custPhone}
                      onChange={(e) => setCustPhone(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">العنوان</label>
                    <input
                      type="text"
                      value={custAddress}
                      onChange={(e) => setCustAddress(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">حد الائتمان المسموح (للبيع الآجل)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={custCreditLimit}
                      onChange={(e) => setCustCreditLimit(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الحساسية الدوائية (تفحص تلقائياً في POS)</label>
                    <input
                      type="text"
                      value={custAllergies}
                      onChange={(e) => setCustAllergies(e.target.value)}
                      placeholder="مثال: Penicillin, Sulfa, NSAIDs"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الأمراض المزمنة</label>
                    <input
                      type="text"
                      value={custChronic}
                      onChange={(e) => setCustChronic(e.target.value)}
                      placeholder="مثال: سكري، ضغط"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">ملاحظات</label>
                    <input
                      type="text"
                      value={custNotes}
                      onChange={(e) => setCustNotes(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingCust}
                      className="flex-1 rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                    >
                      {savingCust ? 'جاري الحفظ...' : editingCustomer ? 'حفظ التعديل' : 'إضافة العميل'}
                    </button>
                    {editingCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCustomer(null);
                          setCustName('');
                          setCustPhone('');
                          setCustAddress('');
                          setCustCreditLimit('0');
                          setCustNotes('');
                          setCustAllergies('');
                          setCustChronic('');
                        }}
                        className="rounded border border-slate-300 px-3 py-2 text-slate-700"
                      >
                        إلغاء
                      </button>
                    )}
                  </div>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل العملاء وأرصدة الذمم ({customers.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">العميل</th>
                        <th className="border border-slate-300 px-2.5 py-2">الهاتف</th>
                        <th className="border border-slate-300 px-2.5 py-2">حد الائتمان</th>
                        <th className="border border-slate-300 px-2.5 py-2">الرصيد المستحق</th>
                        <th className="border border-slate-300 px-2.5 py-2">الفواتير</th>
                        <th className="border border-slate-300 px-2.5 py-2">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2.5 py-2 font-bold text-slate-800">
                            <div>{c.name}</div>
                            {(c.loyalty_points || 0) > 0 && (
                              <div className="text-[10px] font-semibold text-[#0B4F9C]">
                                ولاء: {c.loyalty_points} نقطة ({c.loyalty_tier || 'عادي'})
                              </div>
                            )}
                            {c.allergies && (
                              <div className="text-[10px] font-semibold text-red-700">حساسية: {c.allergies}</div>
                            )}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2 font-mono">{c.phone || '—'}</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            {formatMoney(c.credit_limit, site.currencySymbol)}
                          </td>
                          <td
                            className={`border border-slate-200 px-2.5 py-2 font-bold ${
                              c.balance > 0 ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {formatMoney(c.balance, site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2">{c.invoiceCount || 0}</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={() => void openCustomerStatement(c)}
                                className="rounded bg-[#0B4F9C] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#2b688c]"
                              >
                                كشف حساب
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingCustomer(c);
                                  setCustName(c.name);
                                  setCustPhone(c.phone);
                                  setCustAddress(c.address);
                                  setCustCreditLimit(String(c.credit_limit));
                                  setCustNotes(c.notes);
                                  setCustAllergies(c.allergies || '');
                                  setCustChronic(c.chronic_conditions || '');
                                }}
                                className="rounded bg-amber-500 px-2 py-1 text-[11px] text-white hover:bg-amber-600"
                              >
                                <Edit3 className="h-3 w-3" />
                              </button>
                              {c.name !== 'عميل نقدي عام' && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCust(c)}
                                  className="rounded bg-red-600 px-2 py-1 text-[11px] text-white hover:bg-red-700"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Prescriptions */}
          {tab === 'prescriptions' && canPrescriptions && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                <span>
                  سجل الوصفات والجرعات المذكورة هنا هو سجل مرجعي إداري للبيانات الموصوفة من الطبيب المختص ويخضع بالكامل لإشراف ومراجعة الصيدلاني المرخص عند الصرف.
                </span>
              </div>

              <form onSubmit={handleCreateRx} noValidate className="space-y-3 rounded border border-slate-300 bg-white p-4 shadow-sm text-xs">
                <h3 className="border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  تسجيل وصفة طبية جديدة
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <div>
                    <label className="mb-1 block font-semibold">المريض / العميل *</label>
                    <select
                      value={rxCustomerId}
                      onChange={(e) => setRxCustomerId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الطبيب المعالج</label>
                    <select
                      value={rxDoctorId}
                      onChange={(e) => setRxDoctorId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value={0}>غير محدد</option>
                      {doctors.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.specialty || 'طبيب'})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">تاريخ الوصفة</label>
                    <input
                      type="date"
                      value={rxDate}
                      onChange={(e) => setRxDate(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">نوع الوصفة</label>
                    <select
                      value={rxType}
                      onChange={(e) => setRxType(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value="standard">عادية</option>
                      <option value="chronic">مزمنة (قابلة للتجديد)</option>
                      <option value="controlled">وصفة أدوية مقيدة</option>
                      <option value="insurance">مغطاة بتأمين</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">مرات إعادة الصرف (Refills)</label>
                    <input
                      type="number"
                      min={0}
                      max={12}
                      value={rxRefillsAllowed}
                      onChange={(e) => setRxRefillsAllowed(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold">ملاحظات مرجعية</label>
                    <input
                      type="text"
                      value={rxNotes}
                      onChange={(e) => setRxNotes(e.target.value)}
                      placeholder="تعليمات الطبيب"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">الأدوية المدونة بالوصفة:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setRxItems((prev) => [
                          ...prev,
                          { medicineId: null, medicineName: '', dosage: '1 قرص', frequency: 'كل 12 ساعة', duration: '5 أيام', qty: 1 },
                        ])
                      }
                      className="inline-flex items-center gap-1 font-bold text-[#0B4F9C] hover:underline"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة دواء</span>
                    </button>
                  </div>
                  {rxItems.map((it, idx) => (
                    <div key={idx} className="grid grid-cols-1 gap-2 rounded border border-slate-200 bg-slate-50 p-2 sm:grid-cols-6">
                      <select
                        value={it.medicineId || 0}
                        onChange={(e) => {
                          const mid = Number(e.target.value);
                          const found = inventories.find((m) => m.id === mid);
                          setRxItems((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? { ...row, medicineId: mid || null, medicineName: found ? found.name : row.medicineName }
                                : row,
                            ),
                          );
                        }}
                        className="rounded border border-slate-300 bg-white px-2 py-1.5 sm:col-span-2"
                      >
                        <option value={0}>ربط بدواء من المخزون (أو اكتب الاسم)...</option>
                        {inventories.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} (متوفر: {m.quantity})
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        value={it.medicineName}
                        onChange={(e) =>
                          setRxItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, medicineName: e.target.value } : row)),
                          )
                        }
                        placeholder="اسم الدواء *"
                        className="rounded border border-slate-300 bg-white px-2 py-1.5"
                      />
                      <input
                        type="text"
                        value={it.dosage}
                        onChange={(e) =>
                          setRxItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, dosage: e.target.value } : row)),
                          )
                        }
                        placeholder="الجرعة"
                        className="rounded border border-slate-300 bg-white px-2 py-1.5"
                      />
                      <input
                        type="text"
                        value={it.frequency}
                        onChange={(e) =>
                          setRxItems((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, frequency: e.target.value } : row)),
                          )
                        }
                        placeholder="التكرار"
                        className="rounded border border-slate-300 bg-white px-2 py-1.5"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={1}
                          value={it.qty}
                          onChange={(e) =>
                            setRxItems((prev) =>
                              prev.map((row, i) => (i === idx ? { ...row, qty: Number(e.target.value) } : row)),
                            )
                          }
                          className="w-16 rounded border border-slate-300 bg-white px-2 py-1.5 text-center"
                        />
                        {rxItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setRxItems((prev) => prev.filter((_, i) => i !== idx))}
                            className="p-1 text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={savingRx}
                  className="rounded bg-[#145632] px-5 py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                >
                  {savingRx ? 'جاري التسجيل...' : 'حفظ الوصفة الطبية'}
                </button>
              </form>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل الوصفات الطبية ({prescriptions.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">#</th>
                        <th className="border border-slate-300 px-2.5 py-2">المريض / العميل</th>
                        <th className="border border-slate-300 px-2.5 py-2">الطبيب</th>
                        <th className="border border-slate-300 px-2.5 py-2">الأدوية والجرعات</th>
                        <th className="border border-slate-300 px-2.5 py-2">التاريخ</th>
                        <th className="border border-slate-300 px-2.5 py-2">الحالة</th>
                        <th className="border border-slate-300 px-2.5 py-2">إجراءات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prescriptions.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد وصفات مسجلة
                          </td>
                        </tr>
                      ) : (
                        prescriptions.map((rx) => (
                          <tr key={rx.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">#{rx.id}</td>
                            <td className="border border-slate-200 px-2.5 py-2 font-semibold">{rx.customer_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2">{rx.doctor_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {rx.items.map((it) => `${it.medicine_name} (${it.dosage} - ${it.frequency} ×${it.qty})`).join(' | ')}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2 font-mono text-[11px]">
                              {rx.prescription_date}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <span
                                className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                  rx.status === 'dispensed'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : rx.status === 'cancelled'
                                      ? 'bg-red-100 text-red-800'
                                      : 'bg-amber-100 text-amber-800'
                                }`}
                              >
                                {rx.status === 'dispensed'
                                  ? 'تم الصرف'
                                  : rx.status === 'cancelled'
                                    ? 'ملغاة'
                                    : 'جاهزة للصرف'}
                              </span>
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <div className="flex flex-wrap gap-1">
                                {rx.status === 'pending' && hasPermission(user, 'posBilling') && (
                                  <button
                                    type="button"
                                    onClick={() => void onDispensePrescription(rx)}
                                    className="inline-flex items-center gap-1 rounded bg-[#145632] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#0f4226]"
                                  >
                                    <ShoppingBag className="h-3 w-3" />
                                    <span>صرف إلى نقطة البيع</span>
                                  </button>
                                )}
                                {rx.status === 'dispensed' &&
                                  (rx.refills_used || 0) < (rx.refills_allowed || 0) && (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          await api.refillPrescription(rx.id);
                                          setStatusMsg(`تم تفعيل إعادة الصرف للوصفة #${rx.id}`);
                                          await loadAll();
                                        } catch (err) {
                                          showErrorPopup(err, `إعادة صرف الوصفة #${rx.id}`);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 rounded bg-[#0B4F9C] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#083D7A]"
                                    >
                                      <span>إعادة صرف (Refill)</span>
                                    </button>
                                  )}
                                <button
                                  type="button"
                                  onClick={() => setPreviewRx(rx)}
                                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                                >
                                  <Printer className="h-3 w-3" />
                                  <span>طباعة</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Doctors */}
          {tab === 'doctors' && canPrescriptions && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  {editingDoctor ? `تعديل الطبيب: ${editingDoctor.name}` : 'تسجيل طبيب جديد'}
                </h3>
                <form onSubmit={handleSaveDoctor} noValidate className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">اسم الطبيب *</label>
                    <input
                      type="text"
                      required
                      value={docName}
                      onChange={(e) => setDocName(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">التخصص</label>
                    <input
                      type="text"
                      value={docSpecialty}
                      onChange={(e) => setDocSpecialty(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">العيادة / المستشفى</label>
                    <input
                      type="text"
                      value={docClinic}
                      onChange={(e) => setDocClinic(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">الهاتف</label>
                    <input
                      type="text"
                      value={docPhone}
                      onChange={(e) => setDocPhone(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">رقم الترخيص</label>
                    <input
                      type="text"
                      value={docLicense}
                      onChange={(e) => setDocLicense(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2 font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingDoc}
                    className="w-full rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                  >
                    {savingDoc ? 'جاري الحفظ...' : editingDoctor ? 'تحديث البيانات' : 'حفظ الطبيب'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  قائمة الأطباء ({doctors.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">الاسم</th>
                        <th className="border border-slate-300 px-2.5 py-2">التخصص</th>
                        <th className="border border-slate-300 px-2.5 py-2">العيادة</th>
                        <th className="border border-slate-300 px-2.5 py-2">الهاتف</th>
                        <th className="border border-slate-300 px-2.5 py-2">الوصفات</th>
                        <th className="border border-slate-300 px-2.5 py-2">تعديل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctors.map((d) => (
                        <tr key={d.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2.5 py-2 font-bold">{d.name}</td>
                          <td className="border border-slate-200 px-2.5 py-2">{d.specialty || '—'}</td>
                          <td className="border border-slate-200 px-2.5 py-2">{d.clinic || '—'}</td>
                          <td className="border border-slate-200 px-2.5 py-2 font-mono">{d.phone || '—'}</td>
                          <td className="border border-slate-200 px-2.5 py-2">{d.prescriptionCount || 0}</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingDoctor(d);
                                setDocName(d.name);
                                setDocSpecialty(d.specialty);
                                setDocClinic(d.clinic);
                                setDocPhone(d.phone);
                                setDocLicense(d.license_number);
                              }}
                              className="rounded bg-amber-500 px-2 py-1 text-[11px] text-white hover:bg-amber-600"
                            >
                              تعديل
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
        </>
      )}

      {/* Confirm Delete Customer */}
      <ConfirmModal
        open={Boolean(confirmDeleteCust)}
        title="تأكيد حذف العميل"
        message={`هل تريد حذف ملف العميل "${confirmDeleteCust?.name}"؟`}
        confirmLabel="حذف"
        onConfirm={() => void handleDeleteCustomer()}
        onCancel={() => setConfirmDeleteCust(null)}
      />

      {/* Customer Statement Fullscreen Print Preview */}
      <PrintPreviewModal
        open={Boolean(custStatement)}
        title={`كشف حساب العميل: ${custStatement?.customer.name || ''}`}
        site={site}
        defaultPaperMode="a4"
        onClose={() => setCustStatement(null)}
      >
        {custStatement && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-3 rounded border border-slate-300 bg-slate-50 p-3">
              <div>
                <strong>العميل:</strong> {custStatement.customer.name}
              </div>
              <div>
                <strong>حد الائتمان:</strong> {formatMoney(custStatement.customer.credit_limit, site.currencySymbol)}
              </div>
              <div>
                <strong>الرصيد المستحق:</strong>{' '}
                <span className="font-bold text-red-700">
                  {formatMoney(custStatement.customer.balance, site.currencySymbol)}
                </span>
              </div>
            </div>
            <h4 className="font-bold">الفواتير المسجلة ({custStatement.invoices.length})</h4>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1">رقم الفاتورة</th>
                  <th className="border border-slate-300 px-2 py-1">الإجمالي</th>
                  <th className="border border-slate-300 px-2 py-1">المدفوع</th>
                  <th className="border border-slate-300 px-2 py-1">المتبقي آجل</th>
                  <th className="border border-slate-300 px-2 py-1">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {custStatement.invoices.map((inv) => (
                  <tr key={String(inv.id)}>
                    <td className="border border-slate-300 px-2 py-1">#{String(inv.id)}</td>
                    <td className="border border-slate-300 px-2 py-1">
                      {formatMoney(String(inv.amount || 0), site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">
                      {formatMoney(Number(inv.paid_amount || 0), site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 font-bold text-red-700">
                      {formatMoney(Number(inv.remaining_amount || 0), site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1">{String(inv.date || '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {custStatement.payments.length > 0 && (
              <>
                <h4 className="pt-2 font-bold">سندات التحصيل / الدفعات ({custStatement.payments.length})</h4>
                <table className="w-full border-collapse text-right">
                  <thead>
                    <tr className="bg-slate-100">
                      <th className="border border-slate-300 px-2 py-1">#</th>
                      <th className="border border-slate-300 px-2 py-1">المبلغ</th>
                      <th className="border border-slate-300 px-2 py-1">البيان</th>
                      <th className="border border-slate-300 px-2 py-1">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custStatement.payments.map((p) => (
                      <tr key={String(p.id)}>
                        <td className="border border-slate-300 px-2 py-1">#{String(p.id)}</td>
                        <td className="border border-slate-300 px-2 py-1 font-bold text-emerald-700">
                          {formatMoney(Number(p.amount || 0), site.currencySymbol)}
                        </td>
                        <td className="border border-slate-300 px-2 py-1">{String(p.description || '')}</td>
                        <td className="border border-slate-300 px-2 py-1">{String(p.voucher_date || '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </PrintPreviewModal>

      {/* Prescription Print Preview */}
      <PrintPreviewModal
        open={Boolean(previewRx)}
        title={`وصفة طبية #${previewRx?.id || ''}`}
        site={site}
        defaultPaperMode="a4"
        onClose={() => setPreviewRx(null)}
      >
        {previewRx && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2 rounded border border-slate-300 bg-slate-50 p-3">
              <div>
                <strong>المريض:</strong> {previewRx.customer_name}
              </div>
              <div>
                <strong>الطبيب:</strong> {previewRx.doctor_name}
              </div>
              <div>
                <strong>التاريخ:</strong> {previewRx.prescription_date}
              </div>
              <div>
                <strong>ملاحظات:</strong> {previewRx.reference_notes || '—'}
              </div>
            </div>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">الدواء</th>
                  <th className="border border-slate-300 px-2 py-1.5">الجرعة</th>
                  <th className="border border-slate-300 px-2 py-1.5">التكرار</th>
                  <th className="border border-slate-300 px-2 py-1.5">المدة</th>
                  <th className="border border-slate-300 px-2 py-1.5">الكمية</th>
                </tr>
              </thead>
              <tbody>
                {previewRx.items.map((it) => (
                  <tr key={it.id}>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">{it.medicine_name}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{it.dosage}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{it.frequency}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{it.duration}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{it.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-slate-200 pt-2 text-[11px] text-slate-500">
              يُصرف هذا السجل تحت إشراف الصيدلاني المناوب وبعد التحقق من التشغيلات الصالحة.
            </p>
          </div>
        )}
      </PrintPreviewModal>
    </div>
  );
};
