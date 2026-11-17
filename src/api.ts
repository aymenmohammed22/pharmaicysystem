import type {
  Account,
  AdditionalCurrency,
  AuditLogRecord,
  BackupSnapshot,
  BatchTraceResult,
  BillItem,
  BranchInfo,
  CartClinicalCheck,
  CashBox,
  Category,
  ControlledDispenseLog,
  CurrencyRateHistory,
  Customer,
  DatabaseBackupPayload,
  DatabaseImportResult,
  Doctor,
  DrugInteraction,
  DrugRecall,
  EmployeeAttendance,
  EmployeeProfile,
  EmployeeTransaction,
  HeldBill,
  InsuranceClaim,
  InsuranceCompany,
  IntegrationConfig,
  InventoryItem,
  JournalEntry,
  LoyaltyOverview,
  MedicineBatch,
  OperatingExpense,
  PharmacyAlerts,
  PosShift,
  Prescription,
  Promotion,
  PurchaseOrder,
  PurchaseReturn,
  ReportsData,
  SalesReturnRecord,
  SiteSettings,
  SmartAnalyticsData,
  SoldInvoice,
  StockCountRecord,
  StockMovement,
  StockTransfer,
  Supplier,
  SystemEvaluationData,
  User,
  UserPermissions,
  UserRole,
  Voucher,
  Warehouse,
  PharmacyTenant,
  PlatformAuditLog,
  PlatformMetrics,
  ProductBarcodeRecord,
  BarcodeHistoryRecord,
  HardwareDeviceRecord,
  PrintJobRecord,
  HardwareAuditLogRecord,
} from './types';
import { showErrorPopup } from './lib/errorPopup';

export class ApiError extends Error {
  status?: number;
  accountBlocked?: boolean;
  licenseExpired?: boolean;
  licenseExpiresAt?: string;

  constructor(
    message: string,
    opts?: { status?: number; accountBlocked?: boolean; licenseExpired?: boolean; licenseExpiresAt?: string },
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = opts?.status;
    this.accountBlocked = opts?.accountBlocked;
    this.licenseExpired = opts?.licenseExpired;
    this.licenseExpiresAt = opts?.licenseExpiresAt;
  }
}

const TOKEN_STORAGE_KEY = 'mms_auth_token';
let memoryToken: string | null = null;
let onAccountBlockedHandler:
  | ((reason: string, meta?: { licenseExpired?: boolean; licenseExpiresAt?: string }) => void)
  | null = null;
let activePharmacyScopeId: number | null = null;

export function setActivePharmacyScope(pharmacyId: number | null): void {
  activePharmacyScopeId = pharmacyId;
}

export function getActivePharmacyScope(): number | null {
  return activePharmacyScopeId;
}

export function setAccountBlockedHandler(
  fn: ((reason: string, meta?: { licenseExpired?: boolean; licenseExpiresAt?: string }) => void) | null,
): void {
  onAccountBlockedHandler = fn;
}

function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    return memoryToken;
  } catch {
    return null;
  }
}

function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors in restricted iframes
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (activePharmacyScopeId) {
    headers['X-Pharmacy-Id'] = String(activePharmacyScopeId);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...options,
      headers,
    });
  } catch (netErr) {
    if (!url.includes('/api/bootstrap') && !url.includes('/api/auth/session')) {
      showErrorPopup(netErr);
    }
    throw netErr;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      setToken(null);
      if ((data.accountBlocked || data.licenseExpired) && onAccountBlockedHandler) {
        onAccountBlockedHandler(data.error || 'تم إيقاف هذا الحساب من قبل مدير النظام', {
          licenseExpired: Boolean(data.licenseExpired),
          licenseExpiresAt: data.licenseExpiresAt ? String(data.licenseExpiresAt) : undefined,
        });
      }
    }
    const errMsg = data.error || 'حدث خطأ في الاتصال بالخادم';
    const apiErr = new ApiError(errMsg, {
      status: res.status,
      accountBlocked: Boolean(data.accountBlocked),
      licenseExpired: Boolean(data.licenseExpired),
      licenseExpiresAt: data.licenseExpiresAt ? String(data.licenseExpiresAt) : undefined,
    });
    if (!url.includes('/api/bootstrap') && !url.includes('/api/auth/session') && !data.licenseExpired) {
      showErrorPopup(apiErr, undefined, { status: res.status });
    }
    throw apiErr;
  }
  return data as T;
}

