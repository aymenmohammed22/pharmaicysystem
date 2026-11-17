import React, { useState } from 'react';
import { Tags, Plus, Edit3, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type { Category, User } from '../types';
import { hasPermission, resolvePhotoSrc } from '../types';
import { ImagePickerField } from '../components/ImagePickerField';
import { ConfirmModal } from '../components/ConfirmModal';

interface ManageCategoriesPageProps {
  user: User;
  categories: Category[];
  onRefreshCategories: () => Promise<void>;
}

export const ManageCategoriesPage: React.FC<ManageCategoriesPageProps> = ({
  user,
  categories,
  onRefreshCategories,
}) => {
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDetails, setFormDetails] = useState('');
  const [formPic, setFormPic] = useState('cap.png');
  const [confirmDeleteCat, setConfirmDeleteCat] = useState<Category | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const canEdit = hasPermission(user, 'manageCategories');
  const canDelete = hasPermission(user, 'deleteCategories');

  const openCreate = () => {
    setEditing(null);
    setFormName('');
    setFormDetails('');
    setFormPic('cap.png');
    setCreating(true);
  };

  const openEdit = (cat: Category) => {
    setCreating(false);
    setFormName(cat.name);
    setFormDetails(cat.details);
    setFormPic(cat.pic || 'cap.png');
    setEditing(cat);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      validationError(
        'يرجى إدخال اسم التصنيف الدوائي قبل الحفظ.',
        editing ? 'تعديل تصنيف دوائي' : 'إضافة تصنيف دوائي جديد',
        ['حقل اسم التصنيف الإلزامي فارغ.'],
      );
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateCategory(editing.id, {
          name: formName.trim(),
          details: formDetails,
          pic: formPic,
        });
        setStatusMsg('تم تعديل التصنيف بنجاح');
        setEditing(null);
      } else {
        await api.createCategory({
          name: formName.trim(),
          details: formDetails,
          pic: formPic,
        });
        setStatusMsg('تم إضافة التصنيف الجديد بنجاح');
        setCreating(false);
      }
      await onRefreshCategories();
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, editing ? 'تعديل تصنيف دوائي' : 'إضافة تصنيف دوائي جديد');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteCat) return;
    setDeleting(true);
    try {
      await api.deleteCategory(confirmDeleteCat.id);
      await onRefreshCategories();
      setStatusMsg(`تم حذف التصنيف "${confirmDeleteCat.name}"`);
      setConfirmDeleteCat(null);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err) {
      showErrorPopup(err, `حذف التصنيف: ${confirmDeleteCat.name}`);
      setConfirmDeleteCat(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <Tags className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">إدارة التصنيفات الدوائية</h1>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded bg-[#0B4F9C] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#083D7A]"
            >
              <Plus className="h-4 w-4" />
              <span>تصنيف جديد</span>
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
                  <th className="border-b border-slate-200 px-3 py-2.5">اسم التصنيف</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">التفاصيل</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">عدد الأدوية</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">تاريخ الإنشاء</th>
                  <th className="border-b border-slate-200 px-3 py-2.5">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-sky-50/40">
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{cat.id}</td>
                    <td className="px-3 py-2.5">
                      <img
                        src={resolvePhotoSrc(cat.pic, 'cap.png')}
                        alt={cat.name}
                        className="h-10 w-10 rounded border border-slate-200 object-cover"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-bold text-slate-800">{cat.name}</td>
                    <td className="px-3 py-2.5 text-slate-600">{cat.details || '-'}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                        {cat.medicineCount}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-500" dir="ltr">
                      {cat.date}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => openEdit(cat)}
                            className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            <span>تعديل</span>
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteCat(cat)}
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

      {(creating || editing) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded border border-slate-300 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-[#EDF4FC] px-4 py-3">
              <h3 className="text-base font-bold text-slate-800">
                {editing ? 'تعديل التصنيف' : 'إضافة تصنيف جديد'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditing(null);
                }}
                className="rounded p-1 text-slate-500 hover:bg-white/70"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSave} noValidate className="space-y-4 p-4">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">اسم التصنيف</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">التفاصيل</label>
                <textarea
                  rows={2}
                  value={formDetails}
                  onChange={(e) => setFormDetails(e.target.value)}
                  className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <ImagePickerField label="صورة التصنيف" value={formPic} onChange={setFormPic} />
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setEditing(null);
                  }}
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
        open={Boolean(confirmDeleteCat)}
        title="تأكيد حذف التصنيف"
        message={`هل أنت متأكد من حذف التصنيف "${confirmDeleteCat?.name ?? ''}"؟`}
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteCat(null)}
      />
    </div>
  );
};
