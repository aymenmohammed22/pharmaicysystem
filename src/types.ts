export type UserRole =
  | 'developer'
  | 'admin'
  | 'pharmacy_owner'
  | 'pharmacy_manager'
  | 'pharmacist'
  | 'cashier'
  | 'storekeeper'
  | 'accountant'
  | 'purchasing_officer';

export const ROLE_LABELS: Record<UserRole, string> = {
  developer: 'مطور النظام (Developer)',
  admin: 'المدير العام (Admin)',
  pharmacy_owner: 'مالك الصيدلية (Pharmacy Owner)',
  pharmacy_manager: 'مدير الصيدلية',
  pharmacist: 'صيدلاني',
  cashier: 'كاشير / نقطة بيع',
  storekeeper: 'أمين المخزن / المستودع',
  accountant: 'محاسب مالي',
  purchasing_officer: 'مسؤول المشتريات',
};

export interface UserPermissions {
  viewDashboard: boolean;
  viewInventories: boolean;
  manageMedicines: boolean;
  deleteMedicines: boolean;
  manageBatches: boolean;
  manageCategories: boolean;
  deleteCategories: boolean;
  posBilling: boolean;
  manageShifts: boolean;
  cancelInvoices: boolean;
  processReturns: boolean;
  viewReports: boolean;
  deleteReports: boolean;
  manageSuppliers: boolean;
  deleteSuppliers: boolean;
  managePurchases: boolean;
  approvePurchases: boolean;
  manageWarehouses: boolean;
  approveTransfers: boolean;
  manageCustomers: boolean;
  managePrescriptions: boolean;
  manageAccounting: boolean;
  manageHr: boolean;
  viewAuditLog: boolean;
  manageUsers: boolean;
  manageSiteSettings: boolean;
}

export type PermissionKey = keyof UserPermissions;

const ALL_TRUE: UserPermissions = {
  viewDashboard: true,
  viewInventories: true,
  manageMedicines: true,
  deleteMedicines: true,
  manageBatches: true,
  manageCategories: true,
  deleteCategories: true,
  posBilling: true,
  manageShifts: true,
  cancelInvoices: true,
  processReturns: true,
  viewReports: true,
  deleteReports: true,
  manageSuppliers: true,
  deleteSuppliers: true,
  managePurchases: true,
  approvePurchases: true,
  manageWarehouses: true,
  approveTransfers: true,
  manageCustomers: true,
  managePrescriptions: true,
  manageAccounting: true,
  manageHr: true,
  viewAuditLog: true,
  manageUsers: true,
  manageSiteSettings: true,
};

const ALL_FALSE: UserPermissions = {
  viewDashboard: false,
  viewInventories: false,
  manageMedicines: false,
  deleteMedicines: false,
  manageBatches: false,
  manageCategories: false,
  deleteCategories: false,
  posBilling: false,
  manageShifts: false,
  cancelInvoices: false,
  processReturns: false,
  viewReports: false,
  deleteReports: false,
  manageSuppliers: false,
  deleteSuppliers: false,
  managePurchases: false,
  approvePurchases: false,
  manageWarehouses: false,
  approveTransfers: false,
  manageCustomers: false,
  managePrescriptions: false,
  manageAccounting: false,
  manageHr: false,
  viewAuditLog: false,
  manageUsers: false,
  manageSiteSettings: false,
};

export const DEFAULT_PERMISSIONS_BY_ROLE: Record<UserRole, UserPermissions> = {
  developer: { ...ALL_TRUE },
  admin: { ...ALL_TRUE },
  pharmacy_owner: { ...ALL_TRUE },
  pharmacy_manager: {
    ...ALL_TRUE,
    manageSiteSettings: false,
    deleteReports: false,
  },
  pharmacist: {
    ...ALL_FALSE,
    viewDashboard: true,
    viewInventories: true,
    manageMedicines: true,
    manageBatches: true,
    manageCategories: true,
    posBilling: true,
    manageShifts: true,
    processReturns: true,
    viewReports: true,
    manageSuppliers: true,
    managePurchases: true,
    manageWarehouses: true,
    manageCustomers: true,
    managePrescriptions: true,
  },
  cashier: {
    ...ALL_FALSE,
    viewDashboard: true,
    viewInventories: true,
    posBilling: true,
    manageShifts: true,
    processReturns: true,
    viewReports: true,
    manageCustomers: true,
  },
  storekeeper: {
    ...ALL_FALSE,
    viewDashboard: true,
    viewInventories: true,
    manageMedicines: true,
    manageBatches: true,
    manageCategories: true,
    manageWarehouses: true,
    approveTransfers: true,
    managePurchases: true,
    viewReports: true,
  },
  accountant: {
    ...ALL_FALSE,
    viewDashboard: true,
    viewReports: true,
    manageAccounting: true,
    manageSuppliers: true,
    manageCustomers: true,
    manageHr: true,
    viewAuditLog: true,
  },
  purchasing_officer: {
    ...ALL_FALSE,
    viewDashboard: true,
    viewInventories: true,
    manageSuppliers: true,
    managePurchases: true,
    approvePurchases: true,
    manageBatches: true,
    viewReports: true,
  },
};