export const api = {
  bootstrap: () =>
    request<{
      authenticated: boolean;
      user: User | null;
      site: SiteSettings;
      bill: BillItem[];
      blockedReason?: string;
      licenseExpired?: boolean;
      licenseExpiresAt?: string;
    }>('/api/bootstrap'),

  login: async (identifier: string, password: string) => {
    const res = await request<{ token?: string; user: User; site: SiteSettings; bill: BillItem[] }>(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ identifier, email: identifier, password }),
      },
    );
    if (res.token) {
      setToken(res.token);
    }
    return res;
  },

  logout: async () => {
    try {
      return await request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
    } finally {
      setToken(null);
    }
  },

  getAlerts: () => request<PharmacyAlerts>('/api/alerts'),

  // Categories
  getCategories: () => request<{ categories: Category[] }>('/api/categories'),
  createCategory: (payload: { name: string; details: string; pic: string }) =>
    request<{ category: Category }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCategory: (id: number, payload: { name: string; details: string; pic: string }) =>
    request<{ category: Category }>(`/api/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCategory: (id: number) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: 'DELETE' }),

  // Inventories & Full Drug Master Data
  getInventories: (catId?: number | null) =>
    request<{ inventories: InventoryItem[] }>(
      catId ? `/api/inventories?catId=${catId}` : '/api/inventories',
    ),
  createInventory: (payload: Record<string, unknown>) =>
    request<{ item: InventoryItem }>('/api/inventories', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateInventory: (id: number, payload: Partial<InventoryItem>) =>
    request<{ item: InventoryItem }>(`/api/inventories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteInventory: (id: number) =>
    request<{ ok: boolean }>(`/api/inventories/${id}`, { method: 'DELETE' }),

  // Batches & FEFO & Quarantine
  getBatches: (params?: { medicineId?: number; warehouseId?: number }) => {
    const qs = new URLSearchParams();
    if (params?.medicineId) qs.set('medicineId', String(params.medicineId));
    if (params?.warehouseId) qs.set('warehouseId', String(params.warehouseId));
    const q = qs.toString();
    return request<{ batches: MedicineBatch[] }>(q ? `/api/batches?${q}` : '/api/batches');
  },
  createBatch: (payload: {
    medicineId: number;
    warehouseId: number;
    batchNumber: string;
    productionDate?: string;
    expiryDate: string;
    qty: number;
    purchasePrice: number;
    supplierName?: string;
    notes?: string;
  }) =>
    request<{ batchId: number; totalQuantity: number }>('/api/batches', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBatchStatus: (id: number, status: 'active' | 'quarantined' | 'expired' | 'damaged', reason?: string) =>
    request<{ ok: boolean; totalQuantity: number }>(`/api/batches/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    }),

  // Warehouses, Transfers, Stocktaking & Movement Card
  getWarehouses: () => request<{ warehouses: Warehouse[] }>('/api/warehouses'),
  createWarehouse: (payload: { name: string; type: 'main' | 'branch'; location: string }) =>
    request<{ id: number }>('/api/warehouses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getTransfers: () => request<{ transfers: StockTransfer[] }>('/api/transfers'),
  createTransfer: (payload: {
    fromWarehouseId: number;
    toWarehouseId: number;
    notes?: string;
    items: Array<{ medicineId: number; qty: number }>;
  }) =>
    request<{ transferId: number }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approveTransfer: (id: number) =>
    request<{ ok: boolean }>(`/api/transfers/${id}/approve`, { method: 'POST' }),
  receiveTransfer: (id: number) =>
    request<{ ok: boolean }>(`/api/transfers/${id}/receive`, { method: 'POST' }),
  getStockCounts: () => request<{ counts: StockCountRecord[] }>('/api/stock-counts'),
  createStockCount: (payload: {
    batchId: number;
    countedQty: number;
    adjustmentType: string;
    reason: string;
  }) =>
    request<{ ok: boolean; variance: number; totalQuantity: number }>('/api/stock-counts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getStockMovements: (medicineId?: number) =>
    request<{ movements: StockMovement[] }>(
      medicineId ? `/api/stock-movements?medicineId=${medicineId}` : '/api/stock-movements',
    ),
  getStagnantItems: (days = 30) =>
    request<{ stagnant: Array<Record<string, unknown>>; days: number }>(`/api/warehouses/stagnant?days=${days}`),

  // POS Billing, Shifts, Held Bills, Cancel & Sales Returns
  getShifts: () => request<{ currentShift: PosShift | null; shifts: PosShift[] }>('/api/shifts'),
  openShift: (payload: { openingCash: number; warehouseId?: number }) =>
    request<{ shift: PosShift }>('/api/shifts/open', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  closeShift: (id: number, payload: { actualCash: number; notes?: string }) =>
    request<{ shift: PosShift }>(`/api/shifts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getHeldBills: () => request<{ held: HeldBill[] }>('/api/bill/held'),
  holdBill: (payload: { label?: string; customerName?: string; discount?: number }) =>
    request<{ id: number; bill: BillItem[] }>('/api/bill/hold', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  resumeHeldBill: (id: number) =>
    request<{ bill: BillItem[]; discount: number; customerName: string }>(`/api/bill/held/${id}/resume`, {
      method: 'POST',
    }),
  deleteHeldBill: (id: number) =>
    request<{ ok: boolean }>(`/api/bill/held/${id}`, { method: 'DELETE' }),

  getBill: () => request<{ bill: BillItem[] }>('/api/bill'),
  addToBill: (id: number, saleUnit?: string) =>
    request<{ bill: BillItem[] }>('/api/bill/add', {
      method: 'POST',
      body: JSON.stringify({ id, saleUnit }),
    }),
  scanBarcode: (barcode: string) =>
    request<{
      bill: BillItem[];
      addedItem: InventoryItem;
      matchedUnit?: string | null;
      gs1?: {
        gtin?: string;
        gtin13?: string;
        expiryDate?: string;
        batchNumber?: string;
        serialNumber?: string;
      } | null;
    }>('/api/bill/scan', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    }),
  updateBillItem: (
    id: number,
    payload: { qty?: number; saleUnit?: string; currentSaleUnit?: string; discountPct?: number },
  ) =>
    request<{ bill: BillItem[] }>(`/api/bill/item/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  removeBillItem: (id: number, saleUnit?: string) =>
    request<{ bill: BillItem[] }>(
      saleUnit ? `/api/bill/item/${id}?saleUnit=${encodeURIComponent(saleUnit)}` : `/api/bill/item/${id}`,
      { method: 'DELETE' },
    ),
  clearBill: () => request<{ bill: BillItem[] }>('/api/bill/clear', { method: 'POST' }),
  checkoutBill: (payload: {
    name: string;
    contact: string;
    discount: number;
    paymentMethod?: string;
    paidAmount?: number;
    customerId?: number | null;
    prescriptionId?: number | null;
    warehouseId?: number;
    invoiceCurrencyCode?: string;
    insuranceId?: number | null;
    policyNumber?: string;
    approvalCode?: string;
    coveragePct?: number;
    redeemPoints?: number;
    applyPromotions?: boolean;
    controlledMeta?: {
      patientNationalId?: string;
      doctorName?: string;
      doctorLicense?: string;
      prescriptionNumber?: string;
      notes?: string;
    };
  }) =>
    request<{ invoice: SoldInvoice; bill: BillItem[] }>('/api/bill/checkout', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelInvoice: (id: number) =>
    request<{ ok: boolean }>(`/api/sold/${id}/cancel`, { method: 'POST' }),
  getSalesReturns: () => request<{ returns: SalesReturnRecord[] }>('/api/sales-returns'),
  createSalesReturn: (payload: {
    soldId: number;
    reason: string;
    refundMethod: 'cash' | 'credit_note';
    items: Array<{ medicineId: number; batchId?: number | null; qty: number; unitFactor?: number; refundPrice: number }>;
  }) =>
    request<{ returnId: number; refundAmount: number }>('/api/sales-returns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Suppliers & Purchases
  getSuppliers: () => request<{ suppliers: Supplier[] }>('/api/suppliers'),
  createSupplier: (payload: Omit<Supplier, 'id' | 'date' | 'balance'>) =>
    request<{ supplier: Supplier }>('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSupplier: (id: number, payload: Partial<Supplier>) =>
    request<{ supplier: Supplier }>(`/api/suppliers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteSupplier: (id: number) =>
    request<{ ok: boolean }>(`/api/suppliers/${id}`, { method: 'DELETE' }),
  getSupplierStatement: (id: number) =>
    request<{
      supplier: Supplier;
      orders: Array<Record<string, unknown>>;
      returns: Array<Record<string, unknown>>;
      payments: Array<Record<string, unknown>>;
    }>(`/api/suppliers/${id}/statement`),

  getPurchases: () => request<{ orders: PurchaseOrder[] }>('/api/purchases'),
  createPurchase: (payload: {
    supplierId: number;
    warehouseId: number;
    discountAmount?: number;
    taxAmount?: number;
    shippingCost?: number;
    notes?: string;
    items: Array<{
      medicineId: number;
      qty: number;
      purchasePrice: number;
      discountPct?: number;
      batchNumber?: string;
      productionDate?: string;
      expiryDate?: string;
    }>;
  }) =>
    request<{ id: number; totalAmount: number }>('/api/purchases', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approvePurchase: (id: number) =>
    request<{ ok: boolean }>(`/api/purchases/${id}/approve`, { method: 'POST' }),
  receivePurchase: (
    id: number,
    payload: {
      invoiceNumber?: string;
      paidAmount?: number;
      cashBoxId?: number;
      items?: Array<{ id: number; batchNumber?: string; productionDate?: string; expiryDate?: string; qty?: number }>;
    },
  ) =>
    request<{ ok: boolean }>(`/api/purchases/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPurchaseReturns: () => request<{ returns: PurchaseReturn[] }>('/api/purchase-returns'),
  createPurchaseReturn: (payload: { supplierId: number; batchId: number; qty: number; reason: string }) =>
    request<{ id: number; totalAmount: number }>('/api/purchase-returns', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPurchasePriceComparison: () =>
    request<{ comparison: Array<Record<string, unknown>> }>('/api/purchases/price-comparison'),

  // Customers, Doctors & Prescriptions
  getCustomers: () => request<{ customers: Customer[] }>('/api/customers'),
  createCustomer: (payload: {
    name: string;
    phone: string;
    address?: string;
    creditLimit?: number;
    notes?: string;
    allergies?: string;
    chronicConditions?: string;
    insuranceId?: number | null;
    policyNumber?: string;
  }) =>
    request<{ customer: Customer }>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCustomer: (
    id: number,
    payload: {
      name?: string;
      phone?: string;
      address?: string;
      creditLimit?: number;
      notes?: string;
      allergies?: string;
      chronicConditions?: string;
      insuranceId?: number | null;
      policyNumber?: string;
    },
  ) =>
    request<{ customer: Customer }>(`/api/customers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCustomer: (id: number) =>
    request<{ ok: boolean }>(`/api/customers/${id}`, { method: 'DELETE' }),
  getCustomerStatement: (id: number) =>
    request<{
      customer: Customer;
      invoices: Array<Record<string, unknown>>;
      payments: Array<Record<string, unknown>>;
      prescriptions: Array<Record<string, unknown>>;
    }>(`/api/customers/${id}/statement`),

  getDoctors: () => request<{ doctors: Doctor[] }>('/api/doctors'),
  createDoctor: (payload: {
    name: string;
    specialty?: string;
    clinic?: string;
    phone?: string;
    licenseNumber?: string;
  }) =>
    request<{ doctor: Doctor }>('/api/doctors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDoctor: (id: number, payload: Record<string, unknown>) =>
    request<{ doctor: Doctor }>(`/api/doctors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteDoctor: (id: number) =>
    request<{ ok: boolean }>(`/api/doctors/${id}`, { method: 'DELETE' }),

  getPrescriptions: () => request<{ prescriptions: Prescription[] }>('/api/prescriptions'),
  createPrescription: (payload: {
    customerId: number;
    doctorId?: number | null;
    prescriptionDate?: string;
    referenceNotes?: string;
    rxType?: string;
    refillsAllowed?: number;
    insuranceId?: number | null;
    policyNumber?: string;
    approvalCode?: string;
    validUntil?: string;
    items: Array<{
      medicineId?: number | null;
      medicineName: string;
      dosage?: string;
      frequency?: string;
      duration?: string;
      qty: number;
    }>;
  }) =>
    request<{ prescription: Prescription }>('/api/prescriptions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePrescriptionStatus: (id: number, status: 'pending' | 'dispensed' | 'cancelled') =>
    request<{ ok: boolean }>(`/api/prescriptions/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  refillPrescription: (id: number) =>
    request<{ prescription: Prescription }>(`/api/prescriptions/${id}/refill`, {
      method: 'POST',
    }),

  // Accounting & Finance
  getAccounts: () => request<{ accounts: Account[]; cashBoxes: CashBox[] }>('/api/accounting/accounts'),
  createAccount: (payload: { code: string; name: string; accountType: Account['account_type'] }) =>
    request<{ account: Account }>('/api/accounting/accounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getJournals: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    return request<{ journals: JournalEntry[] }>(q ? `/api/accounting/journals?${q}` : '/api/accounting/journals');
  },
  createJournal: (payload: {
    description: string;
    entryDate?: string;
    lines: Array<{ accountId: number; debit: number; credit: number; notes?: string }>;
  }) =>
    request<{ journalId: number }>('/api/accounting/journals', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getVouchers: () => request<{ vouchers: Voucher[] }>('/api/accounting/vouchers'),
  createVoucher: (payload: {
    voucherType: Voucher['voucher_type'];
    cashBoxId: number;
    amount: number;
    description: string;
    voucherDate?: string;
    counterpartyId?: number | null;
    counterpartyName?: string;
    accountId?: number | null;
  }) =>
    request<{ voucher: Voucher }>('/api/accounting/vouchers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAccountingStatements: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    const q = qs.toString();
    return request<{
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
      cashBoxes: CashBox[];
    }>(q ? `/api/accounting/statements?${q}` : '/api/accounting/statements');
  },
  getAccountStatement: (id: number) =>
    request<{ account: Account; movements: Array<Record<string, unknown>> }>(
      `/api/accounting/accounts/${id}/statement`,
    ),

  // HR & Audit Logs
  getEmployees: () => request<{ employees: EmployeeProfile[] }>('/api/hr/employees'),
  createEmployee: (payload: Record<string, unknown>) =>
    request<{ employee: EmployeeProfile }>('/api/hr/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEmployee: (id: number, payload: Record<string, unknown>) =>
    request<{ employee: EmployeeProfile }>(`/api/hr/employees/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getAttendance: (date?: string) =>
    request<{ attendance: EmployeeAttendance[] }>(date ? `/api/hr/attendance?date=${date}` : '/api/hr/attendance'),
  recordAttendance: (payload: {
    employeeId: number;
    workDate?: string;
    checkIn?: string;
    checkOut?: string;
    status: string;
    notes?: string;
  }) =>
    request<{ id: number }>('/api/hr/attendance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getEmployeeTransactions: (employeeId?: number) =>
    request<{ transactions: EmployeeTransaction[] }>(
      employeeId ? `/api/hr/transactions?employeeId=${employeeId}` : '/api/hr/transactions',
    ),
  createEmployeeTransaction: (payload: {
    employeeId: number;
    txType: EmployeeTransaction['tx_type'];
    amount: number;
    notes?: string;
    txDate?: string;
    payFromCashBox?: boolean;
    cashBoxId?: number;
  }) =>
    request<{ id: number }>('/api/hr/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getAuditLogs: (
    limitOrOptions:
      | number
      | {
          limit?: number;
          action?: string;
          entityType?: string;
          userId?: number;
          from?: string;
          to?: string;
          search?: string;
          sensitiveOnly?: boolean;
        } = 200,
  ) => {
    const opts = typeof limitOrOptions === 'number' ? { limit: limitOrOptions } : limitOrOptions;
    const params = new URLSearchParams();
    params.set('limit', String(opts.limit ?? 200));
    if (opts.action) params.set('action', opts.action);
    if (opts.entityType) params.set('entityType', opts.entityType);
    if (opts.userId) params.set('userId', String(opts.userId));
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.search) params.set('search', opts.search);
    if (opts.sensitiveOnly) params.set('sensitiveOnly', '1');
    return request<{
      logs: AuditLogRecord[];
      totalCount?: number;
      sensitiveCount?: number;
      actors?: Array<{ user_id: number; user_name: string }>;
    }>(`/api/audit-logs?${params.toString()}`);
  },

  // Reports
  getReports: (from?: string, to?: string, currency?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (currency) params.set('currency', currency);
    const qs = params.toString();
    return request<ReportsData>(qs ? `/api/reports?${qs}` : '/api/reports');
  },
  deleteReport: (id: number) =>
    request<{ ok: boolean }>(`/api/reports/${id}`, { method: 'DELETE' }),

  // Users & Permissions & Allow/Block
  getUsers: () => request<{ users: User[] }>('/api/users'),
  createUser: (payload: {
    email: string;
    username?: string;
    password: string;
    name: string;
    role: UserRole;
    isActive: boolean;
    permissions: UserPermissions;
    number: string;
    pic: string;
  }) =>
    request<{ user: User }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    id: number,
    payload: {
      email?: string;
      username?: string;
      password?: string;
      name?: string;
      role?: UserRole;
      isActive?: boolean;
      permissions?: UserPermissions;
      number?: string;
      pic?: string;
    },
  ) =>
    request<{ user: User }>(`/api/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  toggleUserStatus: (id: number, isActive: boolean) =>
    request<{ user: User }>(`/api/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/api/users/${id}`, { method: 'DELETE' }),

  // Profile & Account & Site / Currency Settings
  updateProfile: (payload: { name: string; number: string; pic?: string }) =>
    request<{ user: User }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateAccount: (payload: {
    email: string;
    username?: string;
    currentPassword?: string;
    newPassword?: string;
  }) =>
    request<{ user: User }>('/api/account', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  updateSite: (payload: {
    title?: string;
    name?: string;
    tradeName?: string;
    logo?: string;
    currencyCode?: string;
    currencySymbol?: string;
    currencyName?: string;
    currencyDecimals?: number;
    salesCurrencyCode?: string;
    purchasesCurrencyCode?: string;
    convertPrices?: boolean;
    exchangeMultiplier?: number;
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
  }) =>
    request<{ site: SiteSettings; convertedPrices?: boolean }>('/api/site', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getCurrencySettings: () =>
    request<{
      baseCurrency: { code: string; symbol: string; name: string; decimals: number };
      additionalCurrencies: AdditionalCurrency[];
      autoConvertCurrencies: boolean;
      defaultDisplayCurrency: string;
      salesCurrencyCode: string;
      purchasesCurrencyCode: string;
      rateHistory: CurrencyRateHistory[];
    }>('/api/pharmacy/currencies'),

  // Full Database JSON Export / Import
  exportDatabase: () => request<DatabaseBackupPayload>('/api/database/export'),
  importDatabase: (backup: DatabaseBackupPayload) =>
    request<DatabaseImportResult>('/api/database/import', {
      method: 'POST',
      body: JSON.stringify(backup),
    }),

  // System Evaluation & Enterprise Expansion Modules
  getSystemEvaluation: () => request<SystemEvaluationData>('/api/system-evaluation'),

  // 1 & 7. Clinical Vigilance & Controlled Substances
  getInteractions: () => request<{ interactions: DrugInteraction[] }>('/api/clinical/interactions'),
  createInteraction: (payload: {
    ingredientA: string;
    ingredientB: string;
    severity: 'major' | 'moderate' | 'minor';
    clinicalEffect: string;
    recommendation?: string;
  }) =>
    request<{ interaction: DrugInteraction }>('/api/clinical/interactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteInteraction: (id: number) =>
    request<{ ok: boolean }>(`/api/clinical/interactions/${id}`, { method: 'DELETE' }),
  clinicalCheckCart: (payload: { medicineIds: number[]; customerId?: number | null }) =>
    request<CartClinicalCheck>('/api/clinical/check-cart', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getControlledLogs: (limit = 200) =>
    request<{ logs: ControlledDispenseLog[] }>(`/api/controlled-logs?limit=${limit}`),
  createControlledLog: (payload: {
    medicineId: number;
    patientName: string;
    patientNationalId: string;
    doctorName?: string;
    doctorLicense?: string;
    prescriptionNumber: string;
    qty: number;
    notes?: string;
  }) =>
    request<{ log: ControlledDispenseLog }>('/api/controlled-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 2. Insurance Companies & Claims
  getInsuranceCompanies: () => request<{ companies: InsuranceCompany[] }>('/api/insurance/companies'),
  createInsuranceCompany: (payload: {
    name: string;
    code?: string;
    contactPhone?: string;
    defaultCoveragePct?: number;
    maxClaimLimit?: number;
  }) =>
    request<{ company: InsuranceCompany }>('/api/insurance/companies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateInsuranceCompany: (
    id: number,
    payload: Partial<{
      name: string;
      code: string;
      contactPhone: string;
      defaultCoveragePct: number;
      maxClaimLimit: number;
      isActive: boolean;
    }>,
  ) =>
    request<{ company: InsuranceCompany }>(`/api/insurance/companies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  getInsuranceClaims: () => request<{ claims: InsuranceClaim[] }>('/api/insurance/claims'),
  updateInsuranceClaimStatus: (
    id: number,
    payload: { status: InsuranceClaim['status']; cashBoxId?: number },
  ) =>
    request<{ claim: InsuranceClaim }>(`/api/insurance/claims/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // 3. Supply Chain & Recalls
  getRecalls: () => request<{ recalls: DrugRecall[] }>('/api/supply-chain/recalls'),
  createRecall: (payload: {
    medicineId: number;
    batchNumber: string;
    source?: string;
    severity?: string;
    reason: string;
    notes?: string;
  }) =>
    request<{ recall: DrugRecall }>('/api/supply-chain/recalls', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateRecallStatus: (id: number, status: DrugRecall['status']) =>
    request<{ recall: DrugRecall }>(`/api/supply-chain/recalls/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  traceBatch: (batchNumber: string) =>
    request<BatchTraceResult>(`/api/supply-chain/trace-batch?batchNumber=${encodeURIComponent(batchNumber)}`),

  // 4. Multi-Branch Operations
  getBranches: () => request<{ branches: BranchInfo[] }>('/api/branches'),
  updateBranch: (
    id: number,
    payload: {
      name?: string;
      code?: string;
      managerName?: string;
      phone?: string;
      location?: string;
      isBranchPos?: boolean;
      targetDailySales?: number;
    },
  ) =>
    request<{ branch: BranchInfo }>(`/api/branches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // 5. Promotions & Loyalty
  getPromotions: () => request<{ promotions: Promotion[] }>('/api/promotions'),
  createPromotion: (payload: {
    name: string;
    promoType?: string;
    scope: 'all' | 'category' | 'medicine';
    targetId?: number | null;
    discountPct: number;
    minQty?: number;
    startDate?: string;
    endDate?: string;
    notes?: string;
  }) =>
    request<{ promotion: Promotion }>('/api/promotions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePromotion: (id: number, payload: { isActive?: boolean; discountPct?: number; endDate?: string }) =>
    request<{ promotion: Promotion }>(`/api/promotions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deletePromotion: (id: number) =>
    request<{ ok: boolean }>(`/api/promotions/${id}`, { method: 'DELETE' }),
  getLoyaltyOverview: () => request<LoyaltyOverview>('/api/loyalty/overview'),

  // 6. Operating Expenses & Cost Centers
  getOperatingExpenses: () => request<{ expenses: OperatingExpense[] }>('/api/accounting/expenses'),
  createOperatingExpense: (payload: {
    title: string;
    category: string;
    warehouseId?: number;
    amount: number;
    expenseDate?: string;
    cashBoxId?: number;
    receiptRef?: string;
    notes?: string;
  }) =>
    request<{ expense: OperatingExpense }>('/api/accounting/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 8. Integrations & ZATCA QR
  getIntegrations: () => request<{ integrations: IntegrationConfig[] }>('/api/integrations'),
  updateIntegration: (key: string, payload: { enabled?: boolean; config?: Record<string, unknown>; notes?: string }) =>
    request<{ integration: IntegrationConfig }>(`/api/integrations/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  testIntegration: (key: string) =>
    request<{ ok: boolean; message: string; integration: IntegrationConfig }>(
      `/api/integrations/${encodeURIComponent(key)}/test`,
      { method: 'POST' },
    ),
  generateZatcaQr: (payload: {
    sellerName?: string;
    vatNumber?: string;
    timestamp?: string;
    totalAmount: number;
    vatAmount?: number;
  }) =>
    request<{ tlvBase64: string; fields: Record<string, string> }>('/api/integrations/zatca-qr', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // 9. Disaster Recovery Snapshots
  getBackupSnapshots: () => request<{ snapshots: BackupSnapshot[] }>('/api/backup/snapshots'),
  createBackupCheckpoint: (label?: string) =>
    request<{ snapshot: BackupSnapshot }>('/api/backup/checkpoint', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),
  restoreBackupSnapshot: (id: number) =>
    request<{ ok: boolean; restoredRows: number; site: SiteSettings; user: User }>(
      `/api/backup/snapshots/${id}/restore`,
      { method: 'POST' },
    ),

  // 10. Smart Analytics & KPIs
  getSmartAnalytics: () => request<SmartAnalyticsData>('/api/analytics/smart'),

  // 11. Platform Multi-Tenant SaaS Management
  getPlatformDashboard: () =>
    request<{
      metrics: PlatformMetrics;
      recentPharmacies: PharmacyTenant[];
      serverStatus: {
        nodeVersion: string;
        uptimeSeconds: number;
        memoryRssMb: number;
        platform: string;
        dbMode: string;
      };
    }>('/api/platform/dashboard'),

  getPlatformTenants: () => request<{ pharmacies: PharmacyTenant[] }>('/api/platform/tenants'),

  createPlatformTenant: (payload: {
    name: string;
    tradeName?: string;
    code?: string;
    logo?: string;
    currencyCode?: string;
    currencySymbol?: string;
    currencyName?: string;
    currencyDecimals?: number;
    ownerName: string;
    ownerUsername: string;
    ownerEmail: string;
    ownerPassword: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    notes?: string;
    taxNumber?: string;
    licenseNumber?: string;
    isActive?: boolean;
    subscriptionStart?: string;
    subscriptionMonths?: number;
    licenseExpiresAt?: string;
  }) =>
    request<{
      ok: boolean;
      pharmacy: PharmacyTenant;
      owner: User;
      defaultCredentials: { username: string; password: string };
    }>('/api/platform/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updatePlatformTenant: (
    id: number,
    payload: {
      name?: string;
      tradeName?: string;
      logo?: string;
      currencyCode?: string;
      currencySymbol?: string;
      currencyName?: string;
      currencyDecimals?: number;
      ownerName?: string;
      ownerUsername?: string;
      ownerEmail?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
      taxNumber?: string;
      licenseNumber?: string;
      subscriptionStart?: string;
      subscriptionMonths?: number;
      licenseExpiresAt?: string;
      isActive?: boolean;
      notes?: string;
    },
  ) =>
    request<{ ok: boolean; pharmacy: PharmacyTenant }>(`/api/platform/tenants/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deletePlatformTenant: (id: number) =>
    request<{ ok: boolean; deletedPharmacyId: number }>(`/api/platform/tenants/${id}`, {
      method: 'DELETE',
    }),

  togglePlatformTenantStatus: (id: number, isActive: boolean) =>
    request<{ ok: boolean; isActive: boolean }>(`/api/platform/tenants/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  resetPlatformTenantPassword: (id: number, newPassword: string) =>
    request<{ ok: boolean; username: string }>(`/api/platform/tenants/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),

  backupPlatformTenant: (id: number) =>
    request<{ ok: boolean; fileName: string; checksum: string; backup: DatabaseBackupPayload }>(
      `/api/platform/tenants/${id}/backup`,
      { method: 'POST' },
    ),

  restorePlatformTenant: (id: number, backup: DatabaseBackupPayload) =>
    request<{ ok: boolean; restoredTables: number; restoredRows: number }>(
      `/api/platform/tenants/${id}/restore`,
      {
        method: 'POST',
        body: JSON.stringify({ backup }),
      },
    ),

  getPlatformAuditLogs: () => request<{ logs: PlatformAuditLog[] }>('/api/platform/audit-logs'),

  // Multi-Barcode & GS1 Management (Stage 4 & 5)
  getBarcodes: (medicineId?: number) =>
    request<{ barcodes: ProductBarcodeRecord[]; history: BarcodeHistoryRecord[] }>(
      medicineId ? `/api/barcodes?medicineId=${medicineId}` : '/api/barcodes',
    ),
  generateInternalBarcode: () =>
    request<{ barcode: string; symbology: string; validCheckDigit: boolean }>('/api/barcodes/generate', {
      method: 'POST',
    }),
  createBarcode: (payload: {
    medicineId: number;
    batchId?: number | null;
    barcode: string;
    symbology?: string;
    unitType: 'pack' | 'strip' | 'piece' | 'box' | 'batch';
    unitName?: string;
    unitFactor?: number;
    isPrimary?: boolean;
    validateCheckDigit?: boolean;
    notes?: string;
  }) =>
    request<{ barcodeRecord: ProductBarcodeRecord }>('/api/barcodes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateBarcode: (id: number, payload: { isPrimary?: boolean; isActive?: boolean }) =>
    request<{ barcodeRecord: ProductBarcodeRecord }>(`/api/barcodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteBarcode: (id: number) =>
    request<{ ok: boolean }>(`/api/barcodes/${id}`, { method: 'DELETE' }),
  parseGs1Barcode: (barcode: string) =>
    request<{
      gs1: Record<string, unknown>;
      symbology: string;
      matchedMedicine: Record<string, unknown> | null;
      matchedBatch: Record<string, unknown> | null;
      matchedUnit: { unitType: string; unitName: string; unitFactor: number } | null;
    }>('/api/barcodes/parse-gs1', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    }),

  // Hardware Center & Print Queue (Stage 6 & 7)
  getHardwareDevices: () => request<{ devices: HardwareDeviceRecord[] }>('/api/hardware/devices'),
  createHardwareDevice: (payload: Record<string, unknown>) =>
    request<{ device: HardwareDeviceRecord }>('/api/hardware/devices', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateHardwareDevice: (id: number, payload: Record<string, unknown>) =>
    request<{ device: HardwareDeviceRecord }>(`/api/hardware/devices/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteHardwareDevice: (id: number) =>
    request<{ ok: boolean }>(`/api/hardware/devices/${id}`, { method: 'DELETE' }),
  recordHardwareAudit: (
    id: number,
    payload: { eventType: string; transport?: string; status: string; details: string },
  ) =>
    request<{ device: HardwareDeviceRecord }>(`/api/hardware/devices/${id}/audit`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  getPrintJobs: () =>
    request<{ jobs: PrintJobRecord[]; logs: HardwareAuditLogRecord[] }>('/api/hardware/print-jobs'),
  createPrintJob: (payload: {
    jobType: string;
    title: string;
    deviceId?: number | null;
    protocol: string;
    transport: string;
    status?: string;
    copies?: number;
    payloadPreview?: string;
    errorMessage?: string;
    referenceType?: string;
    referenceId?: number | null;
  }) =>
    request<{ job: PrintJobRecord }>('/api/hardware/print-jobs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePrintJob: (id: number, payload: { status: string; errorMessage?: string }) =>
    request<{ job: PrintJobRecord }>(`/api/hardware/print-jobs/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
};

