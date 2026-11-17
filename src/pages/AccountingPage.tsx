import React, { useCallback, useEffect, useState } from 'react';
import {
  Landmark,
  ReceiptText,
  BookOpen,
  Scale,
  Plus,
  Printer,
  CheckCircle2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type {
  Account,
  CashBox,
  Customer,
  JournalEntry,
  SiteSettings,
  Supplier,
  Voucher,
} from '../types';
import { formatMoney } from '../types';
import { PrintPreviewModal } from '../components/PrintPreviewModal';
import { showErrorPopup, validationError } from '../lib/errorPopup';

interface AccountingPageProps {
  site: SiteSettings;
  suppliers: Supplier[];
  customers: Customer[];
  onDataMutated: () => Promise<void>;
}

const ACCOUNT_TYPE_LABELS: Record<Account['account_type'], string> = {
  asset: 'أصول',
  liability: 'خصوم / التزامات',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

const VOUCHER_TYPE_LABELS: Record<Voucher['voucher_type'], string> = {
  receipt: 'سند قبض (عميل / تحصيل)',
  payment: 'سند صرف (مورد / سداد)',
  expense: 'سند مصروف تشغيلي',
  income: 'سند إيرادات أخرى',
  capital: 'إيداع رأس مال',
};

export const AccountingPage: React.FC<AccountingPageProps> = ({
  site,
  suppliers,
  customers,
  onDataMutated,
}) => {
  const [tab, setTab] = useState<'vouchers' | 'accounts' | 'journals' | 'statements'>('vouchers');
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cashBoxes, setCashBoxes] = useState<CashBox[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [statements, setStatements] = useState<{
    trialBalance: Array<Record<string, unknown>>;
    trialTotals: { debit: number; credit: number };
    incomeStatement: {
      revenues: Array<Record<string, unknown>>;
      expenses: Array<Record<string, unknown>>;
      totalRevenue: number;
      totalExpense: number;
      netProfit: number;
    };
    balanceSheet: {
      assets: Array<Record<string, unknown>>;
      liabilities: Array<Record<string, unknown>>;
      equity: Array<Record<string, unknown>>;
      retainedEarnings: number;
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
    };
  } | null>(null);

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Voucher Form
  const [voucherType, setVoucherType] = useState<Voucher['voucher_type']>('receipt');
  const [cashBoxId, setCashBoxId] = useState<number>(0);
  const [counterpartyId, setCounterpartyId] = useState<number>(0);
  const [targetAccountId, setTargetAccountId] = useState<number>(0);
  const [voucherAmount, setVoucherAmount] = useState<string>('');
  const [voucherDesc, setVoucherDesc] = useState('');
  const [voucherDate, setVoucherDate] = useState(new Date().toISOString().slice(0, 10));
  const [savingVoucher, setSavingVoucher] = useState(false);

  // Add Account Form
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<Account['account_type']>('expense');
  const [savingAcc, setSavingAcc] = useState(false);

  // Account Statement Modal
  const [accStatement, setAccStatement] = useState<{
    account: Account;
    movements: Array<Record<string, unknown>>;
  } | null>(null);

  // Manual Journal Modal
  const [journalDesc, setJournalDesc] = useState('');
  const [journalDate, setJournalDate] = useState(new Date().toISOString().slice(0, 10));
  const [journalLines, setJournalLines] = useState<Array<{ accountId: number; debit: number; credit: number }>>([
    { accountId: 0, debit: 0, credit: 0 },
    { accountId: 0, debit: 0, credit: 0 },
  ]);
  const [savingJournal, setSavingJournal] = useState(false);

  // Print Preview Statements or Voucher
  const [previewStatements, setPreviewStatements] = useState(false);
  const [previewVoucher, setPreviewVoucher] = useState<Voucher | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, vRes, jRes, stRes] = await Promise.all([
        api.getAccounts(),
        api.getVouchers(),
        api.getJournals(fromDate || undefined, toDate || undefined),
        api.getAccountingStatements(fromDate || undefined, toDate || undefined),
      ]);
      setAccounts(accRes.accounts);
      setCashBoxes(accRes.cashBoxes);
      setVouchers(vRes.vouchers);
      setJournals(jRes.journals);
      setStatements(stRes);
      setCashBoxId((prev) =>
        accRes.cashBoxes.some((c) => c.id === prev) ? prev : (accRes.cashBoxes[0]?.id ?? 0),
      );
    } catch (err) {
      showErrorPopup(err, 'تحميل البيانات المحاسبية والمالية');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleCreateVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cashBoxId || !cashBoxes.some((c) => c.id === cashBoxId)) {
      validationError('يرجى اختيار الصندوق أو الحساب البنكي أولاً.', 'إصدار سند مالي');
      return;
    }
    const amt = Number(voucherAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      validationError('يرجى إدخال مبلغ صحيح أكبر من صفر.', 'إصدار سند مالي');
      return;
    }
    if (!voucherDesc.trim()) {
      validationError('يرجى إدخال بيان أو وصف للسند المالي.', 'إصدار سند مالي');
      return;
    }
    setSavingVoucher(true);
    setStatusMsg('');
    try {
      await api.createVoucher({
        voucherType,
        cashBoxId,
        amount: amt,
        description: voucherDesc.trim() || VOUCHER_TYPE_LABELS[voucherType],
        voucherDate,
        counterpartyId:
          (voucherType === 'receipt' || voucherType === 'payment') && counterpartyId ? counterpartyId : null,
        accountId:
          (voucherType === 'expense' || voucherType === 'income') && targetAccountId ? targetAccountId : null,
      });
      setVoucherAmount('');
      setVoucherDesc('');
      setCounterpartyId(0);
      setStatusMsg('تم ترحيل السند المالي والقيد المحاسبي المزدوج بنجاح');
      await Promise.all([loadAll(), onDataMutated()]);
    } catch (err) {
      showErrorPopup(err, 'إصدار وترحيل السند المالي');
    } finally {
      setSavingVoucher(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accCode.trim() || !accName.trim()) {
      validationError('رقم الحساب واسم الحساب مطلوبان لإضافته في دليل الحسابات.', 'إضافة حساب جديد');
      return;
    }
    setSavingAcc(true);
    setStatusMsg('');
    try {
      await api.createAccount({ code: accCode.trim(), name: accName.trim(), accountType: accType });
      setAccCode('');
      setAccName('');
      setStatusMsg('تم إضافة الحساب في دليل الحسابات');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'إضافة حساب في دليل الحسابات');
    } finally {
      setSavingAcc(false);
    }
  };

  const handleCreateJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    const valid = journalLines.filter((l) => l.accountId > 0 && (l.debit > 0 || l.credit > 0));
    const sumD = valid.reduce((s, l) => s + Number(l.debit || 0), 0);
    const sumC = valid.reduce((s, l) => s + Number(l.credit || 0), 0);
    if (!journalDesc.trim() || valid.length < 2) {
      validationError('يرجى إدخال وصف القيد وإضافة سطرين محاسبيين على الأقل.', 'ترحيل قيد يومية');
      return;
    }
    if (valid.some((l) => l.debit < 0 || l.credit < 0 || (l.debit > 0 && l.credit > 0))) {
      validationError('لا يمكن أن يكون السطر مديناً ودائناً أو سالباً في نفس الوقت.', 'ترحيل قيد يومية');
      return;
    }
    if (Math.abs(sumD - sumC) > 0.01) {
      validationError(
        `القيد غير متوازن (إجمالي المدين: ${sumD.toFixed(2)}، إجمالي الدائن: ${sumC.toFixed(2)}).`,
        'ترحيل قيد يومية',
      );
      return;
    }
    setSavingJournal(true);
    setStatusMsg('');
    try {
      await api.createJournal({
        description: journalDesc.trim(),
        entryDate: journalDate,
        lines: valid,
      });
      setJournalDesc('');
      setJournalLines([
        { accountId: 0, debit: 0, credit: 0 },
        { accountId: 0, debit: 0, credit: 0 },
      ]);
      setStatusMsg('تم ترحيل القيد المحاسبي بنجاح');
      await loadAll();
    } catch (err) {
      showErrorPopup(err, 'ترحيل قيد اليومية المزدوج');
    } finally {
      setSavingJournal(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 pb-2 text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-800">الحسابات والمالية</span>
          <span className="mx-1">/</span>
          <span>الصندوق والبنك، السندات، دليل الحسابات، القيود المزدوجة، الميزانية والأرباح والخسائر</span>
        </div>
        <button
          type="button"
          onClick={() => setPreviewStatements(true)}
          className="inline-flex items-center gap-1 rounded bg-[#0B4F9C] px-3 py-1 text-xs font-bold text-white hover:bg-[#2b698d]"
        >
          <Printer className="h-3.5 w-3.5" />
          <span>معاينة وطباعة القوائم المالية</span>
        </button>
      </div>

      {statusMsg && (
        <div className="flex items-center gap-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{statusMsg}</span>
        </div>
      )}

      {/* Cash Boxes Strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cashBoxes.map((cb) => (
          <div key={cb.id} className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
            <div className="text-xs text-slate-500">
              {cb.name} ({cb.box_type === 'cash' ? 'نقدي' : 'بنكي'})
            </div>
            <div className="mt-1 text-xl font-bold text-[#145632]">
              {formatMoney(cb.balance, site.currencySymbol)}
            </div>
          </div>
        ))}
        {statements && (
          <>
            <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="text-xs text-slate-500">صافي الربح / الخسارة</div>
              <div
                className={`mt-1 text-xl font-bold ${
                  statements.incomeStatement.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                }`}
              >
                {formatMoney(statements.incomeStatement.netProfit, site.currencySymbol)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="text-xs text-slate-500">توازن ميزان المراجعة</div>
              <div className="mt-1 text-sm font-bold text-[#0B4F9C]">
                مدين: {formatMoney(statements.trialTotals.debit, site.currencySymbol)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Tabs + Date Range */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-300 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: 'vouchers', label: 'السندات (قبض / صرف / مصروفات)', icon: ReceiptText },
            { key: 'accounts', label: 'دليل الحسابات وكشف الحساب', icon: Landmark },
            { key: 'journals', label: 'قيود اليومية المزدوجة', icon: BookOpen },
            { key: 'statements', label: 'ميزان المراجعة والأرباح والميزانية', icon: Scale },
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

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>من:</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
          <span>إلى:</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </div>
      </div>

      {loading ? (
        <div className="rounded border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          جاري تحميل البيانات المالية...
        </div>
      ) : (
        <>
          {/* Tab 1: Vouchers */}
          {tab === 'vouchers' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  إصدار سند مالي جديد
                </h3>
                <form noValidate onSubmit={handleCreateVoucher} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">نوع السند *</label>
                    <select
                      value={voucherType}
                      onChange={(e) => {
                        setVoucherType(e.target.value as Voucher['voucher_type']);
                        setCounterpartyId(0);
                      }}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value="receipt">سند قبض (تحصيل من عميل)</option>
                      <option value="payment">سند صرف (دفع لمورد)</option>
                      <option value="expense">سند مصروف تشغيلي (إيجار/كهرباء/...)</option>
                      <option value="income">سند إيرادات أخرى</option>
                      <option value="capital">إيداع / زيادة رأس مال</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold">الصندوق / البنك *</label>
                    <select
                      value={cashBoxId}
                      onChange={(e) => setCashBoxId(Number(e.target.value))}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      {cashBoxes.map((cb) => (
                        <option key={cb.id} value={cb.id}>
                          {cb.name} (رصيد: {formatMoney(cb.balance, site.currencySymbol)})
                        </option>
                      ))}
                    </select>
                  </div>

                  {voucherType === 'receipt' && (
                    <div>
                      <label className="mb-1 block font-semibold">العميل (لتخفيض ذمته الآجلة)</label>
                      <select
                        value={counterpartyId}
                        onChange={(e) => setCounterpartyId(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      >
                        <option value={0}>تحصيل عام / بدون تحديد عميل</option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} (عليه: {formatMoney(c.balance, site.currencySymbol)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {voucherType === 'payment' && (
                    <div>
                      <label className="mb-1 block font-semibold">المورد (لتخفيض مستحقاته)</label>
                      <select
                        value={counterpartyId}
                        onChange={(e) => setCounterpartyId(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      >
                        <option value={0}>صرف عام / بدون تحديد مورد</option>
                        {suppliers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} (له: {formatMoney(Number(s.balance || 0), site.currencySymbol)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {(voucherType === 'expense' || voucherType === 'income') && (
                    <div>
                      <label className="mb-1 block font-semibold">الحساب المحاسبي المقابل</label>
                      <select
                        value={targetAccountId}
                        onChange={(e) => setTargetAccountId(Number(e.target.value))}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      >
                        <option value={0}>الافتراضي ({voucherType === 'expense' ? 'مصروفات تشغيلية' : 'إيرادات أخرى'})</option>
                        {accounts
                          .filter((a) => a.account_type === (voucherType === 'expense' ? 'expense' : 'revenue'))
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} - {a.name}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block font-semibold">المبلغ *</label>
                      <input
                        type="number"
                        min={0.01}
                        step="0.01"
                        required
                        value={voucherAmount}
                        onChange={(e) => setVoucherAmount(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block font-semibold">التاريخ</label>
                      <input
                        type="date"
                        value={voucherDate}
                        onChange={(e) => setVoucherDate(e.target.value)}
                        className="w-full rounded border border-slate-300 px-2.5 py-2"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block font-semibold">البيان / الوصف *</label>
                    <input
                      type="text"
                      required
                      value={voucherDesc}
                      onChange={(e) => setVoucherDesc(e.target.value)}
                      placeholder="شرح السند..."
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={savingVoucher}
                    className="w-full rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226] disabled:opacity-60"
                  >
                    {savingVoucher ? 'جاري الترحيل...' : 'ترحيل السند والقيد المالي'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  سجل السندات المالية ({vouchers.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">#</th>
                        <th className="border border-slate-300 px-2.5 py-2">النوع</th>
                        <th className="border border-slate-300 px-2.5 py-2">الصندوق/البنك</th>
                        <th className="border border-slate-300 px-2.5 py-2">الطرف / الحساب</th>
                        <th className="border border-slate-300 px-2.5 py-2">المبلغ</th>
                        <th className="border border-slate-300 px-2.5 py-2">البيان</th>
                        <th className="border border-slate-300 px-2.5 py-2">طباعة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vouchers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                            لا توجد سندات مسجلة
                          </td>
                        </tr>
                      ) : (
                        vouchers.map((v) => (
                          <tr key={v.id} className="hover:bg-slate-50">
                            <td className="border border-slate-200 px-2.5 py-2 font-bold">#{v.id}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {VOUCHER_TYPE_LABELS[v.voucher_type] || v.voucher_type}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{v.cash_box_name}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              {v.counterparty_name || v.account_name || '—'}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2 font-bold text-[#145632]">
                              {formatMoney(v.amount, site.currencySymbol)}
                            </td>
                            <td className="border border-slate-200 px-2.5 py-2">{v.description}</td>
                            <td className="border border-slate-200 px-2.5 py-2">
                              <button
                                type="button"
                                onClick={() => setPreviewVoucher(v)}
                                className="rounded border border-slate-300 px-2 py-1 text-[11px] hover:bg-slate-50"
                              >
                                <Printer className="h-3 w-3" />
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
          )}

          {/* Tab 2: Chart of Accounts */}
          {tab === 'accounts' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  إضافة حساب جديد في الدليل
                </h3>
                <form noValidate onSubmit={handleCreateAccount} className="space-y-3 text-xs">
                  <div>
                    <label className="mb-1 block font-semibold">رقم الحساب *</label>
                    <input
                      type="text"
                      required
                      value={accCode}
                      onChange={(e) => setAccCode(e.target.value)}
                      placeholder="مثال: 505"
                      className="w-full rounded border border-slate-300 px-2.5 py-2 font-mono"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">اسم الحساب *</label>
                    <input
                      type="text"
                      required
                      value={accName}
                      onChange={(e) => setAccName(e.target.value)}
                      placeholder="مثال: إيجار وفواتير كهرباء"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">التصنيف الرئيسي</label>
                    <select
                      value={accType}
                      onChange={(e) => setAccType(e.target.value as Account['account_type'])}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    >
                      <option value="asset">أصول</option>
                      <option value="liability">التزامات / خصوم</option>
                      <option value="equity">حقوق ملكية</option>
                      <option value="revenue">إيرادات</option>
                      <option value="expense">مصروفات</option>
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={savingAcc}
                    className="w-full rounded bg-[#145632] py-2 font-bold text-white hover:bg-[#0f4226]"
                  >
                    {savingAcc ? 'جاري الإضافة...' : 'إضافة الحساب'}
                  </button>
                </form>
              </div>

              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm lg:col-span-2">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  شجرة ودليل الحسابات ({accounts.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700">
                        <th className="border border-slate-300 px-2.5 py-2">الكود</th>
                        <th className="border border-slate-300 px-2.5 py-2">اسم الحساب</th>
                        <th className="border border-slate-300 px-2.5 py-2">النوع</th>
                        <th className="border border-slate-300 px-2.5 py-2">الرصيد الحالي</th>
                        <th className="border border-slate-300 px-2.5 py-2">كشف الحساب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((a) => (
                        <tr key={a.id} className="hover:bg-slate-50">
                          <td className="border border-slate-200 px-2.5 py-2 font-mono font-bold">{a.code}</td>
                          <td className="border border-slate-200 px-2.5 py-2 font-semibold">{a.name}</td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            {ACCOUNT_TYPE_LABELS[a.account_type]}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2 font-bold text-[#145632]">
                            {formatMoney(a.balance, site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-2">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await api.getAccountStatement(a.id);
                                  setAccStatement(res);
                                } catch (err) {
                                  showErrorPopup(err, `جلب كشف حركة الحساب: ${a.name}`);
                                }
                              }}
                              className="rounded bg-[#0B4F9C] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#2b688c]"
                            >
                              حركة الحساب
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

          {/* Tab 3: Journal Entries */}
          {tab === 'journals' && (
            <div className="space-y-4">
              <form noValidate onSubmit={handleCreateJournal} className="space-y-3 rounded border border-slate-300 bg-white p-4 shadow-sm text-xs">
                <h3 className="border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  تسجيل قيد يومية يدوي (مزدوج ومتوازن)
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="mb-1 block font-semibold">وصف القيد *</label>
                    <input
                      type="text"
                      required
                      value={journalDesc}
                      onChange={(e) => setJournalDesc(e.target.value)}
                      placeholder="مثال: تسوية جردية أو تحويل بين الصندوق والبنك"
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-semibold">تاريخ القيد</label>
                    <input
                      type="date"
                      value={journalDate}
                      onChange={(e) => setJournalDate(e.target.value)}
                      className="w-full rounded border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  {journalLines.map((l, idx) => (
                    <div key={idx} className="grid grid-cols-3 gap-2">
                      <select
                        value={l.accountId}
                        onChange={(e) =>
                          setJournalLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, accountId: Number(e.target.value) } : row)),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1.5"
                      >
                        <option value={0}>اختر الحساب...</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} - {a.name}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="مدين"
                        value={l.debit || ''}
                        onChange={(e) =>
                          setJournalLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, debit: Number(e.target.value) } : row)),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1.5"
                      />
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        placeholder="دائن"
                        value={l.credit || ''}
                        onChange={(e) =>
                          setJournalLines((prev) =>
                            prev.map((row, i) => (i === idx ? { ...row, credit: Number(e.target.value) } : row)),
                          )
                        }
                        className="rounded border border-slate-300 px-2 py-1.5"
                      />
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setJournalLines((prev) => [...prev, { accountId: 0, debit: 0, credit: 0 }])}
                      className="inline-flex items-center gap-1 font-bold text-[#0B4F9C]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>إضافة سطر</span>
                    </button>
                    <button
                      type="submit"
                      disabled={savingJournal}
                      className="rounded bg-[#145632] px-4 py-2 font-bold text-white hover:bg-[#0f4226]"
                    >
                      {savingJournal ? 'جاري الترحيل...' : 'ترحيل القيد المزدوج'}
                    </button>
                  </div>
                </div>
              </form>

              <div className="space-y-2">
                {journals.map((j) => (
                  <div key={j.id} className="rounded border border-slate-300 bg-white p-3 shadow-sm text-xs">
                    <div className="mb-2 flex flex-wrap items-center justify-between border-b border-slate-100 pb-1.5">
                      <span className="font-bold text-slate-800">
                        قيد #{j.id}: {j.description}
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">{j.entry_date}</span>
                    </div>
                    <table className="w-full border-collapse text-right">
                      <thead>
                        <tr className="bg-slate-50 text-slate-600">
                          <th className="border border-slate-200 px-2 py-1">الحساب</th>
                          <th className="border border-slate-200 px-2 py-1">مدين</th>
                          <th className="border border-slate-200 px-2 py-1">دائن</th>
                          <th className="border border-slate-200 px-2 py-1">بيان</th>
                        </tr>
                      </thead>
                      <tbody>
                        {j.lines.map((ln) => (
                          <tr key={ln.id}>
                            <td className="border border-slate-200 px-2 py-1">
                              {ln.account_code} - {ln.account_name}
                            </td>
                            <td className="border border-slate-200 px-2 py-1 font-semibold text-emerald-700">
                              {ln.debit > 0 ? formatMoney(ln.debit, site.currencySymbol) : '—'}
                            </td>
                            <td className="border border-slate-200 px-2 py-1 font-semibold text-red-700">
                              {ln.credit > 0 ? formatMoney(ln.credit, site.currencySymbol) : '—'}
                            </td>
                            <td className="border border-slate-200 px-2 py-1 text-slate-500">{ln.notes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tab 4: Financial Statements */}
          {tab === 'statements' && statements && (
            <div className="space-y-4">
              {/* Income Statement (P&L) & Balance Sheet */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded border border-slate-300 bg-white p-4 shadow-sm text-xs">
                  <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-[#145632]">
                    قائمة الدخل (الأرباح والخسائر)
                  </h3>
                  <div className="space-y-1.5">
                    {statements.incomeStatement.revenues.map((r) => (
                      <div key={String(r.id)} className="flex justify-between">
                        <span>{String(r.name)}</span>
                        <span className="font-semibold text-emerald-700">
                          {formatMoney(Number(r.net || 0), site.currencySymbol)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold">
                      <span>إجمالي الإيرادات</span>
                      <span className="text-emerald-700">
                        {formatMoney(statements.incomeStatement.totalRevenue, site.currencySymbol)}
                      </span>
                    </div>

                    <div className="pt-2" />
                    {statements.incomeStatement.expenses.map((ex) => (
                      <div key={String(ex.id)} className="flex justify-between">
                        <span>{String(ex.name)}</span>
                        <span className="font-semibold text-red-700">
                          {formatMoney(Number(ex.net || 0), site.currencySymbol)}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-1.5 font-bold">
                      <span>إجمالي المصروفات والتكاليف</span>
                      <span className="text-red-700">
                        {formatMoney(statements.incomeStatement.totalExpense, site.currencySymbol)}
                      </span>
                    </div>

                    <div className="mt-2 flex justify-between rounded bg-slate-100 p-2 text-sm font-bold">
                      <span>صافي الربح / الخسارة</span>
                      <span
                        className={
                          statements.incomeStatement.netProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                        }
                      >
                        {formatMoney(statements.incomeStatement.netProfit, site.currencySymbol)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded border border-slate-300 bg-white p-4 shadow-sm text-xs">
                  <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-[#0B4F9C]">
                    الميزانية العمومية (المركز المالي)
                  </h3>
                  <div className="space-y-1.5">
                    <div className="font-bold text-slate-700">الأصول:</div>
                    {statements.balanceSheet.assets.map((a) => (
                      <div key={String(a.id)} className="flex justify-between">
                        <span>{String(a.name)}</span>
                        <span>{formatMoney(Number(a.current_balance || 0), site.currencySymbol)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-[#145632]">
                      <span>إجمالي الأصول</span>
                      <span>{formatMoney(statements.balanceSheet.totalAssets, site.currencySymbol)}</span>
                    </div>

                    <div className="pt-2 font-bold text-slate-700">الالتزامات وحقوق الملكية:</div>
                    {statements.balanceSheet.liabilities.map((l) => (
                      <div key={String(l.id)} className="flex justify-between">
                        <span>{String(l.name)}</span>
                        <span>{formatMoney(Number(l.current_balance || 0), site.currencySymbol)}</span>
                      </div>
                    ))}
                    {statements.balanceSheet.equity.map((eq) => (
                      <div key={String(eq.id)} className="flex justify-between">
                        <span>{String(eq.name)}</span>
                        <span>{formatMoney(Number(eq.current_balance || 0), site.currencySymbol)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between">
                      <span>أرباح / خسائر الفترة</span>
                      <span>{formatMoney(statements.balanceSheet.retainedEarnings, site.currencySymbol)}</span>
                    </div>
                    <div className="flex justify-between border-t border-slate-200 pt-1 font-bold text-[#0B4F9C]">
                      <span>إجمالي الالتزامات وحقوق الملكية</span>
                      <span>
                        {formatMoney(
                          statements.balanceSheet.totalLiabilities + statements.balanceSheet.totalEquity,
                          site.currencySymbol,
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Trial Balance Table */}
              <div className="rounded border border-slate-300 bg-white p-4 shadow-sm text-xs">
                <h3 className="mb-3 border-b border-slate-200 pb-2 text-sm font-bold text-slate-800">
                  ميزان المراجعة التفصيلي
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-right">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-2.5 py-2">الكود</th>
                        <th className="border border-slate-300 px-2.5 py-2">الحساب</th>
                        <th className="border border-slate-300 px-2.5 py-2">حركة مدين</th>
                        <th className="border border-slate-300 px-2.5 py-2">حركة دائن</th>
                        <th className="border border-slate-300 px-2.5 py-2">الرصيد الحالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statements.trialBalance.map((row) => (
                        <tr key={String(row.id)}>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-mono">{String(row.code)}</td>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-semibold">{String(row.name)}</td>
                          <td className="border border-slate-200 px-2.5 py-1.5">
                            {formatMoney(Number(row.total_debit || 0), site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-1.5">
                            {formatMoney(Number(row.total_credit || 0), site.currencySymbol)}
                          </td>
                          <td className="border border-slate-200 px-2.5 py-1.5 font-bold">
                            {formatMoney(Number(row.current_balance || 0), site.currencySymbol)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 font-bold">
                        <td colSpan={2} className="border border-slate-300 px-2.5 py-2">
                          الإجمالي الكلي للميزان
                        </td>
                        <td className="border border-slate-300 px-2.5 py-2 text-emerald-700">
                          {formatMoney(statements.trialTotals.debit, site.currencySymbol)}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-2 text-emerald-700">
                          {formatMoney(statements.trialTotals.credit, site.currencySymbol)}
                        </td>
                        <td className="border border-slate-300 px-2.5 py-2">
                          {Math.abs(statements.trialTotals.debit - statements.trialTotals.credit) < 0.01
                            ? 'متوازن ✓'
                            : 'غير متوازن'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Account Statement Modal */}
      {accStatement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded bg-white p-5 shadow-xl text-xs">
            <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-base font-bold text-slate-800">
                كشف حساب تفصيلي: {accStatement.account.code} - {accStatement.account.name}
              </h3>
              <button type="button" onClick={() => setAccStatement(null)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">التاريخ</th>
                  <th className="border border-slate-300 px-2 py-1.5">البيان</th>
                  <th className="border border-slate-300 px-2 py-1.5">مدين</th>
                  <th className="border border-slate-300 px-2 py-1.5">دائن</th>
                </tr>
              </thead>
              <tbody>
                {accStatement.movements.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                      لا توجد قيود على هذا الحساب بعد
                    </td>
                  </tr>
                ) : (
                  accStatement.movements.map((m) => (
                    <tr key={String(m.id)}>
                      <td className="border border-slate-200 px-2 py-1.5 font-mono">{String(m.entry_date)}</td>
                      <td className="border border-slate-200 px-2 py-1.5">{String(m.description)}</td>
                      <td className="border border-slate-200 px-2 py-1.5 text-emerald-700">
                        {Number(m.debit) > 0 ? formatMoney(Number(m.debit), site.currencySymbol) : '—'}
                      </td>
                      <td className="border border-slate-200 px-2 py-1.5 text-red-700">
                        {Number(m.credit) > 0 ? formatMoney(Number(m.credit), site.currencySymbol) : '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Print Preview: Financial Statements */}
      <PrintPreviewModal
        open={previewStatements}
        title="التقرير المالي الشامل (ميزان المراجعة والدخل والميزانية)"
        site={site}
        defaultPaperMode="a4"
        onClose={() => setPreviewStatements(false)}
      >
        {statements && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-3 rounded border border-slate-300 bg-slate-50 p-3 font-bold">
              <div>إجمالي الإيرادات: {formatMoney(statements.incomeStatement.totalRevenue, site.currencySymbol)}</div>
              <div>إجمالي المصروفات: {formatMoney(statements.incomeStatement.totalExpense, site.currencySymbol)}</div>
              <div className="text-[#145632]">
                صافي الربح: {formatMoney(statements.incomeStatement.netProfit, site.currencySymbol)}
              </div>
            </div>
            <table className="w-full border-collapse text-right">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-2 py-1.5">الكود</th>
                  <th className="border border-slate-300 px-2 py-1.5">الحساب</th>
                  <th className="border border-slate-300 px-2 py-1.5">مدين</th>
                  <th className="border border-slate-300 px-2 py-1.5">دائن</th>
                  <th className="border border-slate-300 px-2 py-1.5">الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {statements.trialBalance.map((row) => (
                  <tr key={String(row.id)}>
                    <td className="border border-slate-300 px-2 py-1.5 font-mono">{String(row.code)}</td>
                    <td className="border border-slate-300 px-2 py-1.5">{String(row.name)}</td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      {formatMoney(Number(row.total_debit || 0), site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5">
                      {formatMoney(Number(row.total_credit || 0), site.currencySymbol)}
                    </td>
                    <td className="border border-slate-300 px-2 py-1.5 font-bold">
                      {formatMoney(Number(row.current_balance || 0), site.currencySymbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PrintPreviewModal>

      {/* Print Preview: Single Voucher */}
      <PrintPreviewModal
        open={Boolean(previewVoucher)}
        title={`سند مالي #${previewVoucher?.id || ''}`}
        site={site}
        allowReceiptMode
        defaultPaperMode="a4"
        onClose={() => setPreviewVoucher(null)}
      >
        {previewVoucher && (
          <div className="space-y-3 rounded border border-slate-300 p-4 text-xs">
            <div className="flex justify-between font-bold">
              <span>نوع السند: {VOUCHER_TYPE_LABELS[previewVoucher.voucher_type]}</span>
              <span>التاريخ: {previewVoucher.voucher_date}</span>
            </div>
            <div>الصندوق / الحساب: {previewVoucher.cash_box_name}</div>
            <div>الطرف المستفيد / العميل / المورد: {previewVoucher.counterparty_name || previewVoucher.account_name || '—'}</div>
            <div className="rounded bg-slate-100 p-3 text-base font-bold text-[#145632]">
              المبلغ: {formatMoney(previewVoucher.amount, site.currencySymbol)}
            </div>
            <div>البيان: {previewVoucher.description}</div>
          </div>
        )}
      </PrintPreviewModal>
    </div>
  );
};