export const PERMISSION_DEFINITIONS: Array<{
  key: PermissionKey;
  label: string;
  group: string;
}> = [
  { key: 'viewDashboard', label: 'عرض لوحة التحكم والتنبيهات', group: 'العرض والتنقل' },
  { key: 'viewInventories', label: 'تصفح المخزون الدوائي والبحث', group: 'الأدوية والتشغيلات' },
  { key: 'manageMedicines', label: 'إضافة وتعديل الأدوية والوحدات والباركود', group: 'الأدوية والتشغيلات' },
  { key: 'deleteMedicines', label: 'حذف الأدوية من المخزون', group: 'الأدوية والتشغيلات' },
  { key: 'manageBatches', label: 'إدارة التشغيلات والصلاحية والحجر الصحي', group: 'الأدوية والتشغيلات' },
  { key: 'manageCategories', label: 'إضافة وتعديل التصنيفات الدوائية', group: 'الأدوية والتشغيلات' },
  { key: 'deleteCategories', label: 'حذف التصنيفات الدوائية', group: 'الأدوية والتشغيلات' },
  { key: 'posBilling', label: 'نقطة البيع والكاشير وتعليق الفواتير', group: 'نقطة البيع والمرتجعات' },
  { key: 'manageShifts', label: 'فتح وإغلاق ومطابقة ورديات الكاشير', group: 'نقطة البيع والمرتجعات' },
  { key: 'cancelInvoices', label: 'إلغاء الفواتير المصدرة وعكس قيودها', group: 'نقطة البيع والمرتجعات' },
  { key: 'processReturns', label: 'إصدار مرتجعات المبيعات واسترداد المبالغ', group: 'نقطة البيع والمرتجعات' },
  { key: 'manageSuppliers', label: 'إدارة الموردين وكشوف حساباتهم', group: 'المشتريات والمستودعات' },
  { key: 'deleteSuppliers', label: 'حذف الموردين', group: 'المشتريات والمستودعات' },
  { key: 'managePurchases', label: 'طلبات وفواتير الشراء ومرتجع الموردين', group: 'المشتريات والمستودعات' },
  { key: 'approvePurchases', label: 'اعتماد طلبات وأوامر الشراء', group: 'المشتريات والمستودعات' },
  { key: 'manageWarehouses', label: 'إدارة المستودعات والتحويلات والجرد والتالف', group: 'المشتريات والمستودعات' },
  { key: 'approveTransfers', label: 'اعتماد التحويلات المخزنية بين الفروع', group: 'المشتريات والمستودعات' },
  { key: 'manageCustomers', label: 'إدارة العملاء وحد الائتمان وكشف الحساب', group: 'العملاء والوصفات' },
  { key: 'managePrescriptions', label: 'إدارة الأطباء والوصفات الطبية وصرفها', group: 'العملاء والوصفات' },
  { key: 'manageAccounting', label: 'المحاسبة: القيود، السندات، الصناديق، القوائم المالية', group: 'المالية والموظفين' },
  { key: 'manageHr', label: 'شؤون الموظفين والحضور والرواتب والعمولات', group: 'المالية والموظفين' },
  { key: 'viewReports', label: 'عرض التقارير التحليلية والتصدير', group: 'التقارير والأمان' },
  { key: 'deleteReports', label: 'حذف الفواتير من الأرشيف', group: 'التقارير والأمان' },
  { key: 'viewAuditLog', label: 'مراجعة سجل التدقيق والعمليات (Audit Log)', group: 'التقارير والأمان' },
  { key: 'manageUsers', label: 'إدارة المستخدمين والصلاحيات والمنع/السماح', group: 'التقارير والأمان' },
  { key: 'manageSiteSettings', label: 'ضبط وتجديد العملة وإعدادات الصيدلية', group: 'التقارير والأمان' },
];

export const DOSAGE_FORMS = [
  'أقراص',
  'كبسولات',
  'شراب',
  'حقن / أمبول',
  'كريم / مرهم',
  'قطرة',
  'بخاخ',
  'تحاميل',
  'فوار / أكياس',
  'مستلزمات طبية',
];

export interface CurrencyPreset {
  code: string;
  symbol: string;
  name: string;
  suggestedRateFromSar?: number;
}

