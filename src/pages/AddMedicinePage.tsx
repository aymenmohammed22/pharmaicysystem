import React, { useEffect, useState } from 'react';
import { PlusCircle, CheckCircle2, Layers } from 'lucide-react';
import { api } from '../api';
import { showErrorPopup, validationError } from '../lib/errorPopup';
import type { Category, SiteSettings, Supplier } from '../types';
import { DOSAGE_FORMS } from '../types';
import { ImagePickerField } from '../components/ImagePickerField';

interface AddMedicinePageProps {
  site: SiteSettings;
  categories: Category[];
  suppliers: Supplier[];
  onSaved: () => Promise<void>;
  onGoInventories: () => void;
}

export const AddMedicinePage: React.FC<AddMedicinePageProps> = ({
  site,
  categories,
  suppliers,
  onSaved,
  onGoInventories,
}) => {
  const [name, setName] = useState('');
  const [scientificName, setScientificName] = useState('');
  const [activeIngredient, setActiveIngredient] = useState('');
  const [dosageForm, setDosageForm] = useState('أقراص');
  const [countryOfOrigin, setCountryOfOrigin] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [catId, setCatId] = useState<number>(categories[0]?.id ?? 0);
  const [supplier, setSupplier] = useState(suppliers[0]?.name ?? '');
  const [unit, setUnit] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [price, setPrice] = useState('');

  // Multi-unit configuration
  const [packUnit, setPackUnit] = useState('علبة');
  const [stripUnit, setStripUnit] = useState('شريط');
  const [stripsPerPack, setStripsPerPack] = useState('2');
  const [stripPrice, setStripPrice] = useState('');
  const [pieceUnit, setPieceUnit] = useState('حبة');
  const [piecesPerPack, setPiecesPerPack] = useState('20');
  const [piecePrice, setPiecePrice] = useState('');

  const [quantity, setQuantity] = useState('50');
  const [minStock, setMinStock] = useState('10');
  const [maxStock, setMaxStock] = useState('500');
  const [storageLocation, setStorageLocation] = useState('الرف A-1');
  const [requiresPrescription, setRequiresPrescription] = useState(false);
  const [isControlled, setIsControlled] = useState(false);
  const [controlledSchedule, setControlledSchedule] = useState('');
  const [maxDailyDose, setMaxDailyDose] = useState('');
  const [pregnancyCategory, setPregnancyCategory] = useState('');
  const [barcode, setBarcode] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [productionDate, setProductionDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [company, setCompany] = useState('');
  const [description, setDescription] = useState('');
  const [pic, setPic] = useState('tablet.png');
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (categories.length > 0 && !categories.some((c) => c.id === catId)) {
      setCatId(categories[0].id);
    }
  }, [categories, catId]);

  useEffect(() => {
    if (!supplier && suppliers.length > 0) {
      setSupplier(suppliers[0].name);
    }
  }, [suppliers, supplier]);

  const sellNum = Number(price) || 0;
  const buyNum = Number(purchasePrice) || 0;
  const marginPct = sellNum > 0 && buyNum > 0 ? (((sellNum - buyNum) / sellNum) * 100).toFixed(1) : '0.0';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuccess('');

    if (!name.trim()) {
      validationError(
        'يرجى إدخال الاسم التجاري للدواء قبل الحفظ.',
        'إضافة دواء جديد',
        ['حقل الاسم التجاري للدواء فارغ.'],
      );
      return;
    }
    if (!catId || !categories.some((c) => c.id === catId)) {
      validationError(
        'يرجى اختيار تصنيف دوائي صالح للدواء.',
        'إضافة دواء جديد',
        ['لم يتم اختيار تصنيف دوائي، أو لا توجد تصنيفات منشأة بعد في الصيدلية.'],
        'اختر تصنيفاً من القائمة أو أضف تصنيفاً جديداً أولاً.',
      );
      return;
    }
    if (!price || !Number.isFinite(Number(price)) || Number(price) <= 0) {
      validationError(
        'يرجى إدخال سعر بيع صحيح أكبر من الصفر.',
        'إضافة دواء جديد',
        ['حقل سعر البيع فارغ أو يحتوي على قيمة أقل من أو تساوي الصفر.'],
      );
      return;
    }
    if (quantity === '' || !Number.isFinite(Number(quantity)) || Number(quantity) < 0) {
      validationError(
        'الكمية الافتتاحية يجب أن تكون رقماً صفرياً أو موجباً.',
        'إضافة دواء جديد',
        ['تم إدخال قيمة غير رقمية أو سالبة في حقل الكمية.'],
      );
      return;
    }
    if (!expiryDate) {
      validationError(
        'يرجى تحديد تاريخ انتهاء الصلاحية للتشغيلة الافتتاحية.',
        'إضافة دواء جديد',
        ['حقل تاريخ انتهاء الصلاحية إلزامي لإدارة التشغيلات (FEFO) ومنع صرف الأدوية المنتهية.'],
      );
      return;
    }
    if (productionDate && expiryDate < productionDate) {
      validationError(
        'تاريخ انتهاء الصلاحية لا يمكن أن يكون أقدم من تاريخ الإنتاج.',
        'إضافة دواء جديد',
        [`تاريخ الإنتاج المدخل (${productionDate}) أحدث من تاريخ الانتهاء (${expiryDate}).`],
        'صحح تاريخ الإنتاج أو تاريخ الانتهاء ثم أعد الحفظ.',
      );
      return;
    }

    setSaving(true);
    try {
      await api.createInventory({
        name: name.trim(),
        scientificName,
        activeIngredient,
        dosageForm,
        countryOfOrigin,
        regNumber,
        catId,
        supplier,
        unit,
        purchasePrice: Math.max(0, Number(purchasePrice) || 0),
        price,
        packUnit,
        stripUnit,
        stripsPerPack: Math.max(1, Number(stripsPerPack) || 1),
        stripPrice: Number(stripPrice) || 0,
        pieceUnit,
        piecesPerPack: Math.max(1, Number(piecesPerPack) || 1),
        piecePrice: Number(piecePrice) || 0,
        quantity: Math.max(0, Number(quantity) || 0),
        minStock: Math.max(0, Number(minStock) || 0),
        maxStock: Math.max(1, Number(maxStock) || 500),
        storageLocation,
        requiresPrescription,
        isControlled,
        controlledSchedule,
        maxDailyDose,
        pregnancyCategory,
        barcode: barcode.trim(),
        batchNumber,
        productionDate,
        expiryDate,
        company,
        description,
        pic,
      });
      await onSaved();
      setSuccess(`تمت إضافة الدواء "${name}" وإنشاء تشغيلته الافتتاحية بنجاح`);
      setName('');
      setScientificName('');
      setActiveIngredient('');
      setUnit('');
      setPurchasePrice('');
      setPrice('');
      setStripPrice('');
      setPiecePrice('');
      setQuantity('50');
      setBarcode('');
      setBatchNumber('');
      setProductionDate('');
      setExpiryDate('');
      setCompany('');
      setDescription('');
      setIsControlled(false);
      setControlledSchedule('');
      setMaxDailyDose('');
      setPregnancyCategory('');
    } catch (err) {
      showErrorPopup(err, 'إضافة دواء جديد');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded border border-[#DCE4F0] bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-[#DCE4F0] bg-[#EDF4FC] px-4 py-3">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-[#0B4F9C]" />
            <h1 className="text-lg font-bold text-slate-800">تعريف دواء / مستلزم طبي جديد (ملف دوائي متكامل)</h1>
          </div>
          <button
            type="button"
            onClick={onGoInventories}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            عرض المخزون والتشغيلات
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-5 p-5">
          {success && (
            <div className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" />
                {success}
              </span>
              <button type="button" onClick={onGoInventories} className="font-bold underline">
                الانتقال للمخزون
              </button>
            </div>
          )}

          {/* Section 1: Identity & Pharma Specs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                الاسم التجاري للدواء <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="مثال: أموكسيسيلين / أوجمنتين"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الاسم العلمي (Scientific Name)</label>
              <input
                type="text"
                value={scientificName}
                onChange={(e) => setScientificName(e.target.value)}
                placeholder="Amoxicillin + Clavulanic Acid"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">المادة الفعالة</label>
              <input
                type="text"
                value={activeIngredient}
                onChange={(e) => setActiveIngredient(e.target.value)}
                placeholder="مثال: Paracetamol"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                التصنيف الدوائي <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={catId}
                onChange={(e) => setCatId(Number(e.target.value))}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الشكل الصيدلاني</label>
              <select
                value={dosageForm}
                onChange={(e) => setDosageForm(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {DOSAGE_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">التركيز / القوة</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="مثال: 500mg / 100ml"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الشركة المصنعة</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="GSK / Julphar / Spimaco"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">بلد المنشأ</label>
              <input
                type="text"
                value={countryOfOrigin}
                onChange={(e) => setCountryOfOrigin(e.target.value)}
                placeholder="المملكة العربية السعودية / ألمانيا"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">رقم التسجيل الدوائي</label>
              <input
                type="text"
                dir="ltr"
                value={regNumber}
                onChange={(e) => setRegNumber(e.target.value)}
                placeholder="REG-2026-102"
                className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
              />
            </div>
          </div>

          {/* Section 2: Pricing & Multi-Unit Conversion */}
          <div className="rounded border border-slate-200 bg-[#F3F6FA] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold text-[#0B4F9C]">
                <Layers className="h-4 w-4" />
                <span>التسعير وتعدد وحدات البيع (علبة / شريط / حبة)</span>
              </div>
              <span className="rounded bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                هامش الربح التقديري: {marginPct}%
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  سعر الشراء للعلبة ({site.currencySymbol})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="مثال: 10.50"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">
                  سعر بيع العلبة ({site.currencySymbol}) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="مثال: 15.00"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">وحدة الشراء/البيع الكبرى</label>
                <input
                  type="text"
                  value={packUnit}
                  onChange={(e) => setPackUnit(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">الباركود (اختياري)</label>
                <input
                  type="text"
                  dir="ltr"
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="يُولد تلقائياً"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-left text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">اسم الوحدة الوسطى</label>
                <input
                  type="text"
                  value={stripUnit}
                  onChange={(e) => setStripUnit(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">عدد الأشرطة بالعلبة</label>
                <input
                  type="number"
                  min="1"
                  value={stripsPerPack}
                  onChange={(e) => setStripsPerPack(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">سعر الشريط (تلقائي إذا 0)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={stripPrice}
                  onChange={(e) => setStripPrice(e.target.value)}
                  placeholder="تلقائي"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">عدد الحبات/الجرعات بالعلبة</label>
                <input
                  type="number"
                  min="1"
                  value={piecesPerPack}
                  onChange={(e) => setPiecesPerPack(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">اسم أصغر وحدة</label>
                <input
                  type="text"
                  value={pieceUnit}
                  onChange={(e) => setPieceUnit(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">سعر الحبة (تلقائي إذا 0)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={piecePrice}
                  onChange={(e) => setPiecePrice(e.target.value)}
                  placeholder="تلقائي"
                  className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Opening Batch, Stock Limits & Storage */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                الكمية الافتتاحية (بالعلبة) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الحد الأدنى للتنبيه</label>
              <input
                type="number"
                min="0"
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الحد الأعلى للتخزين</label>
              <input
                type="number"
                min="1"
                value={maxStock}
                onChange={(e) => setMaxStock(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">رقم التشغيلة الافتتاحية</label>
              <input
                type="text"
                dir="ltr"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="B-2026-01"
                className="w-full rounded border border-slate-300 px-3 py-2 text-left text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">تاريخ الإنتاج</label>
              <input
                type="date"
                value={productionDate}
                onChange={(e) => setProductionDate(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">
                تاريخ انتهاء الصلاحية <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">المورد الافتراضي</label>
              <input
                type="text"
                list="add-suppliers-list"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
              <datalist id="add-suppliers-list">
                {suppliers.map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">موقع التخزين / الرف</label>
              <input
                type="text"
                value={storageLocation}
                onChange={(e) => setStorageLocation(e.target.value)}
                placeholder="الرف B-3 / الثلاجة"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex flex-wrap items-end gap-3 pb-1 sm:col-span-3">
              <label className="flex cursor-pointer items-center gap-2 rounded border border-slate-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
                <input
                  type="checkbox"
                  checked={requiresPrescription}
                  onChange={(e) => setRequiresPrescription(e.target.checked)}
                  className="h-4 w-4 rounded text-[#0B4F9C]"
                />
                <span>يتطلب وصفة طبية عند الصرف</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-900">
                <input
                  type="checkbox"
                  checked={isControlled}
                  onChange={(e) => {
                    setIsControlled(e.target.checked);
                    if (e.target.checked) setRequiresPrescription(true);
                  }}
                  className="h-4 w-4 rounded text-red-700"
                />
                <span>دواء مقيد / خاضع للرقابة (يفرض هوية ووصفة في POS)</span>
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الجدول الرقابي (للمقيدة)</label>
              <input
                type="text"
                value={controlledSchedule}
                onChange={(e) => setControlledSchedule(e.target.value)}
                placeholder="مثال: جدول 3 - نفسية / مخدر"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">الجرعة اليومية القصوى</label>
              <input
                type="text"
                value={maxDailyDose}
                onChange={(e) => setMaxDailyDose(e.target.value)}
                placeholder="مثال: 4000mg / يوم"
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-bold text-slate-700">تصنيف الحمل (FDA)</label>
              <select
                value={pregnancyCategory}
                onChange={(e) => setPregnancyCategory(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">غير محدد</option>
                <option value="A">فئة A (آمن)</option>
                <option value="B">فئة B</option>
                <option value="C">فئة C (بحذر)</option>
                <option value="D">فئة D</option>
                <option value="X">فئة X (ممنوع بالحمل)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-700">ملاحظات التخزين والوصف الدوائي</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="يحفظ في درجة حرارة أقل من 25 مئوية..."
              className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <ImagePickerField label="صورة الدواء (اختياري)" value={pic} onChange={setPic} fallback="tablet.png" />

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded bg-[#0B4F9C] px-6 py-2.5 text-sm font-bold text-white shadow hover:bg-[#083D7A] disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ الدواء والتشغيلة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
