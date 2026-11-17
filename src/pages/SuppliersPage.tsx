import React, { useState } from 'react';
import { Truck, Plus, Edit3, Trash2, X, FileSpreadsheet } from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type { SiteSettings, Supplier, User } from '../types';
import { formatMoney, hasPermission, resolvePhotoSrc } from '../types';
import { ImagePickerField } from '../components/ImagePickerField';
import { ConfirmModal } from '../components/ConfirmModal';
import { PrintPreviewModal } from '../components/PrintPreviewModal';

interface SuppliersPageProps {
  user: User;
  site: SiteSettings;
  suppliers: Supplier[];
  onRefreshSuppliers: () => Promise<void>;
}

export const SuppliersPage: React.FC<SuppliersPageProps> = ({
  user,
  site,
  suppliers,
  onRefreshSuppliers,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [confirmDeleteSup, setConfirmDeleteSup] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [address, setAddress] = useState('');
  const [cnic, setCnic] = useState('');
  const [pic, setPic] = useState('fk.jpg');
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  // Supplier Statement Modal & Print Preview
  const [statement, setStatement] = useState<{
    supplier: Supplier;
    orders: Array<Record<string, unknown>>;
    returns: Array<Record<string, unknown>>;
    payments: Array<Record<string, unknown>>;
  } | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const canEdit = hasPermission(user, 'manageSuppliers');
  const canDelete = hasPermission(user, 'deleteSuppliers');

  const openNew = () => {
    setEditing(null);
    setName('');
    setNumber('');
    setAddress('');
    setCnic('');
    setPic('fk.jpg');
    setModalOpen(true);
  };

  const openEdit = (sup: Supplier) => {
    setEditing(sup);
    setName(sup.name);
    setNumber(sup.number);
    setAddress(sup.address);
    setCnic(sup.cnic);
    setPic(sup.pic || 'fk.jpg');
    setModalOpen(true);
  };

  const openStatement = async (sup: Supplier) => {
    try {
      const res = await api.getSupplierStatement(sup.id);
      setStatement(res);
    } catch (err) {
      showErrorPopup(err, `كشف حساب المورد: ${sup.name}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      validationError(
        'يرجى إدخال اسم المورد أو الشركة الموردة قبل الحفظ.',
        editing ? 'تعديل بيانات مورد' : 'إضافة مورد جديد',
        ['حقل اسم المورد الإلزامي فارغ.'],
      );
      return;
    }
    if (!number.trim()) {
      validationError(
        'يرجى إدخال رقم هاتف المورد للتواصل وطلبات الشراء.',
        editing ? 'تعديل بيانات مورد' : 'إضافة مورد جديد',
        ['حقل رقم الهاتف الإلزامي فارغ.'],
      );
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateSupplier(editing.id, {
          name: name.trim(),
          number: number.trim(),
          address: address.trim(),
          cnic: cnic.trim(),
          pic,
        });
        setStatusMsg('تم تعديل بيانات المورد بنجاح');
      } else {
        await api.createSupplier({
          name: name.trim(),
          number: number.trim(),
          address: address.trim(),
          cnic: cnic.trim(),
          pic,
        });
        setStatusMsg('تمت إضافة المورد بنجاح');
      }
      await onRefreshSuppliers();
      setModalOpen(false);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, editing ? 'تعديل بيانات مورد' : 'إضافة مورد جديد');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteSup) return;
    setDeleting(true);
    try {
      await api.deleteSupplier(confirmDeleteSup.id);
      await onRefreshSuppliers();
      setStatusMsg(`تم حذف المورد "${confirmDeleteSup.name}"`);
      setConfirmDeleteSup(null);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, `حذف المورد: ${confirmDeleteSup.name}`);
      setConfirmDeleteSup(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">دليل الموردين وحساباتهم (Suppliers)</h1>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-1.5 rounded bg-[#0B4F9C] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#083D7A]"
            >
              <Plus className="h-4 w-4" />
              <span>إضافة مورد جديد</span>
            </button>
          )}
        </div>

        <div className="space-y-3 p-4">
          {statusMsg && (
            <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {statusMsg}
            </div>
          )}

          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="w-full border-collapse text-right text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="border-b border-slate-200 px-3 py-2.5">#</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الصورة</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">اسم المورد</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">رقم الهاتف</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">العنوان</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">المستحق للمورد</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {suppliers.map((sup) => (
                  <tr key={sup.id} className="hover:bg-sky-50/40">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{sup.id}</td>
                    <td className="px-3 py-2.5">
                      <img
                        src={resolvePhotoSrc(sup.pic, 'fk.jpg')}
                        alt={sup.name}
                        className="h-10 w-10 rounded border border-slate-200 object-cover"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-bold text-slate-800">{sup.name}</div>
                      {sup.cnic && <div className="font-mono text-[11px] text-slate-400">{sup.cnic}</div>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs" dir="ltr">
                      {sup.number}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{sup.address || '-'}</td>
                    <td className="px-3 py-2.5 font-bold text-red-700">
                      {formatMoney(sup.balance || 0, site.currencySymbol)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openStatement(sup)}
                          className="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 hover:bg-sky-100"
                        >
                          <FileSpreadsheet className="h-3.5 w-3.5" />
                          <span>كشف حساب</span>
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEdit(sup)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>تعديل</span>
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteSup(sup)}
                            className="inline-flex items-center gap-1 rounded bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>حذف</span>
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

      {/* Supplier Statement Modal */}
      {statement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">
                كشف حساب المورد: {statement.supplier.name}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrintOpen(true)}
                  className="rounded bg-[#0B4F9C] px-3 py-1 text-xs font-bold text-white"
                >
                  معاينة وطباعة الكشف
                </button>
                <button
                  type="button"
                  onClick={() => setStatement(null)}
                  className="rounded p-1 text-slate-500 hover:bg-white/70"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="space-y-4 p-4 text-sm">
              <div className="flex items-center justify-between rounded border border-slate-200 bg-[#F3F6FA] p-3">
                <div>الهاتف: {statement.supplier.number}</div>
                <div className="font-bold text-red-700">
                  الرصيد المستحق للمورد: {formatMoney(statement.supplier.balance || 0, site.currencySymbol)}
                </div>
              </div>
              <div>
                <h4 className="mb-2 font-bold text-slate-800">فواتير التوريد المستلمة ({statement.orders.length})</h4>
                <table className="w-full border-collapse border border-slate-200 text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="border px-2 py-1.5">رقم الفاتورة</th>
                      <th className="border px-2 py-1.5">الإجمالي</th>
                      <th className="border px-2 py-1.5">المدفوع</th>
                      <th className="border px-2 py-1.5">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.orders.map((o) => (
                      <tr key={String(o.id)}>
                        <td className="border px-2 py-1.5 font-mono">{String(o.invoice_number || `#${o.id}`)}</td>
                        <td className="border px-2 py-1.5 font-bold">{formatMoney(Number(o.total_amount), site.currencySymbol)}</td>
                        <td className="border px-2 py-1.5">{formatMoney(Number(o.paid_amount), site.currencySymbol)}</td>
                        <td className="border px-2 py-1.5 font-mono">{String(o.received_at || o.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <h4 className="mb-2 font-bold text-slate-800">سندات الصرف المسددة للمورد ({statement.payments.length})</h4>
                <table className="w-full border-collapse border border-slate-200 text-xs">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="border px-2 py-1.5">رقم السند</th>
                      <th className="border px-2 py-1.5">المبلغ</th>
                      <th className="border px-2 py-1.5">البيان</th>
                      <th className="border px-2 py-1.5">التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.payments.map((p) => (
                      <tr key={String(p.id)}>
                        <td className="border px-2 py-1.5 font-mono">#{String(p.id)}</td>
                        <td className="border px-2 py-1.5 font-bold text-emerald-700">{formatMoney(Number(p.amount), site.currencySymbol)}</td>
                        <td className="border px-2 py-1.5">{String(p.description)}</td>
                        <td className="border px-2 py-1.5 font-mono">{String(p.voucher_date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {printOpen && statement && (
        <PrintPreviewModal
          open={printOpen}
          title={`كشف حساب المورد: ${statement.supplier.name}`}
          site={site}
          defaultPaperMode="a4"
          onClose={() => setPrintOpen(false)}
        >
          <div className="space-y-4 text-right text-sm">
            <div className="border-b pb-3 text-center">
              <div className="text-xl font-bold">{site.name}</div>
              <div className="text-slate-600">كشف حساب المورد: {statement.supplier.name}</div>
            </div>
            <div className="font-bold">
              الرصيد المستحق الحالي: {formatMoney(statement.supplier.balance || 0, site.currencySymbol)}
            </div>
            <table className="w-full border-collapse border border-slate-300 text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border px-2 py-1.5">البيان</th>
                  <th className="border px-2 py-1.5">المبلغ</th>
                  <th className="border px-2 py-1.5">التاريخ</th>
                </tr>
              </thead>
              <tbody>
                {statement.orders.map((o) => (
                  <tr key={`o-${String(o.id)}`}>
                    <td className="border px-2 py-1.5">فاتورة توريد {String(o.invoice_number || o.id)}</td>
                    <td className="border px-2 py-1.5">{formatMoney(Number(o.total_amount), site.currencySymbol)}</td>
                    <td className="border px-2 py-1.5">{String(o.received_at || o.created_at)}</td>
                  </tr>
                ))}
                {statement.payments.map((p) => (
                  <tr key={`p-${String(p.id)}`}>
                    <td className="border px-2 py-1.5">سند صرف #{String(p.id)} - {String(p.description)}</td>
                    <td className="border px-2 py-1.5">-{formatMoney(Number(p.amount), site.currencySymbol)}</td>
                    <td className="border px-2 py-1.5">{String(p.voucher_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PrintPreviewModal>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">
                {editing ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
              </h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} noValidate className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">اسم المورد</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">رقم الهاتف</label>
                  <input
                    type="text"
                    required
                    dir="ltr"
                    value={number}
                    onChange={(e) => setNumber(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">رقم السجل / الهوية</label>
                  <input
                    type="text"
                    dir="ltr"
                    value={cnic}
                    onChange={(e) => setCnic(e.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">العنوان</label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <ImagePickerField label="صورة المورد" value={pic} onChange={setPic} fallback="fk.jpg" />
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded bg-[#0B4F9C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#083D7A]"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(confirmDeleteSup)}
        title="تأكيد حذف المورد"
        message={`هل أنت متأكد من حذف المورد "${confirmDeleteSup?.name ?? ''}"؟`}
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteSup(null)}
      />
    </div>
  );
};