export const CURRENCY_PRESETS: CurrencyPreset[] = [
  { code: 'SAR', symbol: 'ر.س', name: 'ريال سعودي', suggestedRateFromSar: 1 },
  { code: 'YER', symbol: 'ر.ي', name: 'ريال يمني', suggestedRateFromSar: 140 },
  { code: 'AED', symbol: 'د.إ', name: 'درهم إماراتي', suggestedRateFromSar: 0.98 },
  { code: 'EGP', symbol: 'ج.م', name: 'جنيه مصري', suggestedRateFromSar: 13.1 },
  { code: 'IQD', symbol: 'د.ع', name: 'دينار عراقي', suggestedRateFromSar: 349 },
  { code: 'KWD', symbol: 'د.ك', name: 'دينار كويتي', suggestedRateFromSar: 0.082 },
  { code: 'JOD', symbol: 'د.أ', name: 'دينار أردني', suggestedRateFromSar: 0.189 },
  { code: 'OMR', symbol: 'ر.ع', name: 'ريال عماني', suggestedRateFromSar: 0.103 },
  { code: 'QAR', symbol: 'ر.ق', name: 'ريال قطري', suggestedRateFromSar: 0.97 },
  { code: 'BHD', symbol: 'د.ب', name: 'دينار بحريني', suggestedRateFromSar: 0.1 },
  { code: 'LBP', symbol: 'ل.ل', name: 'ليرة لبنانية', suggestedRateFromSar: 23800 },
  { code: 'MAD', symbol: 'د.م', name: 'درهم مغربي', suggestedRateFromSar: 2.65 },
  { code: 'TND', symbol: 'د.ت', name: 'دينار تونسي', suggestedRateFromSar: 0.83 },
  { code: 'SDG', symbol: 'ج.س', name: 'جنيه سوداني', suggestedRateFromSar: 160 },
  { code: 'USD', symbol: '$', name: 'دولار أمريكي', suggestedRateFromSar: 0.2667 },
  { code: 'EUR', symbol: '€', name: 'يورو أوروبي', suggestedRateFromSar: 0.246 },
  { code: 'GBP', symbol: '£', name: 'جنيه إسترليني', suggestedRateFromSar: 0.21 },
  { code: 'TRY', symbol: '₺', name: 'ليرة تركية', suggestedRateFromSar: 9.15 },
];

export interface AdditionalCurrency {
  code: string;
  symbol: string;
  name: string;
  rateToBase: number;
  enabled: boolean;
}

export interface SiteSettings {
  id: number;
  title: string;
  name: string;
  tradeName?: string;
  logo?: string;
  currencyCode: string;
  currencySymbol: string;
  currencyName: string;
  currencyDecimals?: number;
  salesCurrencyCode?: string;
  purchasesCurrencyCode?: string;
  additionalCurrencies?: AdditionalCurrency[];
  autoConvertCurrencies?: boolean;
  defaultDisplayCurrency?: string;
  ownerName?: string;
  ownerEmail?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  taxNumber?: string;
  licenseNumber?: string;
  notes?: string;
  licenseExpiresAt?: string;
  licenseDaysRemaining?: number | null;
  licenseExpiringSoon?: boolean;
  licenseExpired?: boolean;
}

export interface CurrencyRateHistory {
  id: number;
  currency_code: string;
  currency_symbol: string;
  currency_name: string;
  old_rate: number;
  new_rate: number;
  changed_by: number;
  changed_by_name: string;
  pharmacy_id: number;
  created_at: string;
}

export interface User {
  id: number;
  email: string;
  username: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  permissions: UserPermissions;
  pic: string;
  number: string;
  pharmacy_id?: number;
  date: string;
}

export function hasPermission(user: User | null | undefined, perm: PermissionKey): boolean {
  if (!user || !user.isActive) return false;
  return Boolean(user.permissions?.[perm]);
}

export function formatMoney(amount: string | number, currencySymbol = 'ر.س'): string {
  const num = Number(amount);
  const formatted = Number.isFinite(num) ? num.toFixed(2) : '0.00';
  return `${formatted} ${currencySymbol}`;
}

export function getAvailableCurrencies(site: SiteSettings): AdditionalCurrency[] {
  const base: AdditionalCurrency = {
    code: site.currencyCode,
    symbol: site.currencySymbol,
    name: site.currencyName,
    rateToBase: 1,
    enabled: true,
  };
  const extras = (site.additionalCurrencies || []).filter(
    (c) => c.enabled && c.code && c.code !== site.currencyCode && Number(c.rateToBase) > 0,
  );
  return [base, ...extras];
}

export function resolveCurrencyInfo(site: SiteSettings, code?: string): AdditionalCurrency {
  const target = (code || '').trim().toUpperCase();
  if (!target || target === site.currencyCode) {
    return {
      code: site.currencyCode,
      symbol: site.currencySymbol,
      name: site.currencyName,
      rateToBase: 1,
      enabled: true,
    };
  }
  const found = (site.additionalCurrencies || []).find((c) => c.code === target && Number(c.rateToBase) > 0);
  if (found) return found;
  return {
    code: site.currencyCode,
    symbol: site.currencySymbol,
    name: site.currencyName,
    rateToBase: 1,
    enabled: true,
  };
}

export function convertFromBase(amountInBase: number, targetCode: string | undefined, site: SiteSettings): number {
  const info = resolveCurrencyInfo(site, targetCode);
  return Number((amountInBase * info.rateToBase).toFixed(2));
}

export interface Category {
  id: number;
  name: string;
  pic: string;
  details: string;
  date: string;
  medicineCount: number;
}

export interface InventoryItem {
  id: number;
  catId: number;
  categoryName?: string;
  supplier: string;
  name: string;
  scientificName: string;
  activeIngredient: string;
  dosageForm: string;
  countryOfOrigin: string;
  regNumber: string;
  unit: string;
  packUnit: string;
  stripUnit: string;
  stripsPerPack: number;
  stripPrice: number;
  pieceUnit: string;
  piecesPerPack: number;
  piecePrice: number;
  purchasePrice: number;
  price: string;
  quantity: number;
  minStock: number;
  maxStock: number;
  storageLocation: string;
  requiresPrescription: boolean;
  isControlled?: boolean;
  controlledSchedule?: string;
  maxDailyDose?: string;
  pregnancyCategory?: string;
  status: string;
  barcode: string;
  batchNumber: string;
  expiryDate: string;
  pic: string;
  description: string;
  company: string;
  date: string;
}

export interface MedicineBatch {
  id: number;
  medicine_id: number;
  medicine_name?: string;
  warehouse_id: number;
  warehouse_name?: string;
  supplier_name: string;
  batch_number: string;
  production_date: string;
  expiry_date: string;
  qty_initial: number;
  qty_remaining: number;
  purchase_price: number;
  status: 'active' | 'quarantined' | 'expired' | 'damaged';
  notes: string;
  created_at: string;
}

export interface Warehouse {
  id: number;
  name: string;
  type: 'main' | 'branch';
  location: string;
  is_active: number;
  created_at: string;
  totalUnits?: number;
  costValuation?: number;
}

export interface StockTransfer {
  id: number;
  from_warehouse_id: number;
  to_warehouse_id: number;
  from_warehouse_name: string;
  to_warehouse_name: string;
  status: 'pending' | 'approved' | 'received';
  notes: string;
  requested_by: number;
  requested_by_name?: string;
  created_at: string;
  received_at: string;
  items: Array<{
    id: number;
    transfer_id: number;
    medicine_id: number;
    medicine_name: string;
    batch_id: number | null;
    batch_number: string;
    qty: number;
  }>;
}

export interface StockCountRecord {
  id: number;
  warehouse_id: number;
  warehouse_name?: string;
  medicine_id: number;
  medicine_name: string;
  batch_id: number | null;
  system_qty: number;
  counted_qty: number;
  variance: number;
  adjustment_type: string;
  reason: string;
  user_id: number;
  user_name?: string;
  created_at: string;
}

export interface StockMovement {
  id: number;
  medicine_id: number;
  medicine_name: string;
  warehouse_id: number;
  warehouse_name?: string;
  batch_id: number | null;
  batch_number: string;
  movement_type: string;
  qty_change: number;
  balance_after: number;
  reference_type: string;
  reference_id: number | null;
  notes: string;
  user_id: number;
  user_name?: string;
  created_at: string;
}

export interface Supplier {
  id: number;
  name: string;
  pic: string;
  number: string;
  address: string;
  cnic: string;
  balance?: number;
  date: string;
}

export interface PurchaseOrder {
  id: number;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name?: string;
  stage: string;
  status: 'pending' | 'ordered' | 'received';
  invoice_number: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  shipping_cost: number;
  total_amount: number;
  paid_amount: number;
  notes: string;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  received_at: string;
  items: Array<{
    id: number;
    po_id: number;
    medicine_id: number;
    medicine_name: string;
    qty: number;
    purchase_price: number;
    discount_pct: number;
    landed_unit_cost: number;
    batch_number: string;
    production_date: string;
    expiry_date: string;
  }>;
}

export interface PurchaseReturn {
  id: number;
  po_id: number | null;
  supplier_id: number;
  supplier_name: string;
  medicine_id: number;
  medicine_name: string;
  batch_id: number | null;
  qty: number;
  unit_cost: number;
  total_amount: number;
  reason: string;
  user_id: number;
  user_name?: string;
  created_at: string;
}

export interface BillItem {
  id: number;
  name: string;
  scientificName?: string;
  dosageForm?: string;
  unit: string;
  packUnit?: string;
  stripUnit?: string;
  stripsPerPack?: number;
  pieceUnit?: string;
  piecesPerPack?: number;
  saleUnit: string;
  unitFactor: number;
  price: number;
  discountPct: number;
  company: string;
  barcode: string;
  batchNumber: string;
  qty: number;
}

export interface PosShift {
  id: number;
  user_id: number;
  user_name: string;
  warehouse_id: number;
  opened_at: string;
  closed_at: string;
  opening_cash: number;
  cash_sales: number;
  card_sales: number;
  credit_sales: number;
  cash_returns: number;
  expected_cash: number;
  actual_cash: number | null;
  variance: number | null;
  status: 'open' | 'closed';
  notes: string;
}

export interface HeldBill {
  id: number;
  label: string;
  customer_name: string;
  items_json: string;
  discount: number;
  user_id: number;
  user_name?: string;
  created_at: string;
}

export interface SoldInvoice {
  id: number;
  name: string;
  contact: string;
  discount: string;
  item: string;
  amount: string;
  currencyCode?: string;
  currencySymbol?: string;
  exchangeRate?: number;
  baseAmount?: number;
  convertedAmount?: number;
  convertedCurrencyCode?: string;
  convertedCurrencySymbol?: string;
  paymentMethod?: string;
  paidAmount?: number;
  remainingAmount?: number;
  customerId?: number | null;
  prescriptionId?: number | null;
  shiftId?: number | null;
  warehouseId?: number;
  insuranceId?: number | null;
  insuranceClaimId?: number | null;
  insuranceShare?: number;
  patientCopay?: number;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyDiscount?: number;
  promoDiscount?: number;
  status?: string;
  userId: number;
  adminName: string;
  date: string;
  itemsDetail: BillItem[];
}

export interface SalesReturnRecord {
  id: number;
  sold_id: number;
  customer_name?: string;
  reason: string;
  refund_amount: number;
  refund_method: string;
  user_name?: string;
  created_at: string;
  items: Array<{
    id: number;
    medicine_id: number;
    medicine_name: string;
    qty: number;
    unit_factor: number;
    refund_price: number;
  }>;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  address: string;
  credit_limit: number;
  balance: number;
  notes: string;
  allergies?: string;
  chronic_conditions?: string;
  loyalty_points?: number;
  loyalty_tier?: string;
  insurance_id?: number | null;
  policy_number?: string;
  created_at: string;
  invoiceCount?: number;
  totalPurchases?: number;
}

export interface Doctor {
  id: number;
  name: string;
  specialty: string;
  clinic: string;
  phone: string;
  license_number: string;
  created_at: string;
  prescriptionCount?: number;
}

export interface Prescription {
  id: number;
  customer_id: number;
  customer_name: string;
  customer_phone?: string;
  doctor_id: number | null;
  doctor_name: string;
  doctor_specialty?: string;
  prescription_date: string;
  reference_notes: string;
  rx_type?: string;
  refills_allowed?: number;
  refills_used?: number;
  insurance_id?: number | null;
  policy_number?: string;
  approval_code?: string;
  valid_until?: string;
  status: 'pending' | 'dispensed' | 'cancelled';
  dispensed_sold_id: number | null;
  created_by_name?: string;
  created_at: string;
  items: Array<{
    id: number;
    medicine_id: number | null;
    medicine_name: string;
    dosage: string;
    frequency: string;
    duration: string;
    qty: number;
  }>;
}

export interface Account {
  id: number;
  code: string;
  name: string;
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  balance: number;
  is_system: number;
}

export interface CashBox {
  id: number;
  name: string;
  box_type: 'cash' | 'bank';
  account_id: number;
  account_code?: string;
  account_name?: string;
  balance: number;
}

export interface JournalEntry {
  id: number;
  entry_date: string;
  description: string;
  reference_type: string;
  reference_id: number | null;
  user_id: number;
  user_name?: string;
  created_at: string;
  lines: Array<{
    id: number;
    account_id: number;
    account_code: string;
    account_name: string;
    account_type: string;
    debit: number;
    credit: number;
    notes: string;
  }>;
}

export interface Voucher {
  id: number;
  voucher_type: 'receipt' | 'payment' | 'expense' | 'income' | 'capital';
  cash_box_id: number;
  cash_box_name?: string;
  counterparty_type: string;
  counterparty_id: number | null;
  counterparty_name: string;
  account_id: number | null;
  account_name?: string;
  amount: number;
  description: string;
  voucher_date: string;
  user_name?: string;
  created_at: string;
}

export interface EmployeeProfile {
  id: number;
  user_id: number | null;
  user_email?: string;
  user_role?: string;
  full_name: string;
  job_title: string;
  specialty: string;
  phone: string;
  base_salary: number;
  commission_rate: number;
  hire_date: string;
  is_active: number;
}

export interface EmployeeAttendance {
  id: number;
  employee_id: number;
  full_name: string;
  job_title: string;
  work_date: string;
  check_in: string;
  check_out: string;
  status: string;
  notes: string;
}

export interface EmployeeTransaction {
  id: number;
  employee_id: number;
  full_name: string;
  job_title: string;
  tx_type: 'salary' | 'advance' | 'commission' | 'bonus' | 'deduction';
  amount: number;
  notes: string;
  tx_date: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: number;
  user_id: number;
  user_name: string;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: string;
  created_at: string;
}

export interface PharmacyAlerts {
  lowStock: Array<{ id: number; name: string; quantity: number; minStock: number }>;
  outOfStock: Array<{ id: number; name: string; quantity: number; minStock: number }>;
  expired: Array<{ id: number; name: string; expiryDate: string; batchNumber: string; batchId?: number }>;
  expiringSoon: Array<{
    id: number;
    name: string;
    expiryDate: string;
    batchNumber: string;
    daysLeft: number;
    qtyRemaining?: number;
  }>;
}

export interface ReportsData {
  displayCurrency?: {
    code: string;
    symbol: string;
    name: string;
    rateToBase: number;
    autoConverted: boolean;
  };
  sales: SoldInvoice[];
  salesReturns: SalesReturnRecord[];
  purchases: PurchaseOrder[];
  employeePerformance: Array<{
    id: number;
    name: string;
    role: string;
    invoiceCount: number;
    totalSales: number;
  }>;
  inventoryByCategory: Array<{
    id: number;
    name: string;
    pic: string;
    count: number;
    totalUnits: number;
    totalValue: number;
    totalCostValue?: number;
  }>;
  stagnantItems: Array<{
    id: number;
    name: string;
    quantity: number;
    price: string;
    purchase_price: number;
    expiryDate: string;
    categoryName: string;
  }>;
  alerts: PharmacyAlerts;
  summary: {
    totalInvoices: number;
    totalRevenue: number;
    totalSalesReturns: number;
    netRevenue: number;
    totalPurchases: number;
    totalCogs: number;
    grossProfit: number;
    totalMedicines: number;
    totalCategories: number;
    totalSuppliers: number;
    totalUsers: number;
    totalCustomers?: number;
    activeBatches?: number;
    totalReceivables?: number;
    totalPayables?: number;
  };
}

export interface DatabaseBackupPayload {
  format: string;
  version: number;
  exportedAt: string;
  exportedBy?: string;
  siteName?: string;
  siteTitle?: string;
  tableCount?: number;
  totalRows?: number;
  tableCounts?: Record<string, number>;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export interface DatabaseImportResult {
  ok: boolean;
  restoredTables: number;
  restoredRows: number;
  site: SiteSettings;
  user: User;
}

export type EnterpriseTabKey =
  | 'evaluation'
  | 'clinical'
  | 'insurance'
  | 'recalls'
  | 'branches'
  | 'loyalty'
  | 'analytics'
  | 'integrations';

export interface SystemEvaluationData {
  evaluatedAt: string;
  overallScore: number;
  overallCoreScore: number;
  overallExpansionScore: number;
  coreModules: Array<{
    key: string;
    title: string;
    status: string;
    score: number;
    evidence: string;
    actionPage: PageKey;
  }>;
  expansionModules: Array<{
    key: string;
    title: string;
    previousGap: string;
    status: string;
    score: number;
    details: string;
    tab: EnterpriseTabKey;
  }>;
  operationalFindings: Array<{
    severity: 'warning' | 'info' | 'ok';
    title: string;
    actionLabel: string;
    targetTab: EnterpriseTabKey;
  }>;
}

export interface DrugInteraction {
  id: number;
  ingredient_a: string;
  ingredient_b: string;
  severity: 'major' | 'moderate' | 'minor';
  clinical_effect: string;
  recommendation: string;
  created_at: string;
}

export interface CartClinicalCheck {
  alerts: Array<{ type: string; severity: string; message: string }>;
  interactionWarnings: Array<{
    severity: string;
    pair: string;
    effect: string;
    recommendation: string;
  }>;
  controlledMedicines: Array<{ id: number; name: string; schedule: string }>;
}

export interface ControlledDispenseLog {
  id: number;
  sold_id: number | null;
  medicine_id: number;
  medicine_name: string;
  schedule: string;
  patient_name: string;
  patient_national_id: string;
  doctor_name: string;
  doctor_license: string;
  prescription_number: string;
  qty: number;
  warehouse_id: number;
  pharmacist_id: number;
  pharmacist_name: string;
  notes: string;
  dispensed_at: string;
}

export interface InsuranceCompany {
  id: number;
  name: string;
  code: string;
  contact_phone: string;
  default_coverage_pct: number;
  max_claim_limit: number;
  balance: number;
  is_active: number;
  created_at: string;
  claimCount?: number;
}

export interface InsuranceClaim {
  id: number;
  claim_number: string;
  insurance_id: number;
  insurance_name: string;
  customer_id: number | null;
  customer_name: string;
  sold_id: number | null;
  policy_number: string;
  approval_code: string;
  total_amount: number;
  insurance_share: number;
  patient_copay: number;
  status: 'pending' | 'submitted' | 'approved' | 'paid' | 'rejected';
  notes: string;
  created_by: number;
  created_at: string;
}

export interface DrugRecall {
  id: number;
  recall_number: string;
  medicine_id: number;
  medicine_name: string;
  batch_id: number | null;
  batch_number: string;
  source: string;
  severity: string;
  reason: string;
  affected_qty: number;
  status: 'active' | 'quarantined' | 'returned_to_supplier' | 'resolved';
  initiated_by: number;
  initiated_by_name: string;
  notes: string;
  created_at: string;
}

export interface BatchTraceResult {
  batchQuery: string;
  batches: Array<MedicineBatch & { barcode?: string }>;
  purchaseOrders: Array<Record<string, unknown>>;
  movements: StockMovement[];
  affectedInvoices: Array<Record<string, unknown>>;
  recalls: DrugRecall[];
}

export interface BranchInfo extends Warehouse {
  code?: string;
  manager_name?: string;
  phone?: string;
  is_branch_pos?: number;
  target_daily_sales?: number;
  totalInvoices?: number;
  totalSales?: number;
  todaySales?: number;
  openShiftsCount?: number;
}

export interface Promotion {
  id: number;
  name: string;
  promo_type: string;
  scope: 'all' | 'category' | 'medicine';
  target_id: number | null;
  discount_pct: number;
  min_qty: number;
  start_date: string;
  end_date: string;
  is_active: number;
  notes: string;
  created_at: string;
}

export interface LoyaltyOverview {
  customers: Array<{
    id: number;
    name: string;
    phone: string;
    loyalty_points: number;
    loyalty_tier: string;
  }>;
  transactions: Array<{
    id: number;
    customer_id: number;
    customer_name: string;
    points_delta: number;
    tx_type: string;
    reference_sold_id: number | null;
    notes: string;
    created_at: string;
  }>;
}

export interface OperatingExpense {
  id: number;
  title: string;
  category: string;
  warehouse_id: number;
  warehouse_name?: string;
  cash_box_id: number;
  cash_box_name?: string;
  amount: number;
  expense_date: string;
  receipt_ref: string;
  notes: string;
  user_id: number;
  created_at: string;
}

export interface IntegrationConfig {
  id: number;
  integration_key: string;
  display_name: string;
  category: string;
  enabled: number;
  config_json: string;
  last_tested_at: string;
  last_status: string;
  notes: string;
}

export interface BackupSnapshot {
  id: number;
  snapshot_type: string;
  file_name: string;
  table_count: number;
  row_count: number;
  checksum_sha256: string;
  created_by: number;
  created_by_name: string;
  created_at: string;
}

export interface SmartAnalyticsData {
  abcItems: Array<{
    medicineId: number;
    medicineName: string;
    currentQty: number;
    minStock: number;
    qtySold: number;
    revenue: number;
    avgDailyUsage: number;
    daysOfStockLeft: number | null;
    suggestedReorderQty: number;
    abcClass: 'A' | 'B' | 'C';
    revenueSharePct: number;
  }>;
  reorderRecommendations: Array<{
    medicineId: number;
    medicineName: string;
    currentQty: number;
    minStock: number;
    avgDailyUsage: number;
    daysOfStockLeft: number | null;
    suggestedReorderQty: number;
    abcClass: 'A' | 'B' | 'C';
  }>;
  expiryRisk: {
    expiredValue: number;
    within30DaysValue: number;
    within60DaysValue: number;
    within90DaysValue: number;
  };
  profitability: {
    totalSalesRevenue: number;
    totalReturns: number;
    totalCogs: number;
    grossProfit: number;
    operatingExpensesTotal: number;
    payrollExpensesTotal: number;
    netOperatingProfit: number;
    netMarginPct: number;
  };
}

export interface PharmacyTenant {
  id: number;
  name: string;
  tradeName?: string;
  code: string;
  logo?: string;
  currencyCode: string;
  currencySymbol: string;
  currencyName: string;
  currencyDecimals?: number;
  ownerName: string;
  ownerUsername: string;
  ownerEmail: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  taxNumber?: string;
  licenseNumber?: string;
  isActive: boolean;
  subscriptionStart?: string;
  subscriptionMonths?: number;
  licenseExpiresAt?: string;
  licenseDaysRemaining?: number | null;
  licenseExpiringSoon?: boolean;
  licenseExpired?: boolean;
  lastLoginAt?: string;
  notes?: string;
  createdAt: string;
  userCount?: number;
  medicineCount?: number;
  salesCount?: number;
  revenue?: number;
}

export interface PlatformMetrics {
  totalPharmacies: number;
  activePharmacies: number;
  suspendedPharmacies: number;
  totalUsers: number;
  totalMedicines: number;
  totalSales: number;
  totalRevenue: number;
  totalLogins?: number;
  totalBackups?: number;
}

export interface PlatformAuditLog {
  id: number;
  actor_id: number;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: number | null;
  details: string;
  created_at: string;
}

export interface ProductBarcodeRecord {
  id: number;
  medicine_id: number;
  medicine_name?: string;
  batch_id: number | null;
  batch_number?: string | null;
  barcode: string;
  symbology: string;
  unit_type: 'pack' | 'strip' | 'piece' | 'box' | 'batch';
  unit_name: string;
  unit_factor: number;
  is_primary: number;
  is_active: number;
  notes: string;
  created_at: string;
}

export interface BarcodeHistoryRecord {
  id: number;
  medicine_id: number;
  old_barcode: string;
  new_barcode: string;
  unit_type: string;
  action: string;
  changed_by: number;
  changed_by_name: string;
  notes: string;
  created_at: string;
}

export interface HardwareDeviceRecord {
  id: number;
  device_key: string;
  name: string;
  device_type: 'thermal_printer' | 'label_printer' | 'a4_printer' | 'barcode_scanner';
  connection_type: 'browser_print' | 'usb_hid' | 'usb_serial' | 'network_tcp' | 'local_bridge' | 'electron_ipc';
  protocol: 'HTML_CSS' | 'ESCPOS' | 'ZPL' | 'TSPL' | 'HID';
  host: string;
  port: number;
  baud_rate: number;
  paper_width_mm: number;
  label_width_mm: number;
  label_height_mm: number;
  dpi: number;
  is_default: number;
  is_active: number;
  settings_json: string;
  last_seen_at: string;
  last_status: string;
  terminal_id: string;
  branch_id: number;
  created_at: string;
}

export interface PrintJobRecord {
  id: number;
  job_type: string;
  title: string;
  device_id: number | null;
  device_name?: string | null;
  protocol: string;
  transport: string;
  status: 'queued' | 'dispatched' | 'completed' | 'failed' | 'cancelled';
  copies: number;
  payload_preview: string;
  error_message: string;
  reference_type: string;
  reference_id: number | null;
  created_by: number;
  created_by_name: string;
  created_at: string;
  completed_at: string;
}

export interface HardwareAuditLogRecord {
  id: number;
  device_id: number | null;
  device_name: string;
  event_type: string;
  transport: string;
  status: string;
  details: string;
  user_id: number;
  user_name: string;
  created_at: string;
}

export type PageKey =
  | 'dashboard'
  | 'platformTenants'
  | 'developerTenants'
  | 'systemEvaluation'
  | 'enterpriseHub'
  | 'inventories'
  | 'addnew'
  | 'manageCat'
  | 'warehouses'
  | 'billing'
  | 'purchases'
  | 'suppliers'
  | 'customers'
  | 'accounting'
  | 'hr'
  | 'hrAudit'
  | 'reports'
  | 'users'
  | 'profile'
  | 'accountSetting';

export const SYSTEM_LOGO_SRC = '/assets/aistudio/7c2a7a8e-5e01-4eeb-80ee-00aa057372e0_d6bfeb4f.png';

export function resolvePhotoSrc(pic: string | undefined, fallback = 'cap.png'): string {
  const val = (pic || '').trim();
  if (!val) return `/photo/${encodeURIComponent(fallback)}`;
  if (val.startsWith('data:') || val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/')) {
    return val;
  }
  return `/photo/${encodeURIComponent(val)}`;
}

export function getExpiryStatus(expiryDate: string): 'expired' | 'soon' | 'valid' | 'none' {
  if (!expiryDate) return 'none';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return 'none';
  const diffDays = Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 'expired';
  if (diffDays <= 30) return 'soon';
  return 'valid';
}

export const PRESET_PHOTOS = [
  { label: 'كبسولات', file: 'cap.png' },
  { label: 'أقراص', file: 'tablet.png' },
  { label: 'شراب', file: 'syrup.png' },
  { label: 'كريم / مرهم', file: 'cream.png' },
  { label: 'لوشن', file: 'lotion.png' },
  { label: 'حقن', file: 'injection.jpg' },
  { label: 'أدوية شراب (صورة)', file: 'دواء-كحة-يسبب-النعاس-وأنواعهم.jpg' },
  { label: 'أدوية عامة', file: 'what-a-treatment-for-migraine-headache.jpg' },
  { label: 'أمراض مزمنة', file: '207136_4_1621846280.jpg' },
  { label: 'علاج أنيميا', file: 'أسرع_علاج_للأنيميا.jpg' },
  { label: 'صورة صيدلاني 1', file: 'png.png' },
  { label: 'صورة صيدلاني 2', file: 'pngwing.png' },
  { label: 'صورة مورد', file: 'fk.jpg' },
];
