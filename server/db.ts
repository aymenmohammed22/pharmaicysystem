import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import {
  normalizeScannerInput,
  calculateGs1CheckDigit,
  generateInternalEan13,
  parseGs1Barcode,
  detectBarcodeSymbology,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
} from '../shared/gs1Barcode.ts';

export {
  normalizeScannerInput,
  calculateGs1CheckDigit,
  generateInternalEan13,
  parseGs1Barcode,
  detectBarcodeSymbology,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DATA_DIR = process.env.OMNI_USER_DATA_DIR
  ? path.join(process.env.OMNI_USER_DATA_DIR, 'data')
  : path.join(__dirname, 'data');
export const SQLITE_FILE = path.join(DATA_DIR, 'store.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

// If using external persistent directory (like Electron AppData) and database does not exist yet,
// automatically clone the initial baseline sqlite database if present
if (process.env.OMNI_USER_DATA_DIR && !fs.existsSync(SQLITE_FILE)) {
  const localDefaultSqlite = path.join(__dirname, 'data', 'store.sqlite');
  if (fs.existsSync(localDefaultSqlite)) {
    try {
      fs.copyFileSync(localDefaultSqlite, SQLITE_FILE);
    } catch {
      // Fallback: new database will be auto-migrated and initialized
    }
  }
}

export const sqlite = new DatabaseSync(SQLITE_FILE);
sqlite.exec('PRAGMA journal_mode = WAL;');
sqlite.exec('PRAGMA foreign_keys = ON;');

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

export function normalizeRole(raw: string | undefined): UserRole {
  const valid: UserRole[] = [
    'developer',
    'admin',
    'pharmacy_owner',
    'pharmacy_manager',
    'pharmacist',
    'cashier',
    'storekeeper',
    'accountant',
    'purchasing_officer',
  ];
  return valid.includes(raw as UserRole) ? (raw as UserRole) : 'pharmacist';
}

export function normalizePermissions(
  role: UserRole,
  raw?: Partial<UserPermissions> | string | null,
): UserPermissions {
  const base = { ...DEFAULT_PERMISSIONS_BY_ROLE[role] };
  if (!raw) return base;
  let parsed: Partial<UserPermissions> | null = null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return base;
    try {
      parsed = JSON.parse(trimmed) as Partial<UserPermissions>;
    } catch {
      return base;
    }
  } else {
    parsed = raw;
  }
  if (!parsed || typeof parsed !== 'object') return base;
  const result = { ...base };
  for (const key of Object.keys(base) as PermissionKey[]) {
    if (typeof parsed[key] === 'boolean') {
      result[key] = parsed[key] as boolean;
    }
  }
  return result;
}

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
  logo?: string;
  currencyCode: string;
  currencySymbol: string;
  currencyName: string;
  additionalCurrencies: AdditionalCurrency[];
  autoConvertCurrencies: boolean;
  defaultDisplayCurrency: string;
  ownerName?: string;
  ownerEmail?: string;
  phone?: string;
  address?: string;
  tradeName?: string;
  city?: string;
  country?: string;
  taxNumber?: string;
  licenseNumber?: string;
  notes?: string;
  currencyDecimals?: number;
  salesCurrencyCode?: string;
  purchasesCurrencyCode?: string;
  licenseExpiresAt?: string;
  licenseDaysRemaining?: number | null;
  licenseExpiringSoon?: boolean;
  licenseExpired?: boolean;
}

export interface UserRecord {
  id: number;
  email: string;
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  permissions: UserPermissions;
  pic: string;
  number: string;
  pharmacy_id: number;
  date: string;
}

export interface CategoryRecord {
  id: number;
  name: string;
  pic: string;
  details: string;
  date: string;
}

export interface InventoryRecord {
  id: number;
  catId: number;
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
  isControlled: boolean;
  controlledSchedule: string;
  maxDailyDose: string;
  pregnancyCategory: string;
  status: string;
  barcode: string;
  batchNumber: string;
  expiryDate: string;
  pic: string;
  description: string;
  company: string;
  date: string;
}

export interface SupplierRecord {
  id: number;
  name: string;
  pic: string;
  number: string;
  address: string;
  cnic: string;
  balance: number;
  date: string;
}

export interface BillItem {
  id: number;
  name: string;
  scientificName?: string;
  dosageForm?: string;
  unit: string;
  saleUnit: string;
  unitFactor: number;
  price: number;
  discountPct: number;
  company: string;
  barcode: string;
  batchNumber: string;
  qty: number;
}

export interface SessionData {
  userId: number;
  bill: BillItem[];
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) {
    return password === storedHash;
  }
  const [salt, keyHex] = parts;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function currentTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function futureDateDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function pastDateDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// --- Core & ERP SQLite Schema ---
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS site (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    name TEXT NOT NULL,
    logo TEXT NOT NULL DEFAULT '',
    currency_code TEXT NOT NULL DEFAULT 'SAR',
    currency_symbol TEXT NOT NULL DEFAULT 'ر.س',
    currency_name TEXT NOT NULL DEFAULT 'ريال سعودي'
  );

  CREATE TABLE IF NOT EXISTS pharmacies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    logo TEXT NOT NULL DEFAULT '',
    currency_code TEXT NOT NULL DEFAULT 'SAR',
    currency_symbol TEXT NOT NULL DEFAULT 'ر.س',
    currency_name TEXT NOT NULL DEFAULT 'ريال سعودي',
    owner_name TEXT NOT NULL DEFAULT '',
    owner_username TEXT NOT NULL DEFAULT '',
    owner_email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    owner_user_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'pharmacist',
    is_active INTEGER NOT NULL DEFAULT 1,
    permissions TEXT NOT NULL DEFAULT '',
    pic TEXT NOT NULL DEFAULT 'png.png',
    number TEXT NOT NULL DEFAULT '',
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pic TEXT NOT NULL DEFAULT 'cap.png',
    details TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventeries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    catId INTEGER NOT NULL,
    supplier TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    scientific_name TEXT NOT NULL DEFAULT '',
    active_ingredient TEXT NOT NULL DEFAULT '',
    dosage_form TEXT NOT NULL DEFAULT 'أقراص',
    country_of_origin TEXT NOT NULL DEFAULT '',
    reg_number TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT '',
    pack_unit TEXT NOT NULL DEFAULT 'علبة',
    strip_unit TEXT NOT NULL DEFAULT 'شريط',
    strips_per_pack INTEGER NOT NULL DEFAULT 1,
    strip_price REAL NOT NULL DEFAULT 0,
    piece_unit TEXT NOT NULL DEFAULT 'حبة',
    pieces_per_pack INTEGER NOT NULL DEFAULT 1,
    piece_price REAL NOT NULL DEFAULT 0,
    purchase_price REAL NOT NULL DEFAULT 0,
    price TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    minStock INTEGER NOT NULL DEFAULT 10,
    max_stock INTEGER NOT NULL DEFAULT 500,
    storage_location TEXT NOT NULL DEFAULT 'الرف A-1',
    requires_prescription INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    barcode TEXT NOT NULL,
    batchNumber TEXT NOT NULL DEFAULT '',
    expiryDate TEXT NOT NULL DEFAULT '',
    pic TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    FOREIGN KEY (catId) REFERENCES categories(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'main',
    location TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS medicine_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    supplier_name TEXT NOT NULL DEFAULT '',
    batch_number TEXT NOT NULL,
    production_date TEXT NOT NULL DEFAULT '',
    expiry_date TEXT NOT NULL,
    qty_initial REAL NOT NULL DEFAULT 0,
    qty_remaining REAL NOT NULL DEFAULT 0,
    purchase_price REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (medicine_id) REFERENCES inventeries(id) ON DELETE CASCADE,
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
  );

  CREATE TABLE IF NOT EXISTS supplier (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    pic TEXT NOT NULL DEFAULT 'fk.jpg',
    number TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    cnic TEXT NOT NULL DEFAULT '',
    balance REAL NOT NULL DEFAULT 0,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    credit_limit REAL NOT NULL DEFAULT 5000,
    balance REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL DEFAULT '',
    clinic TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    license_number TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    doctor_id INTEGER,
    prescription_date TEXT NOT NULL,
    reference_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    dispensed_sold_id INTEGER,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
  );

  CREATE TABLE IF NOT EXISTS prescription_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prescription_id INTEGER NOT NULL,
    medicine_id INTEGER,
    medicine_name TEXT NOT NULL,
    dosage TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL DEFAULT '',
    duration TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL DEFAULT 1,
    FOREIGN KEY (prescription_id) REFERENCES prescriptions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pos_shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    opened_at TEXT NOT NULL,
    closed_at TEXT NOT NULL DEFAULT '',
    opening_cash REAL NOT NULL DEFAULT 0,
    cash_sales REAL NOT NULL DEFAULT 0,
    card_sales REAL NOT NULL DEFAULT 0,
    credit_sales REAL NOT NULL DEFAULT 0,
    cash_returns REAL NOT NULL DEFAULT 0,
    expected_cash REAL NOT NULL DEFAULT 0,
    actual_cash REAL,
    variance REAL,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS held_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    customer_name TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL,
    discount REAL NOT NULL DEFAULT 0,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sold (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    discount TEXT NOT NULL DEFAULT '0',
    item TEXT NOT NULL,
    amount TEXT NOT NULL,
    currency_code TEXT NOT NULL DEFAULT 'SAR',
    currency_symbol TEXT NOT NULL DEFAULT 'ر.س',
    payment_method TEXT NOT NULL DEFAULT 'cash',
    paid_amount REAL NOT NULL DEFAULT 0,
    remaining_amount REAL NOT NULL DEFAULT 0,
    customer_id INTEGER,
    prescription_id INTEGER,
    shift_id INTEGER,
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'completed',
    userId INTEGER NOT NULL,
    date TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sold_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    soldId INTEGER NOT NULL,
    medicineId INTEGER NOT NULL,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '',
    sale_unit TEXT NOT NULL DEFAULT 'علبة',
    unit_factor REAL NOT NULL DEFAULT 1,
    company TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    batchNumber TEXT NOT NULL DEFAULT '',
    batch_id INTEGER,
    qty REAL NOT NULL,
    FOREIGN KEY (soldId) REFERENCES sold(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sales_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sold_id INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    refund_amount REAL NOT NULL DEFAULT 0,
    refund_method TEXT NOT NULL DEFAULT 'cash',
    shift_id INTEGER,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (sold_id) REFERENCES sold(id)
  );

  CREATE TABLE IF NOT EXISTS sales_return_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    return_id INTEGER NOT NULL,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    batch_id INTEGER,
    qty REAL NOT NULL,
    unit_factor REAL NOT NULL DEFAULT 1,
    refund_price REAL NOT NULL,
    FOREIGN KEY (return_id) REFERENCES sales_returns(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_id INTEGER NOT NULL,
    supplier_name TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    stage TEXT NOT NULL DEFAULT 'request',
    status TEXT NOT NULL DEFAULT 'pending',
    invoice_number TEXT NOT NULL DEFAULT '',
    subtotal REAL NOT NULL DEFAULT 0,
    discount_amount REAL NOT NULL DEFAULT 0,
    tax_amount REAL NOT NULL DEFAULT 0,
    shipping_cost REAL NOT NULL DEFAULT 0,
    total_amount REAL NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    approved_by INTEGER,
    received_by INTEGER,
    created_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (supplier_id) REFERENCES supplier(id)
  );

  CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    qty REAL NOT NULL,
    purchase_price REAL NOT NULL,
    discount_pct REAL NOT NULL DEFAULT 0,
    landed_unit_cost REAL NOT NULL DEFAULT 0,
    batch_number TEXT NOT NULL DEFAULT '',
    production_date TEXT NOT NULL DEFAULT '',
    expiry_date TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS purchase_returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER,
    supplier_id INTEGER NOT NULL,
    supplier_name TEXT NOT NULL,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    batch_id INTEGER,
    qty REAL NOT NULL,
    unit_cost REAL NOT NULL,
    total_amount REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_warehouse_id INTEGER NOT NULL,
    to_warehouse_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT NOT NULL DEFAULT '',
    requested_by INTEGER NOT NULL,
    approved_by INTEGER,
    received_by INTEGER,
    created_at TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (from_warehouse_id) REFERENCES warehouses(id),
    FOREIGN KEY (to_warehouse_id) REFERENCES warehouses(id)
  );

  CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    batch_id INTEGER,
    batch_number TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stock_counts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id INTEGER NOT NULL,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    batch_id INTEGER,
    system_qty REAL NOT NULL,
    counted_qty REAL NOT NULL,
    variance REAL NOT NULL,
    adjustment_type TEXT NOT NULL DEFAULT 'stocktake',
    reason TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    batch_id INTEGER,
    batch_number TEXT NOT NULL DEFAULT '',
    movement_type TEXT NOT NULL,
    qty_change REAL NOT NULL,
    balance_after REAL NOT NULL,
    reference_type TEXT NOT NULL DEFAULT '',
    reference_id INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    is_system INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS cash_boxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    box_type TEXT NOT NULL DEFAULT 'cash',
    account_id INTEGER NOT NULL,
    balance REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_date TEXT NOT NULL,
    description TEXT NOT NULL,
    reference_type TEXT NOT NULL DEFAULT 'manual',
    reference_id INTEGER,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS journal_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    journal_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,
    debit REAL NOT NULL DEFAULT 0,
    credit REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (journal_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucher_type TEXT NOT NULL,
    cash_box_id INTEGER NOT NULL,
    counterparty_type TEXT NOT NULL DEFAULT '',
    counterparty_id INTEGER,
    counterparty_name TEXT NOT NULL DEFAULT '',
    account_id INTEGER,
    amount REAL NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    voucher_date TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER UNIQUE,
    full_name TEXT NOT NULL,
    job_title TEXT NOT NULL,
    specialty TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    base_salary REAL NOT NULL DEFAULT 0,
    commission_rate REAL NOT NULL DEFAULT 0,
    hire_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS employee_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    check_in TEXT NOT NULL DEFAULT '',
    check_out TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'present',
    notes TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS employee_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    tx_type TEXT NOT NULL,
    amount REAL NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    tx_date TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Clinical Drug-Drug Interactions
  CREATE TABLE IF NOT EXISTS drug_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_a TEXT NOT NULL,
    ingredient_b TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'moderate',
    clinical_effect TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Controlled / Narcotic Medications Dispense Registry
  CREATE TABLE IF NOT EXISTS controlled_dispense_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sold_id INTEGER,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    schedule TEXT NOT NULL DEFAULT '',
    patient_name TEXT NOT NULL,
    patient_national_id TEXT NOT NULL,
    doctor_name TEXT NOT NULL DEFAULT '',
    doctor_license TEXT NOT NULL DEFAULT '',
    prescription_number TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    pharmacist_id INTEGER NOT NULL,
    pharmacist_name TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    dispensed_at TEXT NOT NULL
  );

  -- Insurance Companies & Claims
  CREATE TABLE IF NOT EXISTS insurance_companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    default_coverage_pct REAL NOT NULL DEFAULT 80,
    max_claim_limit REAL NOT NULL DEFAULT 5000,
    balance REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS insurance_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_number TEXT NOT NULL,
    insurance_id INTEGER NOT NULL,
    insurance_name TEXT NOT NULL,
    customer_id INTEGER,
    customer_name TEXT NOT NULL DEFAULT '',
    sold_id INTEGER,
    policy_number TEXT NOT NULL DEFAULT '',
    approval_code TEXT NOT NULL DEFAULT '',
    total_amount REAL NOT NULL DEFAULT 0,
    insurance_share REAL NOT NULL DEFAULT 0,
    patient_copay REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Supply Chain Drug Recalls & Quarantine Traceability
  CREATE TABLE IF NOT EXISTS drug_recalls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recall_number TEXT NOT NULL,
    medicine_id INTEGER NOT NULL,
    medicine_name TEXT NOT NULL,
    batch_id INTEGER,
    batch_number TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'sfda',
    severity TEXT NOT NULL DEFAULT 'class_2',
    reason TEXT NOT NULL,
    affected_qty REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'quarantined',
    initiated_by INTEGER NOT NULL,
    initiated_by_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Pricing Promotions & Customer Loyalty
  CREATE TABLE IF NOT EXISTS promotions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    promo_type TEXT NOT NULL DEFAULT 'percentage',
    scope TEXT NOT NULL DEFAULT 'all',
    target_id INTEGER,
    discount_pct REAL NOT NULL DEFAULT 0,
    min_qty REAL NOT NULL DEFAULT 1,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    points_delta INTEGER NOT NULL,
    tx_type TEXT NOT NULL DEFAULT 'earn',
    reference_sold_id INTEGER,
    notes TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Operating Expenses & Cost Centers
  CREATE TABLE IF NOT EXISTS operating_expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    warehouse_id INTEGER NOT NULL DEFAULT 1,
    amount REAL NOT NULL,
    expense_date TEXT NOT NULL,
    cash_box_id INTEGER NOT NULL DEFAULT 1,
    receipt_ref TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  -- External Hardware & API Integrations Config
  CREATE TABLE IF NOT EXISTS integration_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'hardware',
    enabled INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    last_tested_at TEXT NOT NULL DEFAULT '',
    last_status TEXT NOT NULL DEFAULT 'untested',
    notes TEXT NOT NULL DEFAULT ''
  );

  -- Disaster Recovery Backup Snapshots
  CREATE TABLE IF NOT EXISTS backup_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_type TEXT NOT NULL DEFAULT 'checkpoint',
    file_name TEXT NOT NULL,
    table_count INTEGER NOT NULL DEFAULT 0,
    row_count INTEGER NOT NULL DEFAULT 0,
    checksum_sha256 TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Currency Exchange Rate History (Per Tenant)
  CREATE TABLE IF NOT EXISTS currency_rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    currency_code TEXT NOT NULL,
    currency_symbol TEXT NOT NULL DEFAULT '',
    currency_name TEXT NOT NULL DEFAULT '',
    old_rate REAL NOT NULL DEFAULT 0,
    new_rate REAL NOT NULL DEFAULT 0,
    changed_by INTEGER NOT NULL DEFAULT 0,
    changed_by_name TEXT NOT NULL DEFAULT '',
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- Platform Super Admin Independent Audit Logs
  CREATE TABLE IF NOT EXISTS platform_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_id INTEGER NOT NULL,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'pharmacy',
    target_id INTEGER,
    details TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- Multi-Barcode & Unit/Batch Barcode Mapping
  CREATE TABLE IF NOT EXISTS product_barcodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    batch_id INTEGER,
    barcode TEXT NOT NULL,
    symbology TEXT NOT NULL DEFAULT 'CODE128',
    unit_type TEXT NOT NULL DEFAULT 'pack',
    unit_name TEXT NOT NULL DEFAULT 'علبة',
    unit_factor REAL NOT NULL DEFAULT 1,
    is_primary INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (medicine_id) REFERENCES inventeries(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS barcode_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id INTEGER NOT NULL,
    old_barcode TEXT NOT NULL DEFAULT '',
    new_barcode TEXT NOT NULL DEFAULT '',
    unit_type TEXT NOT NULL DEFAULT 'pack',
    action TEXT NOT NULL DEFAULT 'assign',
    changed_by INTEGER NOT NULL DEFAULT 0,
    changed_by_name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  -- Hardware Devices, Printer/Scanner Profiles, Print Queue & Hardware Audit
  CREATE TABLE IF NOT EXISTS hardware_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_key TEXT NOT NULL,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'thermal_printer',
    connection_type TEXT NOT NULL DEFAULT 'browser_print',
    protocol TEXT NOT NULL DEFAULT 'HTML_CSS',
    host TEXT NOT NULL DEFAULT '',
    port INTEGER NOT NULL DEFAULT 9100,
    baud_rate INTEGER NOT NULL DEFAULT 9600,
    paper_width_mm INTEGER NOT NULL DEFAULT 80,
    label_width_mm INTEGER NOT NULL DEFAULT 50,
    label_height_mm INTEGER NOT NULL DEFAULT 25,
    dpi INTEGER NOT NULL DEFAULT 203,
    is_default INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    settings_json TEXT NOT NULL DEFAULT '{}',
    last_seen_at TEXT NOT NULL DEFAULT '',
    last_status TEXT NOT NULL DEFAULT 'configured',
    terminal_id TEXT NOT NULL DEFAULT 'POS-01',
    branch_id INTEGER NOT NULL DEFAULT 1,
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS print_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL DEFAULT 'invoice_receipt',
    title TEXT NOT NULL,
    device_id INTEGER,
    protocol TEXT NOT NULL DEFAULT 'HTML_CSS',
    transport TEXT NOT NULL DEFAULT 'browser_print',
    status TEXT NOT NULL DEFAULT 'queued',
    copies INTEGER NOT NULL DEFAULT 1,
    payload_preview TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    reference_type TEXT NOT NULL DEFAULT '',
    reference_id INTEGER,
    created_by INTEGER NOT NULL DEFAULT 0,
    created_by_name TEXT NOT NULL DEFAULT '',
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS hardware_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER,
    device_name TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    transport TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ok',
    details TEXT NOT NULL DEFAULT '',
    user_id INTEGER NOT NULL DEFAULT 0,
    user_name TEXT NOT NULL DEFAULT '',
    pharmacy_id INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
`);

function getColumnNames(tableName: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function addColIfMissing(table: string, cols: Set<string>, name: string, defSql: string): void {
  if (!cols.has(name)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${defSql}`);
  }
}

function migrateExistingSchema(): void {
  const siteCols = getColumnNames('site');
  addColIfMissing('site', siteCols, 'currency_code', "TEXT NOT NULL DEFAULT 'SAR'");
  addColIfMissing('site', siteCols, 'currency_symbol', "TEXT NOT NULL DEFAULT 'ر.س'");
  addColIfMissing('site', siteCols, 'currency_name', "TEXT NOT NULL DEFAULT 'ريال سعودي'");
  addColIfMissing('site', siteCols, 'logo', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('site', siteCols, 'additional_currencies', "TEXT NOT NULL DEFAULT '[]'");
  addColIfMissing('site', siteCols, 'auto_convert_currencies', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('site', siteCols, 'default_display_currency', "TEXT NOT NULL DEFAULT ''");

  const userCols = getColumnNames('users');
  addColIfMissing('users', userCols, 'username', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('users', userCols, 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('users', userCols, 'permissions', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('users', userCols, 'pharmacy_id', 'INTEGER NOT NULL DEFAULT 1');

  sqlite.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users(lower(username)) WHERE username != '';",
  );

  // Backfill empty usernames from email local-part or name
  const usersWithoutUsername = sqlite
    .prepare("SELECT id, email, name FROM users WHERE username = '' OR username IS NULL")
    .all() as Array<{ id: number; email: string; name: string }>;
  const updateUsernameStmt = sqlite.prepare('UPDATE users SET username = ? WHERE id = ?');
  for (const u of usersWithoutUsername) {
    const emailPrefix = String(u.email || '').split('@')[0] || '';
    const candidate = generateUniqueUsername(emailPrefix || u.name || `user${u.id}`, u.id);
    updateUsernameStmt.run(candidate, u.id);
  }

  const invCols = getColumnNames('inventeries');
  addColIfMissing('inventeries', invCols, 'scientific_name', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'active_ingredient', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'dosage_form', "TEXT NOT NULL DEFAULT 'أقراص'");
  addColIfMissing('inventeries', invCols, 'country_of_origin', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'reg_number', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'pack_unit', "TEXT NOT NULL DEFAULT 'علبة'");
  addColIfMissing('inventeries', invCols, 'strip_unit', "TEXT NOT NULL DEFAULT 'شريط'");
  addColIfMissing('inventeries', invCols, 'strips_per_pack', 'INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('inventeries', invCols, 'strip_price', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('inventeries', invCols, 'piece_unit', "TEXT NOT NULL DEFAULT 'حبة'");
  addColIfMissing('inventeries', invCols, 'pieces_per_pack', 'INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('inventeries', invCols, 'piece_price', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('inventeries', invCols, 'purchase_price', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('inventeries', invCols, 'max_stock', 'INTEGER NOT NULL DEFAULT 500');
  addColIfMissing('inventeries', invCols, 'storage_location', "TEXT NOT NULL DEFAULT 'الرف A-1'");
  addColIfMissing('inventeries', invCols, 'requires_prescription', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('inventeries', invCols, 'is_controlled', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('inventeries', invCols, 'controlled_schedule', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'max_daily_dose', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'pregnancy_category', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('inventeries', invCols, 'status', "TEXT NOT NULL DEFAULT 'active'");

  const whCols = getColumnNames('warehouses');
  addColIfMissing('warehouses', whCols, 'code', "TEXT NOT NULL DEFAULT 'BR-01'");
  addColIfMissing('warehouses', whCols, 'manager_name', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('warehouses', whCols, 'phone', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('warehouses', whCols, 'is_branch_pos', 'INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('warehouses', whCols, 'target_daily_sales', 'REAL NOT NULL DEFAULT 3000');

  const custCols = getColumnNames('customers');
  addColIfMissing('customers', custCols, 'allergies', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('customers', custCols, 'chronic_conditions', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('customers', custCols, 'loyalty_points', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('customers', custCols, 'loyalty_tier', "TEXT NOT NULL DEFAULT 'عادي'");
  addColIfMissing('customers', custCols, 'insurance_id', 'INTEGER');
  addColIfMissing('customers', custCols, 'policy_number', "TEXT NOT NULL DEFAULT ''");

  const rxCols = getColumnNames('prescriptions');
  addColIfMissing('prescriptions', rxCols, 'rx_type', "TEXT NOT NULL DEFAULT 'standard'");
  addColIfMissing('prescriptions', rxCols, 'refills_allowed', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('prescriptions', rxCols, 'refills_used', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('prescriptions', rxCols, 'insurance_id', 'INTEGER');
  addColIfMissing('prescriptions', rxCols, 'policy_number', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('prescriptions', rxCols, 'approval_code', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('prescriptions', rxCols, 'valid_until', "TEXT NOT NULL DEFAULT ''");

  const supCols = getColumnNames('supplier');
  addColIfMissing('supplier', supCols, 'balance', 'REAL NOT NULL DEFAULT 0');

  const soldCols = getColumnNames('sold');
  addColIfMissing('sold', soldCols, 'currency_code', "TEXT NOT NULL DEFAULT 'SAR'");
  addColIfMissing('sold', soldCols, 'currency_symbol', "TEXT NOT NULL DEFAULT 'ر.س'");
  addColIfMissing('sold', soldCols, 'exchange_rate', 'REAL NOT NULL DEFAULT 1');
  addColIfMissing('sold', soldCols, 'base_amount', 'REAL');
  addColIfMissing('sold', soldCols, 'payment_method', "TEXT NOT NULL DEFAULT 'cash'");
  addColIfMissing('sold', soldCols, 'paid_amount', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'remaining_amount', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'customer_id', 'INTEGER');
  addColIfMissing('sold', soldCols, 'prescription_id', 'INTEGER');
  addColIfMissing('sold', soldCols, 'shift_id', 'INTEGER');
  addColIfMissing('sold', soldCols, 'warehouse_id', 'INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('sold', soldCols, 'status', "TEXT NOT NULL DEFAULT 'completed'");
  addColIfMissing('sold', soldCols, 'insurance_id', 'INTEGER');
  addColIfMissing('sold', soldCols, 'insurance_claim_id', 'INTEGER');
  addColIfMissing('sold', soldCols, 'insurance_share', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'patient_copay', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'loyalty_points_earned', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'loyalty_points_redeemed', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'loyalty_discount', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sold', soldCols, 'promo_discount', 'REAL NOT NULL DEFAULT 0');

  const soldItemCols = getColumnNames('sold_items');
  addColIfMissing('sold_items', soldItemCols, 'discount_pct', 'REAL NOT NULL DEFAULT 0');
  addColIfMissing('sold_items', soldItemCols, 'sale_unit', "TEXT NOT NULL DEFAULT 'علبة'");
  addColIfMissing('sold_items', soldItemCols, 'unit_factor', 'REAL NOT NULL DEFAULT 1');
  addColIfMissing('sold_items', soldItemCols, 'batch_id', 'INTEGER');

  // Migrate pharmacies table columns
  const pharmCols = getColumnNames('pharmacies');
  addColIfMissing('pharmacies', pharmCols, 'title', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'code', "TEXT NOT NULL DEFAULT 'PHARM-01'");
  addColIfMissing('pharmacies', pharmCols, 'logo', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'currency_code', "TEXT NOT NULL DEFAULT 'SAR'");
  addColIfMissing('pharmacies', pharmCols, 'currency_symbol', "TEXT NOT NULL DEFAULT 'ر.س'");
  addColIfMissing('pharmacies', pharmCols, 'currency_name', "TEXT NOT NULL DEFAULT 'ريال سعودي'");
  addColIfMissing('pharmacies', pharmCols, 'additional_currencies', "TEXT NOT NULL DEFAULT '[]'");
  addColIfMissing('pharmacies', pharmCols, 'auto_convert_currencies', 'INTEGER NOT NULL DEFAULT 0');
  addColIfMissing('pharmacies', pharmCols, 'default_display_currency', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'owner_name', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'owner_username', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'owner_email', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'phone', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'address', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'tax_number', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'license_number', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'trade_name', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'city', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'country', "TEXT NOT NULL DEFAULT 'السعودية'");
  addColIfMissing('pharmacies', pharmCols, 'currency_decimals', 'INTEGER NOT NULL DEFAULT 2');
  addColIfMissing('pharmacies', pharmCols, 'sales_currency_code', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'purchases_currency_code', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'subscription_start', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'subscription_months', 'INTEGER NOT NULL DEFAULT 12');
  addColIfMissing('pharmacies', pharmCols, 'license_expires_at', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'last_login_at', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  addColIfMissing('pharmacies', pharmCols, 'notes', "TEXT NOT NULL DEFAULT ''");
  addColIfMissing('pharmacies', pharmCols, 'owner_user_id', 'INTEGER');

  // Add pharmacy_id to all business & ERP data tables
  const tablesToScope = [
    'inventeries',
    'categories',
    'warehouses',
    'supplier',
    'customers',
    'doctors',
    'prescriptions',
    'pos_shifts',
    'held_bills',
    'sold',
    'sales_returns',
    'purchase_orders',
    'purchase_returns',
    'stock_transfers',
    'stock_counts',
    'stock_movements',
    'accounts',
    'cash_boxes',
    'journal_entries',
    'vouchers',
    'employees',
    'audit_logs',
    'operating_expenses',
    'promotions',
    'insurance_companies',
    'insurance_claims',
    'drug_interactions',
    'drug_recalls',
    'controlled_dispense_logs',
    'backup_snapshots',
  ];
  for (const tbl of tablesToScope) {
    try {
      const cols = getColumnNames(tbl);
      addColIfMissing(tbl, cols, 'pharmacy_id', 'INTEGER NOT NULL DEFAULT 1');
    } catch {
      // Table might not exist yet if called early
    }
  }

  // Migrate integration_configs from global UNIQUE(integration_key) to per-tenant (pharmacy_id, integration_key)
  try {
    const intgCols = getColumnNames('integration_configs');
    if (!intgCols.has('pharmacy_id')) {
      sqlite.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN IMMEDIATE;
        CREATE TABLE integration_configs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          integration_key TEXT NOT NULL,
          display_name TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'hardware',
          enabled INTEGER NOT NULL DEFAULT 0,
          config_json TEXT NOT NULL DEFAULT '{}',
          last_tested_at TEXT NOT NULL DEFAULT '',
          last_status TEXT NOT NULL DEFAULT 'untested',
          notes TEXT NOT NULL DEFAULT '',
          pharmacy_id INTEGER NOT NULL DEFAULT 1,
          UNIQUE(pharmacy_id, integration_key)
        );
        INSERT INTO integration_configs_new
          (id, integration_key, display_name, category, enabled, config_json, last_tested_at, last_status, notes, pharmacy_id)
        SELECT id, integration_key, display_name, category, enabled, config_json, last_tested_at, last_status, notes, 1
        FROM integration_configs;
        DROP TABLE integration_configs;
        ALTER TABLE integration_configs_new RENAME TO integration_configs;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    }
  } catch {
    try {
      sqlite.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
    } catch {
      // ignore
    }
  }

  // Performance & Foreign-Key Secondary Indexes
  sqlite.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inventeries_pharmacy_barcode ON inventeries(pharmacy_id, barcode);
    CREATE INDEX IF NOT EXISTS idx_inventeries_pharmacy_cat ON inventeries(pharmacy_id, catId);
    CREATE INDEX IF NOT EXISTS idx_batches_med_wh_status_exp ON medicine_batches(medicine_id, warehouse_id, status, expiry_date);
    CREATE INDEX IF NOT EXISTS idx_sold_pharmacy_date_status ON sold(pharmacy_id, date, status);
    CREATE INDEX IF NOT EXISTS idx_sold_items_sold_med ON sold_items(soldId, medicineId);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_pharm_med_date ON stock_movements(pharmacy_id, medicine_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_journal_entries_pharm_date ON journal_entries(pharmacy_id, entry_date);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_journal_acc ON journal_lines(journal_id, account_id);
    CREATE INDEX IF NOT EXISTS idx_customers_pharmacy ON customers(pharmacy_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_pharmacy ON supplier(pharmacy_id);
    CREATE INDEX IF NOT EXISTS idx_prescriptions_pharm_cust ON prescriptions(pharmacy_id, customer_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_orders_pharm_sup ON purchase_orders(pharmacy_id, supplier_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_pharm_date ON audit_logs(pharmacy_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_stock_transfers_pharm ON stock_transfers(pharmacy_id, status);
    CREATE INDEX IF NOT EXISTS idx_drug_interactions_pharm ON drug_interactions(pharmacy_id);
    CREATE INDEX IF NOT EXISTS idx_integration_configs_pharm ON integration_configs(pharmacy_id);
    CREATE INDEX IF NOT EXISTS idx_product_barcodes_pharm_code ON product_barcodes(pharmacy_id, barcode, is_active);
    CREATE INDEX IF NOT EXISTS idx_product_barcodes_med ON product_barcodes(medicine_id);
    CREATE INDEX IF NOT EXISTS idx_barcode_history_med ON barcode_history(pharmacy_id, medicine_id);
    CREATE INDEX IF NOT EXISTS idx_hardware_devices_pharm ON hardware_devices(pharmacy_id, device_type);
    CREATE INDEX IF NOT EXISTS idx_print_jobs_pharm_status ON print_jobs(pharmacy_id, status, id);
  `);

  // Backfill primary barcodes into product_barcodes if missing
  try {
    const medsMissingPb = sqlite
      .prepare(
        `SELECT i.id, i.barcode, i.pack_unit, i.pharmacy_id, i.date
         FROM inventeries i
         WHERE i.barcode != ''
           AND NOT EXISTS (
             SELECT 1 FROM product_barcodes pb
             WHERE pb.medicine_id = i.id AND pb.barcode = i.barcode AND pb.pharmacy_id = i.pharmacy_id
           )`,
      )
      .all() as Array<{ id: number; barcode: string; pack_unit: string; pharmacy_id: number; date: string }>;
    if (medsMissingPb.length > 0) {
      const insPb = sqlite.prepare(
        `INSERT INTO product_barcodes
          (medicine_id, batch_id, barcode, symbology, unit_type, unit_name, unit_factor, is_primary, is_active, notes, pharmacy_id, created_at)
         VALUES (?, NULL, ?, ?, 'pack', ?, 1, 1, 1, 'الباركود الرئيسي للدواء', ?, ?)`,
      );
      for (const m of medsMissingPb) {
        insPb.run(
          m.id,
          m.barcode,
          detectBarcodeSymbology(m.barcode),
          m.pack_unit || 'علبة',
          m.pharmacy_id || 1,
          m.date || currentTimestamp(),
        );
      }
    }
  } catch {
    // ignore backfill error during early init
  }

  // Ensure default Pharmacy #1 is seeded
  const p1 = sqlite.prepare('SELECT id FROM pharmacies WHERE id = 1').get();
  if (!p1) {
    const siteInfo = sqlite
      .prepare('SELECT title, name, logo, currency_code, currency_symbol, currency_name FROM site WHERE id = 1')
      .get() as Record<string, unknown> | undefined;
    sqlite
      .prepare(
        `INSERT INTO pharmacies
          (id, name, code, logo, currency_code, currency_symbol, currency_name, owner_name, owner_username, owner_email, phone, address, is_active, notes, created_at)
         VALUES (1, ?, 'PHARM-01', ?, ?, ?, ?, 'صيدلاني (المدير العام)', 'admin1', 'admin1@gmail.com', '2548574/845485', 'المقر الرئيسي', 1, 'الصيدلية التأسيسية المرجعية', ?)`,
      )
      .run(
        String(siteInfo?.name || 'صيدلية الشفاء'),
        String(siteInfo?.logo || ''),
        String(siteInfo?.currency_code || 'SAR'),
        String(siteInfo?.currency_symbol || 'ر.س'),
        String(siteInfo?.currency_name || 'ريال سعودي'),
        currentTimestamp(),
      );
  }

  // Ensure Developer Master Account is seeded
  const devUser = sqlite
    .prepare("SELECT id FROM users WHERE username = 'developer' OR email = 'developer@itqan.soft'")
    .get();
  if (!devUser) {
    sqlite
      .prepare(
        `INSERT INTO users (email, username, password_hash, name, role, is_active, permissions, pic, number, pharmacy_id, date)
         VALUES (?, ?, ?, ?, 'developer', 1, ?, 'png.png', '0500000000', 1, ?)`,
      )
      .run(
        'developer@itqan.soft',
        'developer',
        hashPassword('developer123'),
        'م. أيمن (مطور ومالك النظام)',
        JSON.stringify(DEFAULT_PERMISSIONS_BY_ROLE.developer),
        currentTimestamp(),
      );
  }
}

migrateExistingSchema();

function seedErpModulesIfEmpty(): void {
  sqlite.exec('BEGIN IMMEDIATE');
  try {
    // Warehouses
    const whCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM warehouses').get() as { cnt: number }).cnt;
    if (whCnt === 0) {
      const insWh = sqlite.prepare(
        'INSERT INTO warehouses (id, name, type, location, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      insWh.run(1, 'المستودع الرئيسي (الصالة)', 'main', 'المقر الرئيسي - الدور الأرضي', 1, currentTimestamp());
      insWh.run(2, 'المستودع الاحتياطي / الثلاجة', 'branch', 'الطابق العلوي - تبريد مركزي', 1, currentTimestamp());
    }

    // Backfill batches for any medicine that has no batch rows yet
    const medsWithoutBatches = sqlite
      .prepare(
        `SELECT i.* FROM inventeries i
         WHERE NOT EXISTS (SELECT 1 FROM medicine_batches b WHERE b.medicine_id = i.id)`,
      )
      .all() as Array<Record<string, unknown>>;
    const insBatch = sqlite.prepare(
      `INSERT INTO medicine_batches
        (medicine_id, warehouse_id, supplier_name, batch_number, production_date, expiry_date, qty_initial, qty_remaining, purchase_price, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'تشغيلة أساسية', ?)`,
    );
    for (const m of medsWithoutBatches) {
      const qty = Number(m.quantity) || 0;
      const sellP = Number(m.price) || 0;
      const purchP = Number(m.purchase_price) || Number((sellP * 0.7).toFixed(2));
      const exp = String(m.expiryDate || '') || futureDateDays(365);
      const batchNo = String(m.batchNumber || '') || `B-2026-${m.id}`;
      insBatch.run(
        Number(m.id),
        1,
        String(m.supplier || ''),
        batchNo,
        pastDateDays(60),
        exp,
        qty,
        qty,
        purchP,
        currentTimestamp(),
      );
      // Set realistic pharma defaults for seeded drugs if missing
      sqlite
        .prepare('UPDATE inventeries SET purchase_price = ? WHERE id = ? AND purchase_price = 0')
        .run(purchP, Number(m.id));
    }

    // Seed Accounts & Cash Boxes if empty
    const accCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM accounts').get() as { cnt: number }).cnt;
    if (accCnt === 0) {
      const insAcc = sqlite.prepare(
        'INSERT INTO accounts (id, code, name, account_type, balance, is_system) VALUES (?, ?, ?, ?, ?, 1)',
      );
      insAcc.run(101, '1010', 'الصندوق الرئيسي', 'asset', 25000);
      insAcc.run(102, '1020', 'الحساب البنكي (نقاط البيع)', 'asset', 40000);
      insAcc.run(103, '1030', 'المخزون الدوائي', 'asset', 0);
      insAcc.run(104, '1040', 'ذمم العملاء (الآجل)', 'asset', 0);
      insAcc.run(201, '2010', 'ذمم الموردين', 'liability', 0);
      insAcc.run(202, '2020', 'ضرائب ورسوم مستحقة', 'liability', 0);
      insAcc.run(301, '3010', 'رأس المال', 'equity', 65000);
      insAcc.run(401, '4010', 'إيرادات المبيعات', 'revenue', 0);
      insAcc.run(402, '4020', 'إيرادات أخرى', 'revenue', 0);
      insAcc.run(501, '5010', 'تكلفة المبيعات والمشتريات', 'expense', 0);
      insAcc.run(502, '5020', 'مصروفات تشغيلية وإدارية', 'expense', 0);
      insAcc.run(503, '5030', 'الرواتب والأجور والمكافآت', 'expense', 0);
      insAcc.run(504, '5040', 'خسائر التالف ومنتهي الصلاحية', 'expense', 0);

      sqlite
        .prepare('INSERT INTO cash_boxes (id, name, box_type, account_id, balance) VALUES (?, ?, ?, ?, ?)')
        .run(1, 'الصندوق النقدي الرئيسي', 'cash', 101, 25000);
      sqlite
        .prepare('INSERT INTO cash_boxes (id, name, box_type, account_id, balance) VALUES (?, ?, ?, ?, ?)')
        .run(2, 'حساب البنك / شبكة مدى', 'bank', 102, 40000);
    }

    // Seed sample Customers & Doctors if empty
    const custCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM customers').get() as { cnt: number }).cnt;
    if (custCnt === 0) {
      const insCust = sqlite.prepare(
        'INSERT INTO customers (id, name, phone, address, credit_limit, balance, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      insCust.run(1, 'عميل نقدي عام', '0500000000', 'العملاء المباشرين', 0, 0, 'حساب البيع النقدي السريع', currentTimestamp());
      insCust.run(2, 'أحمد العتيبي', '0551234567', 'حي الروضة', 2000, 0, 'عميل منتظم', currentTimestamp());
      insCust.run(3, 'شركة الرعاية الطبية (آجل)', '0509876543', 'الحي التجاري', 10000, 0, 'تعاقد آجل شهري', currentTimestamp());
    }

    const docCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM doctors').get() as { cnt: number }).cnt;
    if (docCnt === 0) {
      const insDoc = sqlite.prepare(
        'INSERT INTO doctors (id, name, specialty, clinic, phone, license_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      insDoc.run(1, 'د. عبدالله السالم', 'طب عام وباطنية', 'عيادات الشفاء التخصصية', '0541112233', 'DOC-4481', currentTimestamp());
      insDoc.run(2, 'د. نورة القحطاني', 'طب أطفال', 'مركز الرحمة الطبي', '0544445566', 'DOC-5190', currentTimestamp());
    }

    // Sync employees from existing users if empty
    const empCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM employees').get() as { cnt: number }).cnt;
    if (empCnt === 0) {
      const allUsers = sqlite.prepare('SELECT id, name, role, number, date FROM users').all() as Array<{
        id: number;
        name: string;
        role: string;
        number: string;
        date: string;
      }>;
      const insEmp = sqlite.prepare(
        'INSERT INTO employees (user_id, full_name, job_title, specialty, phone, base_salary, commission_rate, hire_date, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      );
      const roleTitles: Record<string, string> = {
        admin: 'المدير العام',
        pharmacy_manager: 'مدير الصيدلية',
        pharmacist: 'صيدلاني مرخص',
        cashier: 'كاشير نقطة البيع',
        storekeeper: 'أمين المستودع',
        accountant: 'محاسب مالي',
        purchasing_officer: 'مسؤول المشتريات',
      };
      for (const u of allUsers) {
        insEmp.run(
          u.id,
          u.name,
          roleTitles[u.role] || 'موظف صيدلية',
          'إدارة وصرف دوائي',
          u.number || '',
          u.role === 'admin' ? 8500 : u.role === 'pharmacist' ? 6000 : 4000,
          u.role === 'cashier' || u.role === 'pharmacist' ? 1.5 : 0,
          String(u.date || currentTimestamp()).slice(0, 10),
        );
      }
    }

    // Ensure Insurance Receivables account (105 / 1050) exists
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO accounts (id, code, name, account_type, balance, is_system) VALUES (105, '1050', 'ذمم شركات التأمين', 'asset', 0, 1)",
      )
      .run();

    // Update branch codes on default warehouses if missing
    sqlite
      .prepare("UPDATE warehouses SET code = 'BR-01', is_branch_pos = 1 WHERE id = 1 AND (code = '' OR code = 'BR-01')")
      .run();
    sqlite
      .prepare("UPDATE warehouses SET code = 'BR-02', is_branch_pos = 1 WHERE id = 2 AND code = 'BR-01'")
      .run();

    // Seed clinical drug interactions if empty
    const interCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM drug_interactions').get() as { cnt: number }).cnt;
    if (interCnt === 0) {
      const insInt = sqlite.prepare(
        'INSERT INTO drug_interactions (ingredient_a, ingredient_b, severity, clinical_effect, recommendation, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      );
      const now = currentTimestamp();
      insInt.run('Amoxicillin', 'Methotrexate', 'major', 'يرفع تركيز الميثوتريكسات وقد يزيد خطر السمية', 'مراجعة الطبيب ومراقبة وظائف الكلى وصورة الدم', now);
      insInt.run('Acetaminophen', 'Warfarin', 'moderate', 'الاستعمال المطول بجرعات عالية قد يرفع سيولة الدم INR', 'الالتزام بالجرعة المقررة ومراقبة فحص السيولة', now);
      insInt.run('Dextromethorphan', 'Sertraline', 'major', 'خطر متلازمة السيروتونين عند التزامن مع مثبطات SSRI/MAOI', 'تجنب التزامن واستشارة الصيدلي/الطبيب لبديل آمن', now);
      insInt.run('Ibuprofen', 'Aspirin', 'moderate', 'يقلل التأثير القلبي الوقائي للأسبرين ويزيد خطر نزيف المعدة', 'الفصل الزمني أو استبدال المسكن تحت إشراف مختص', now);
      insInt.run('Ciprofloxacin', 'Calcium', 'moderate', 'تداخل امتصاص يقلل فعالية المضاد الحيوي بنسبة كبيرة', 'الفصل بينهما بساعتين على الأقل قبل أو بعد الجرعة', now);
      insInt.run('Omeprazole', 'Clopidogrel', 'major', 'يقلل تنشيط الكلوبيدوجريل ويضعف الوقاية من التجلط', 'يفضل استبدال مثبط المضخة ببديل أقل تداخلاً مثل Pantoprazole', now);
    }

    // Seed insurance companies if empty
    const insCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM insurance_companies').get() as { cnt: number }).cnt;
    if (insCnt === 0) {
      const insComp = sqlite.prepare(
        'INSERT INTO insurance_companies (id, name, code, contact_phone, default_coverage_pct, max_claim_limit, balance, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)',
      );
      insComp.run(1, 'بوبا العربية للتأمين الصحي', 'BUPA-SA', '920000456', 80, 10000, currentTimestamp());
      insComp.run(2, 'التعاونية للتأمين الطبي', 'TAWUNIYA', '920019990', 75, 8000, currentTimestamp());
    }

    // Seed active promotion if empty
    const promoCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM promotions').get() as { cnt: number }).cnt;
    if (promoCnt === 0) {
      sqlite
        .prepare(
          'INSERT INTO promotions (name, promo_type, scope, target_id, discount_pct, min_qty, start_date, end_date, is_active, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
        )
        .run(
          'عرض المسكنات والعناية اليومية 10%',
          'percentage',
          'category',
          25,
          10,
          2,
          pastDateDays(30),
          futureDateDays(180),
          'خصم 10% تلقائي عند شراء عبوتين أو أكثر من قسم مسكنات الألم',
          currentTimestamp(),
        );
    }

    // Seed integration configs for Pharmacy #1 if empty
    const intgCnt = (sqlite.prepare('SELECT COUNT(*) AS cnt FROM integration_configs WHERE pharmacy_id = 1').get() as { cnt: number }).cnt;
    if (intgCnt === 0) {
      const insIntg = sqlite.prepare(
        'INSERT OR IGNORE INTO integration_configs (integration_key, display_name, category, enabled, config_json, last_tested_at, last_status, notes, pharmacy_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
      );
      insIntg.run('barcode_scanner', 'قارئ الباركود الليزري (HID / USB)', 'hardware', 1, JSON.stringify({ mode: 'keyboard_wedge', prefix: '', suffix: 'Enter' }), '', 'ready', 'جاهز للمسح التلقائي في نقطة البيع والمخزون');
      insIntg.run('thermal_printer', 'طابعة الإيصالات الحرارية 80mm (ESC/POS)', 'hardware', 1, JSON.stringify({ paperWidth: '80mm', autoOpenCashDrawer: true }), '', 'ready', 'متوافقة مع معاينة الإيصال الحراري 80mm');
      insIntg.run('label_printer', 'طابعة ملصقات الباركود Code128', 'hardware', 1, JSON.stringify({ labelWidthMm: 50, labelHeightMm: 25, columns: 3 }), '', 'ready', 'لطباعة ملصقات الرفوف والأصناف من المخزون');
      insIntg.run('zatca_qr', 'الفوترة الإلكترونية ورمز QR الضريبي (ZATCA TLV)', 'compliance', 1, JSON.stringify({ sellerName: 'صيدلية الشفاء - إتقان سوفت', vatNumber: '310123456700003', vatRatePct: 0 }), '', 'ready', 'توليد رمز QR TLV مشفر في الفواتير');
      insIntg.run('insurance_api', 'بوابة ربط المطالبات التأمينية (NPHIES / API)', 'external_api', 0, JSON.stringify({ endpointUrl: 'https://api.insurance-gateway.local/v1', providerCode: 'ITQAN-PHARM-01' }), '', 'configured', 'تصدير واستعلام موافقات التأمين');
    }

    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }
}

function seedIfEmpty(): void {
  const siteRow = sqlite.prepare('SELECT COUNT(*) AS cnt FROM site').get() as { cnt: number };
  if (siteRow.cnt > 0) {
    seedErpModulesIfEmpty();
    return;
  }

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    sqlite
      .prepare(
        'INSERT INTO site (id, title, name, currency_code, currency_symbol, currency_name) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(1, 'نظام ادارة الصيدلية', 'صيدلية الشفاء', 'SAR', 'ر.س', 'ريال سعودي');

    const insertUser = sqlite.prepare(
      'INSERT INTO users (id, email, username, password_hash, name, role, is_active, permissions, pic, number, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertUser.run(
      2,
      'admin1@gmail.com',
      'admin1',
      hashPassword('admin'),
      'صيدلاني (المدير العام)',
      'admin',
      1,
      JSON.stringify(DEFAULT_PERMISSIONS_BY_ROLE.admin),
      'png.png',
      '2548574/845485',
      '2021-12-19 08:45:10',
    );
    insertUser.run(
      3,
      'motasim@gmail.com',
      'motasim',
      hashPassword('admin'),
      'محمد (صيدلي)',
      'pharmacist',
      1,
      JSON.stringify(DEFAULT_PERMISSIONS_BY_ROLE.pharmacist),
      'pngwing.png',
      '4748475748',
      '2021-12-19 08:52:00',
    );
    insertUser.run(
      4,
      'cashier@gmail.com',
      'cashier',
      hashPassword('admin'),
      'سالم (كاشير)',
      'cashier',
      1,
      JSON.stringify(DEFAULT_PERMISSIONS_BY_ROLE.cashier),
      'png.png',
      '07701234567',
      '2021-12-19 09:10:00',
    );

    const insertCat = sqlite.prepare(
      'INSERT INTO categories (id, name, pic, details, date) VALUES (?, ?, ?, ?, ?)',
    );
    const seedCats: Array<[number, string, string, string, string]> = [
      [21, 'شراب', 'دواء-كحة-يسبب-النعاس-وأنواعهم.jpg', '', '2021-12-18 09:03:34'],
      [22, 'ابر', 'wbbhk4rvqrp64kscapd56zkh5vify1ep.jpg', '', '2021-12-18 09:04:09'],
      [23, 'كبسول', 'fk.jpg', '', '2021-12-18 09:04:45'],
      [24, 'كبسول عملي', 'login.jpg', '', '2021-12-18 09:05:07'],
      [25, 'مسكنات الالم', 'cap.png', '', '2021-12-18 09:05:31'],
      [26, 'حبوب ', 'what-a-treatment-for-migraine-headache.jpg', '', '2021-12-18 09:05:59'],
      [27, 'علاج تجميل', '5-free-skin-saving-products-you-can-totally-find-home.jpg', '', '2021-12-18 09:06:16'],
      [28, 'علاج الامراض المزمنة', '207136_4_1621846280.jpg', '', '2021-12-18 09:06:55'],
      [29, 'علاجات اخرى /منوعة', 'أسرع_علاج_للأنيميا.jpg', '', '2021-12-18 09:07:11'],
      [30, 'كريم', 'lotion.png', '', '2021-12-18 09:08:15'],
      [31, 'ادوية خاصة', 'tablet.png', '', '2021-12-18 09:08:33'],
      [32, 'مرهم حروق', 'cream.png', '', '2021-12-18 09:08:48'],
    ];
    for (const c of seedCats) insertCat.run(...c);

    const insertInv = sqlite.prepare(
      `INSERT INTO inventeries
        (id, catId, supplier, name, scientific_name, active_ingredient, dosage_form, country_of_origin, reg_number, unit, pack_unit, strip_unit, strips_per_pack, strip_price, piece_unit, pieces_per_pack, piece_price, purchase_price, price, quantity, minStock, max_stock, storage_location, requires_prescription, status, barcode, batchNumber, expiryDate, pic, description, company, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insertInv.run(
      25, 21, 'GTF8', 'شراب مهدئ للسعال', 'Dextromethorphan Syrup', 'Dextromethorphan HBr', 'شراب',
      'الإمارات', 'REG-1025', '120ml', 'عبوة', 'عبوة', 1, 10, 'عبوة', 1, 10, 7, '10',
      45, 10, 200, 'الرف B-2', 0, 'active', '6281001000251', 'B-2026-01', futureDateDays(365),
      'syrup.png', 'شراب فعال لتخفيف السعال وتهدئة الحلق', 'techcode', '2021-12-18 16:24:57',
    );
    insertInv.run(
      26, 23, 'GTF', 'مضاد حيوي واسع الطيف', 'Amoxicillin / Clavulanate', 'Amoxicillin 500mg', 'كبسولات',
      'الأردن', 'REG-2041', '500mg', 'علبة', 'شريط', 2, 8, 'كبسولة', 20, 0.85, 10.5, '15',
      7, 10, 150, 'الرف A-1', 1, 'active', '6281001000268', 'B-2026-02', futureDateDays(22),
      'cap.png', 'كبسولات لعلاج الالتهابات البكتيرية - يصرف بوصفة طبية', 'techcode', '2021-12-18 16:29:36',
    );
    insertInv.run(
      27, 25, 'GTF8', 'مسكن ألم وخافض حرارة', 'Paracetamol', 'Acetaminophen 500mg', 'أقراص',
      'السعودية', 'REG-3099', '500mg', 'علبة', 'شريط', 2, 2.75, 'قرص', 20, 0.3, 3.5, '5',
      120, 15, 400, 'الرف C-4', 0, 'active', '6281001000275', 'B-2026-03', futureDateDays(540),
      'tablet.png', 'أقراص مسكنة للألم وخافضة للحرارة', 'techcode24', '2021-12-18 16:31:48',
    );

    const insertSup = sqlite.prepare(
      'INSERT INTO supplier (id, name, pic, number, address, cnic, balance, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSup.run(1, 'faisal khan', 'fk.jpg', '2432342342', 'adfasdfasfdasdf', '2342342342423423', 0, '2017-11-03 07:23:49');
    insertSup.run(2, 'GTF8', 'fk.jpg', '2432342342', 'المنطقة الصناعية الطبية', '2342342342423423', 0, '2017-11-03 07:23:53');
    insertSup.run(3, 'GTF', 'fk.jpg', '2432342342', 'شارع الصيدليات المركزي', '2342342342423423', 0, '2017-11-03 07:23:56');
    insertSup.run(4, 'شركة الدواء الحديثة', 'fk.jpg', '07701122334', 'حي السلام', '2342342342423423', 0, '2017-11-03 07:23:59');
    insertSup.run(5, 'المتحدة للتوريدات الطبية', 'fk.jpg', '07809988776', 'المركز التجاري', '2342342342423423', 0, '2017-11-03 07:24:01');

    const insertSold = sqlite.prepare(
      'INSERT INTO sold (id, name, contact, discount, item, amount, currency_code, currency_symbol, payment_method, paid_amount, remaining_amount, warehouse_id, status, userId, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSold.run(36, 'احمد', '07705445247', '5', '3', '42.75', 'SAR', 'ر.س', 'cash', 42.75, 0, 1, 'completed', 2, '2021-12-19 08:52:26');
    insertSold.run(37, 'سعيد', '05245585844', '20', '10', '80', 'SAR', 'ر.س', 'cash', 80, 0, 1, 'completed', 2, '2021-12-19 08:54:10');
    insertSold.run(38, 'مشعل', '07705445247', '0', '1', '5', 'SAR', 'ر.س', 'cash', 5, 0, 1, 'completed', 3, '2021-12-19 08:55:12');

    const insertSoldItem = sqlite.prepare(
      'INSERT INTO sold_items (soldId, medicineId, name, price, discount_pct, unit, sale_unit, unit_factor, company, barcode, batchNumber, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSoldItem.run(36, 26, 'مضاد حيوي واسع الطيف', 15, 0, '500mg', 'علبة', 1, 'techcode', '6281001000268', 'B-2026-02', 3);
    insertSoldItem.run(37, 25, 'شراب مهدئ للسعال', 10, 0, '120ml', 'عبوة', 1, 'techcode', '6281001000251', 'B-2026-01', 10);
    insertSoldItem.run(38, 27, 'مسكن ألم وخافض حرارة', 5, 0, '500mg', 'علبة', 1, 'techcode24', '6281001000275', 'B-2026-03', 1);

    sqlite.exec('COMMIT');
  } catch (err) {
    sqlite.exec('ROLLBACK');
    throw err;
  }

  seedErpModulesIfEmpty();
}

seedIfEmpty();

export const sessions = new Map<string, SessionData>();
export const blockedSessions = new Map<string, string>();

export function revokeUserSessions(userId: number, reason?: string): void {
  for (const [sid, data] of sessions.entries()) {
    if (data.userId === userId) {
      sessions.delete(sid);
      if (reason) {
        blockedSessions.set(sid, reason);
      }
    }
  }
}

export function parseAdditionalCurrencies(raw: string | null | undefined): AdditionalCurrency[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((c) => c && typeof c === 'object' && String(c.code || '').trim() !== '')
      .map((c) => ({
        code: String(c.code).trim().toUpperCase(),
        symbol: String(c.symbol || c.code).trim(),
        name: String(c.name || c.code).trim(),
        rateToBase: Math.max(0.000001, Number(c.rateToBase) || 1),
        enabled: c.enabled !== false,
      }));
  } catch {
    return [];
  }
}

export function addMonthsIsoDate(startIso: string, months: number): string {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(startIso) ? new Date(`${startIso}T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) return '';
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + Math.max(1, months), base.getUTCDate()));
  return target.toISOString().slice(0, 10);
}

export function computeLicenseStatus(licenseExpiresAt?: string | null): {
  licenseExpiresAt: string;
  daysRemaining: number | null;
  expiringSoon: boolean;
  expired: boolean;
} {
  const clean = String(licenseExpiresAt || '').trim().slice(0, 10);
  if (!clean || !/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return { licenseExpiresAt: '', daysRemaining: null, expiringSoon: false, expired: false };
  }
  const [y, m, d] = clean.split('-').map(Number);
  const expUtc = Date.UTC(y, m - 1, d);
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysRemaining = Math.floor((expUtc - todayUtc) / 86400000);
  return {
    licenseExpiresAt: clean,
    daysRemaining,
    expiringSoon: daysRemaining >= 0 && daysRemaining <= 5,
    expired: daysRemaining < 0,
  };
}

export function checkPharmacyAccessStatus(pharmacyId: number): {
  allowed: boolean;
  isActive: boolean;
  licenseExpired: boolean;
  licenseExpiresAt: string;
  daysRemaining: number | null;
  expiringSoon: boolean;
  reason?: string;
} {
  const row = sqlite
    .prepare('SELECT id, name, is_active, license_expires_at FROM pharmacies WHERE id = ?')
    .get(pharmacyId) as { id: number; name: string; is_active: number; license_expires_at?: string } | undefined;

  if (!row) {
    return {
      allowed: false,
      isActive: false,
      licenseExpired: false,
      licenseExpiresAt: '',
      daysRemaining: null,
      expiringSoon: false,
      reason: 'حساب الصيدلية غير موجود في المنصة',
    };
  }

  const lic = computeLicenseStatus(row.license_expires_at);
  if (Number(row.is_active) !== 1) {
    return {
      allowed: false,
      isActive: false,
      licenseExpired: lic.expired,
      licenseExpiresAt: lic.licenseExpiresAt,
      daysRemaining: lic.daysRemaining,
      expiringSoon: lic.expiringSoon,
      reason: 'تم إيقاف وتعليق حساب هذه الصيدلية من قبل إدارة النظام. يرجى التواصل مع الإدارة.',
    };
  }

  if (lic.expired) {
    return {
      allowed: false,
      isActive: true,
      licenseExpired: true,
      licenseExpiresAt: lic.licenseExpiresAt,
      daysRemaining: lic.daysRemaining,
      expiringSoon: false,
      reason: `انتهى ترخيص استخدام النظام لصيدلية "${row.name}" بتاريخ ${lic.licenseExpiresAt}. يجب التواصل مع إدارة النظام من أجل تجديد الترخيص والسماح لك باستخدام النظام.`,
    };
  }

  return {
    allowed: true,
    isActive: true,
    licenseExpired: false,
    licenseExpiresAt: lic.licenseExpiresAt,
    daysRemaining: lic.daysRemaining,
    expiringSoon: lic.expiringSoon,
  };
}

export function getSiteSettings(pharmacyId = 1): SiteSettings {
  const pharmRow = sqlite
    .prepare(
      `SELECT id, title, name, logo, currency_code, currency_symbol, currency_name,
              additional_currencies, auto_convert_currencies, default_display_currency,
              owner_name, owner_email, phone, address, trade_name, city, country,
              tax_number, license_number, notes,
              currency_decimals, sales_currency_code, purchases_currency_code, license_expires_at
       FROM pharmacies WHERE id = ?`,
    )
    .get(pharmacyId) as
    | {
        id: number;
        title?: string;
        name: string;
        logo?: string;
        currency_code?: string;
        currency_symbol?: string;
        currency_name?: string;
        additional_currencies?: string;
        auto_convert_currencies?: number;
        default_display_currency?: string;
        owner_name?: string;
        owner_email?: string;
        phone?: string;
        address?: string;
        trade_name?: string;
        city?: string;
        country?: string;
        tax_number?: string;
        license_number?: string;
        notes?: string;
        currency_decimals?: number;
        sales_currency_code?: string;
        purchases_currency_code?: string;
        license_expires_at?: string;
      }
    | undefined;

  const lic = computeLicenseStatus(pharmRow?.license_expires_at);

  if (pharmacyId > 1 && pharmRow) {
    const code = pharmRow.currency_code || 'SAR';
    return {
      id: pharmRow.id,
      title: pharmRow.title || `نظام ادارة الصيدلية المتكامل - ${pharmRow.name}`,
      name: pharmRow.name,
      logo: pharmRow.logo || '',
      currencyCode: code,
      currencySymbol: pharmRow.currency_symbol || 'ر.س',
      currencyName: pharmRow.currency_name || 'ريال سعودي',
      additionalCurrencies: parseAdditionalCurrencies(pharmRow.additional_currencies),
      autoConvertCurrencies: Number(pharmRow.auto_convert_currencies || 0) === 1,
      defaultDisplayCurrency: pharmRow.default_display_currency || code,
      ownerName: pharmRow.owner_name || '',
      ownerEmail: pharmRow.owner_email || '',
      phone: pharmRow.phone || '',
      address: pharmRow.address || '',
      tradeName: pharmRow.trade_name || '',
      city: pharmRow.city || '',
      country: pharmRow.country || '',
      taxNumber: pharmRow.tax_number || '',
      licenseNumber: pharmRow.license_number || '',
      notes: pharmRow.notes || '',
      currencyDecimals: Number(pharmRow.currency_decimals ?? 2),
      salesCurrencyCode: pharmRow.sales_currency_code || pharmRow.default_display_currency || code,
      purchasesCurrencyCode: pharmRow.purchases_currency_code || code,
      licenseExpiresAt: lic.licenseExpiresAt,
      licenseDaysRemaining: lic.daysRemaining,
      licenseExpiringSoon: lic.expiringSoon,
      licenseExpired: lic.expired,
    };
  }

  const row = sqlite
    .prepare(
      'SELECT id, title, name, logo, currency_code, currency_symbol, currency_name, additional_currencies, auto_convert_currencies, default_display_currency FROM site WHERE id = 1',
    )
    .get() as
    | {
        id: number;
        title: string;
        name: string;
        logo?: string;
        currency_code: string;
        currency_symbol: string;
        currency_name: string;
        additional_currencies?: string;
        auto_convert_currencies?: number;
        default_display_currency?: string;
      }
    | undefined;
  if (!row) {
    return {
      id: 1,
      title: 'نظام ادارة الصيدلية',
      name: 'صيدلية الشفاء',
      logo: '',
      currencyCode: 'SAR',
      currencySymbol: 'ر.س',
      currencyName: 'ريال سعودي',
      additionalCurrencies: [],
      autoConvertCurrencies: false,
      defaultDisplayCurrency: 'SAR',
      ownerName: pharmRow?.owner_name || '',
      ownerEmail: pharmRow?.owner_email || '',
      phone: pharmRow?.phone || '',
      address: pharmRow?.address || '',
      tradeName: pharmRow?.trade_name || '',
      city: pharmRow?.city || '',
      country: pharmRow?.country || '',
      taxNumber: pharmRow?.tax_number || '',
      licenseNumber: pharmRow?.license_number || '',
      notes: pharmRow?.notes || '',
      currencyDecimals: Number(pharmRow?.currency_decimals ?? 2),
      salesCurrencyCode: pharmRow?.sales_currency_code || 'SAR',
      purchasesCurrencyCode: pharmRow?.purchases_currency_code || 'SAR',
      licenseExpiresAt: lic.licenseExpiresAt,
      licenseDaysRemaining: lic.daysRemaining,
      licenseExpiringSoon: lic.expiringSoon,
      licenseExpired: lic.expired,
    };
  }
  const baseCode = row.currency_code || 'SAR';
  return {
    id: row.id,
    title: row.title,
    name: row.name,
    logo: row.logo || '',
    currencyCode: baseCode,
    currencySymbol: row.currency_symbol || 'ر.س',
    currencyName: row.currency_name || 'ريال سعودي',
    additionalCurrencies: parseAdditionalCurrencies(row.additional_currencies),
    autoConvertCurrencies: Number(row.auto_convert_currencies || 0) === 1,
    defaultDisplayCurrency: row.default_display_currency || baseCode,
    ownerName: pharmRow?.owner_name || '',
    ownerEmail: pharmRow?.owner_email || '',
    phone: pharmRow?.phone || '',
    address: pharmRow?.address || '',
    tradeName: pharmRow?.trade_name || '',
    city: pharmRow?.city || '',
    country: pharmRow?.country || '',
    taxNumber: pharmRow?.tax_number || '',
    licenseNumber: pharmRow?.license_number || '',
    notes: pharmRow?.notes || '',
    currencyDecimals: Number(pharmRow?.currency_decimals ?? 2),
    salesCurrencyCode: pharmRow?.sales_currency_code || row.default_display_currency || baseCode,
    purchasesCurrencyCode: pharmRow?.purchases_currency_code || baseCode,
    licenseExpiresAt: lic.licenseExpiresAt,
    licenseDaysRemaining: lic.daysRemaining,
    licenseExpiringSoon: lic.expiringSoon,
    licenseExpired: lic.expired,
  };
}

export function resolveSiteCurrency(
  site: SiteSettings,
  requestedCode?: string,
): { code: string; symbol: string; name: string; rateToBase: number } {
  const code = (requestedCode || '').trim().toUpperCase();
  if (!code || code === site.currencyCode) {
    return {
      code: site.currencyCode,
      symbol: site.currencySymbol,
      name: site.currencyName,
      rateToBase: 1,
    };
  }
  const extra = site.additionalCurrencies.find((c) => c.enabled && c.code === code && c.rateToBase > 0);
  if (extra) {
    return {
      code: extra.code,
      symbol: extra.symbol,
      name: extra.name,
      rateToBase: extra.rateToBase,
    };
  }
  return {
    code: site.currencyCode,
    symbol: site.currencySymbol,
    name: site.currencyName,
    rateToBase: 1,
  };
}

export function getAdminName(id: number): string {
  const row = sqlite.prepare('SELECT name FROM users WHERE id = ?').get(Number(id)) as { name: string } | undefined;
  return row?.name || 'غير معروف';
}

export function getAllCat(): Array<{ id: number; name: string }> {
  return sqlite.prepare('SELECT id, name FROM categories ORDER BY id ASC').all() as Array<{
    id: number;
    name: string;
  }>;
}

export function isExpired(expiryDate: string): boolean {
  if (!expiryDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return expiryDate < today;
}

export function daysUntilExpiry(expiryDate: string): number | null {
  if (!expiryDate) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(exp.getTime())) return null;
  return Math.ceil((exp.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function normalizeLoginDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const idx = '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
    return idx >= 0 ? String(idx % 10) : ch;
  });
}

export const calculateEan13CheckDigit = calculateGs1CheckDigit;

export function generateUniqueUsername(rawBase: string, excludeUserId?: number): string {
  const cleaned = normalizeLoginDigits(rawBase)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}._-]/gu, '')
    .toLowerCase();
  const base = cleaned || (excludeUserId ? `user${excludeUserId}` : 'user');
  let candidate = base;
  let counter = 1;
  while (true) {
    const existing = excludeUserId
      ? sqlite
          .prepare('SELECT id FROM users WHERE lower(username) = lower(?) AND id != ? LIMIT 1')
          .get(candidate, excludeUserId)
      : sqlite
          .prepare('SELECT id FROM users WHERE lower(username) = lower(?) LIMIT 1')
          .get(candidate);
    if (!existing) return candidate;
    counter += 1;
    candidate = `${base}${counter}`;
  }
}

export function findUsersForLogin(rawIdentifier: string): UserRecord[] {
  const trimmed = rawIdentifier.trim();
  if (!trimmed) return [];
  const normalized = normalizeLoginDigits(trimmed).trim();

  const seen = new Set<number>();
  const ordered: UserRecord[] = [];
  const pushRow = (r: Record<string, unknown> | undefined) => {
    if (!r) return;
    const u = rowToUser(r);
    if (!seen.has(u.id)) {
      seen.add(u.id);
      ordered.push(u);
    }
  };
  const pushRows = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) pushRow(r);
  };

  // 1. Exact Email match
  pushRow(
    sqlite.prepare('SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1').get(trimmed) as
      | Record<string, unknown>
      | undefined,
  );

  // 2. Exact Username match
  pushRow(
    sqlite
      .prepare("SELECT * FROM users WHERE username != '' AND lower(username) = lower(?) LIMIT 1")
      .get(normalized) as Record<string, unknown> | undefined,
  );

  // 3. Numeric User ID (رقم المستخدم)
  if (/^\d+$/.test(normalized)) {
    const numericId = Number(normalized);
    if (Number.isSafeInteger(numericId) && numericId > 0) {
      pushRow(
        sqlite.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(numericId) as
          | Record<string, unknown>
          | undefined,
      );
    }
  }

  // 4. Phone / Staff Number (number field)
  pushRows(
    sqlite
      .prepare("SELECT * FROM users WHERE number != '' AND (number = ? OR number = ?)")
      .all(trimmed, normalized) as Array<Record<string, unknown>>,
  );

  // 5. Full Display Name (name field)
  pushRows(
    sqlite
      .prepare('SELECT * FROM users WHERE lower(trim(name)) = lower(?)')
      .all(trimmed) as Array<Record<string, unknown>>,
  );

  return ordered;
}

export function rowToUser(r: Record<string, unknown>): UserRecord {
  const role = normalizeRole(String(r.role || 'pharmacist'));
  const isActiveVal = r.is_active === undefined ? 1 : Number(r.is_active);
  return {
    id: Number(r.id),
    email: String(r.email),
    username: String(r.username || ''),
    passwordHash: String(r.password_hash),
    name: String(r.name),
    role,
    isActive: isActiveVal === 1,
    permissions: normalizePermissions(role, r.permissions ? String(r.permissions) : ''),
    pic: String(r.pic || 'png.png'),
    number: String(r.number || ''),
    pharmacy_id: Number(r.pharmacy_id || 1),
    date: String(r.date),
  };
}

export function rowToInventory(r: Record<string, unknown>): InventoryRecord & { categoryName?: string } {
  return {
    id: Number(r.id),
    catId: Number(r.catId),
    categoryName: r.categoryName !== undefined ? String(r.categoryName) : undefined,
    supplier: String(r.supplier || ''),
    name: String(r.name),
    scientificName: String(r.scientific_name || ''),
    activeIngredient: String(r.active_ingredient || ''),
    dosageForm: String(r.dosage_form || 'أقراص'),
    countryOfOrigin: String(r.country_of_origin || ''),
    regNumber: String(r.reg_number || ''),
    unit: String(r.unit || ''),
    packUnit: String(r.pack_unit || 'علبة'),
    stripUnit: String(r.strip_unit || 'شريط'),
    stripsPerPack: Number(r.strips_per_pack) || 1,
    stripPrice: Number(r.strip_price) || 0,
    pieceUnit: String(r.piece_unit || 'حبة'),
    piecesPerPack: Number(r.pieces_per_pack) || 1,
    piecePrice: Number(r.piece_price) || 0,
    purchasePrice: Number(r.purchase_price) || 0,
    price: String(r.price || '0'),
    quantity: Number((Number(r.quantity) || 0).toFixed(4)),
    minStock: Number(r.minStock) || 0,
    maxStock: Number(r.max_stock) || 500,
    storageLocation: String(r.storage_location || ''),
    requiresPrescription: Number(r.requires_prescription) === 1,
    isControlled: Number(r.is_controlled) === 1,
    controlledSchedule: String(r.controlled_schedule || ''),
    maxDailyDose: String(r.max_daily_dose || ''),
    pregnancyCategory: String(r.pregnancy_category || ''),
    status: String(r.status || 'active'),
    barcode: String(r.barcode || ''),
    batchNumber: String(r.batchNumber || ''),
    expiryDate: String(r.expiryDate || ''),
    pic: String(r.pic || ''),
    description: String(r.description || ''),
    company: String(r.company || ''),
    date: String(r.date || ''),
  };
}

// --- ERP Synchronization & Audit & Accounting Helpers ---

export function syncMedicineFromBatches(medicineId: number): number {
  const activeBatches = sqlite
    .prepare(
      `SELECT id, batch_number, expiry_date, qty_remaining
       FROM medicine_batches
       WHERE medicine_id = ? AND status = 'active' AND qty_remaining > 0
       ORDER BY expiry_date ASC, id ASC`,
    )
    .all(medicineId) as Array<{
    id: number;
    batch_number: string;
    expiry_date: string;
    qty_remaining: number;
  }>;

  const totalQty = Number(
    activeBatches.reduce((sum, b) => sum + (Number(b.qty_remaining) || 0), 0).toFixed(4),
  );
  const nearest = activeBatches[0];
  if (nearest) {
    sqlite
      .prepare('UPDATE inventeries SET quantity = ?, batchNumber = ?, expiryDate = ? WHERE id = ?')
      .run(totalQty, nearest.batch_number, nearest.expiry_date, medicineId);
  } else {
    sqlite.prepare('UPDATE inventeries SET quantity = ? WHERE id = ?').run(totalQty, medicineId);
  }
  return totalQty;
}

function resolveUserPharmacyId(userId: number, explicitPharmacyId?: number): number {
  if (explicitPharmacyId && explicitPharmacyId > 0) return explicitPharmacyId;
  const row = sqlite.prepare('SELECT pharmacy_id FROM users WHERE id = ?').get(userId) as
    | { pharmacy_id?: number }
    | undefined;
  return Number(row?.pharmacy_id || 1);
}

export function resolvePharmacyAccountId(pharmacyId: number, baseCode: string): number {
  if (pharmacyId <= 1) {
    const row = sqlite
      .prepare('SELECT id FROM accounts WHERE pharmacy_id = 1 AND (code = ? OR id = ?) LIMIT 1')
      .get(baseCode, Number(baseCode.slice(0, 3))) as { id: number } | undefined;
    if (row) return row.id;
  }
  const codeWithSuffix = `${baseCode}-${pharmacyId}`;
  const tenantRow = sqlite
    .prepare('SELECT id FROM accounts WHERE pharmacy_id = ? AND (code = ? OR code = ?) LIMIT 1')
    .get(pharmacyId, codeWithSuffix, baseCode) as { id: number } | undefined;
  if (tenantRow) return tenantRow.id;
  const fallback = sqlite.prepare('SELECT id FROM accounts WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmacyId) as
    | { id: number }
    | undefined;
  return fallback?.id || Number(baseCode.slice(0, 3)) || 101;
}

export function recordStockMovement(params: {
  medicineId: number;
  medicineName: string;
  warehouseId: number;
  batchId?: number | null;
  batchNumber?: string;
  movementType: string;
  qtyChange: number;
  balanceAfter: number;
  referenceType?: string;
  referenceId?: number | null;
  notes?: string;
  userId: number;
  pharmacyId?: number;
}): void {
  const pharmId = resolveUserPharmacyId(params.userId, params.pharmacyId);
  sqlite
    .prepare(
      `INSERT INTO stock_movements
        (medicine_id, medicine_name, warehouse_id, batch_id, batch_number, movement_type, qty_change, balance_after, reference_type, reference_id, notes, user_id, pharmacy_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.medicineId,
      params.medicineName,
      params.warehouseId,
      params.batchId ?? null,
      params.batchNumber || '',
      params.movementType,
      Number(params.qtyChange.toFixed(4)),
      Number(params.balanceAfter.toFixed(4)),
      params.referenceType || '',
      params.referenceId ?? null,
      params.notes || '',
      params.userId,
      pharmId,
      currentTimestamp(),
    );
}

export function postJournalEntry(params: {
  description: string;
  referenceType: string;
  referenceId?: number | null;
  userId: number;
  pharmacyId?: number;
  entryDate?: string;
  lines: Array<{ accountId: number; debit: number; credit: number; notes?: string }>;
}): number {
  const validLines = params.lines.filter((l) => l.debit > 0.0001 || l.credit > 0.0001);
  if (validLines.length === 0) return 0;

  const totalDebit = Number(validLines.reduce((s, l) => s + l.debit, 0).toFixed(2));
  const totalCredit = Number(validLines.reduce((s, l) => s + l.credit, 0).toFixed(2));
  if (Math.abs(totalDebit - totalCredit) > 0.05) {
    throw new Error(`قيد غير متوازن (${totalDebit} مدين مقابل ${totalCredit} دائن)`);
  }

  const pharmId = resolveUserPharmacyId(params.userId, params.pharmacyId);
  const entryDate = params.entryDate || currentTimestamp().slice(0, 10);
  const info = sqlite
    .prepare(
      'INSERT INTO journal_entries (entry_date, description, reference_type, reference_id, user_id, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      entryDate,
      params.description,
      params.referenceType,
      params.referenceId ?? null,
      params.userId,
      pharmId,
      currentTimestamp(),
    );
  const journalId = Number(info.lastInsertRowid);

  const insertLine = sqlite.prepare(
    'INSERT INTO journal_lines (journal_id, account_id, debit, credit, notes) VALUES (?, ?, ?, ?, ?)',
  );
  const getAcc = sqlite.prepare('SELECT id, account_type FROM accounts WHERE id = ?');
  const updateAccBal = sqlite.prepare('UPDATE accounts SET balance = ROUND(balance + ?, 2) WHERE id = ?');
  const updateCashBoxByAcc = sqlite.prepare(
    'UPDATE cash_boxes SET balance = ROUND(balance + ?, 2) WHERE account_id = ?',
  );

  for (const line of validLines) {
    insertLine.run(
      journalId,
      line.accountId,
      Number(line.debit.toFixed(2)),
      Number(line.credit.toFixed(2)),
      line.notes || '',
    );
    const acc = getAcc.get(line.accountId) as { id: number; account_type: string } | undefined;
    if (acc) {
      const delta =
        acc.account_type === 'asset' || acc.account_type === 'expense'
          ? line.debit - line.credit
          : line.credit - line.debit;
      updateAccBal.run(delta, acc.id);
      if (acc.account_type === 'asset') {
        updateCashBoxByAcc.run(delta, acc.id);
      }
    }
  }

  return journalId;
}

export function logAudit(params: {
  userId: number;
  userName: string;
  action: string;
  entityType: string;
  entityId?: number | null;
  details: string;
  pharmacyId?: number;
}): void {
  const pharmId = resolveUserPharmacyId(params.userId, params.pharmacyId);
  sqlite
    .prepare(
      'INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, details, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      params.userId,
      params.userName,
      params.action,
      params.entityType,
      params.entityId ?? null,
      params.details,
      pharmId,
      currentTimestamp(),
    );
}

export function logPlatformAudit(params: {
  actorId: number;
  actorName: string;
  action: string;
  targetType?: string;
  targetId?: number | null;
  details: string;
}): void {
  sqlite
    .prepare(
      'INSERT INTO platform_audit_logs (actor_id, actor_name, action, target_type, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      params.actorId,
      params.actorName,
      params.action,
      params.targetType || 'pharmacy',
      params.targetId ?? null,
      params.details,
      currentTimestamp(),
    );
}

export interface ProvisionPharmacyParams {
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
}

export function provisionNewPharmacyTenant(params: ProvisionPharmacyParams): {
  pharmacyId: number;
  ownerUserId: number;
  pharmacy: Record<string, unknown>;
  owner: UserRecord;
} {
  const normUsername = params.ownerUsername.trim().toLowerCase().replace(/\s+/g, '_');
  const normEmail = params.ownerEmail.trim().toLowerCase();

  const existingEmail = sqlite.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normEmail);
  if (existingEmail) {
    throw new Error('البريد الإلكتروني لمالك الصيدلية مسجل مسبقاً في النظام');
  }
  const existingUsername = sqlite
    .prepare("SELECT id FROM users WHERE username != '' AND lower(username) = ?")
    .get(normUsername);
  if (existingUsername) {
    throw new Error('اسم المستخدم لمالك الصيدلية مسجل مسبقاً، يرجى اختيار اسم مستخدم آخر');
  }

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const now = currentTimestamp();
    const currCode = (params.currencyCode || 'SAR').trim().toUpperCase();
    const currSymbol = (params.currencySymbol || 'ر.س').trim();
    const currName = (params.currencyName || 'ريال سعودي').trim();
    const decimals = Math.min(4, Math.max(0, Number(params.currencyDecimals ?? 2)));
    const isActiveFlag = params.isActive !== false ? 1 : 0;
    const subStart = params.subscriptionStart?.trim() || now.slice(0, 10);
    const subMonths = Math.max(1, Number(params.subscriptionMonths ?? 12));
    const rawExpires = params.licenseExpiresAt !== undefined ? params.licenseExpiresAt.trim() : addMonthsIsoDate(subStart, subMonths);
    const licenseExpiresAt = /^\d{4}-\d{2}-\d{2}$/.test(rawExpires) ? rawExpires : '';
    const generatedCode = params.code?.trim() || `PHARM-${Date.now().toString().slice(-4)}`;

    const insPharm = sqlite.prepare(
      `INSERT INTO pharmacies
        (title, name, trade_name, code, logo, currency_code, currency_symbol, currency_name, currency_decimals,
         additional_currencies, auto_convert_currencies, default_display_currency, sales_currency_code, purchases_currency_code,
         owner_name, owner_username, owner_email, phone, address, city, country, tax_number, license_number,
         is_active, subscription_start, subscription_months, license_expires_at, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const pInfo = insPharm.run(
      `نظام ادارة الصيدلية المتكامل - ${params.name.trim()}`,
      params.name.trim(),
      params.tradeName?.trim() || params.name.trim(),
      generatedCode,
      params.logo || '',
      currCode,
      currSymbol,
      currName,
      decimals,
      currCode,
      currCode,
      currCode,
      params.ownerName.trim(),
      normUsername,
      normEmail,
      params.phone || '',
      params.address || '',
      params.city || '',
      params.country || 'السعودية',
      params.taxNumber || '',
      params.licenseNumber || '',
      isActiveFlag,
      subStart,
      subMonths,
      licenseExpiresAt,
      params.notes || '',
      now,
    );
    const pharmacyId = Number(pInfo.lastInsertRowid);

    // 1. Create Pharmacy Owner account with full access to their pharmacy
    const insUser = sqlite.prepare(
      `INSERT INTO users
        (email, username, password_hash, name, role, is_active, permissions, pic, number, pharmacy_id, date)
       VALUES (?, ?, ?, ?, 'pharmacy_owner', ?, ?, 'png.png', ?, ?, ?)`,
    );
    const uInfo = insUser.run(
      normEmail,
      normUsername,
      hashPassword(params.ownerPassword),
      params.ownerName.trim(),
      isActiveFlag,
      JSON.stringify(DEFAULT_PERMISSIONS_BY_ROLE.pharmacy_owner),
      params.phone || '',
      pharmacyId,
      now,
    );
    const ownerUserId = Number(uInfo.lastInsertRowid);

    // Update owner_user_id in pharmacies
    sqlite.prepare('UPDATE pharmacies SET owner_user_id = ? WHERE id = ?').run(ownerUserId, pharmacyId);

    // 2. Baseline Main Warehouse (الصالة الرئيسية) for this new pharmacy
    sqlite
      .prepare(
        `INSERT INTO warehouses
          (name, type, location, is_active, code, manager_name, phone, is_branch_pos, target_daily_sales, pharmacy_id, created_at)
         VALUES (?, 'main', 'المقر الرئيسي - الدور الأرضي', 1, 'BR-01', ?, ?, 1, 3000, ?, ?)`,
      )
      .run('المستودع الرئيسي (الصالة)', params.ownerName.trim(), params.phone || '', pharmacyId, now);

    // 3. Baseline Standard Categories (ready for adding medicines)
    const baseCats: Array<[string, string]> = [
      ['أقراص وحبوب', 'tablet.png'],
      ['كبسولات دوائية', 'cap.png'],
      ['شراب ومحاليل', 'syrup.png'],
      ['حقن وأمبولات', 'injection.jpg'],
      ['مراهم وكريمات جلدية', 'cream.png'],
      ['مسكنات الألم وخافض حرارة', 'cap.png'],
      ['فيتامينات ومكملات غذائية', 'tablet.png'],
      ['مستلزمات طبية وتجميل', 'lotion.png'],
    ];
    const insCat = sqlite.prepare(
      'INSERT INTO categories (name, pic, details, pharmacy_id, date) VALUES (?, ?, ?, ?, ?)',
    );
    for (const [catName, catPic] of baseCats) {
      insCat.run(catName, catPic, `تصنيف تأسيسي لصيدلية ${params.name.trim()}`, pharmacyId, now);
    }

    // 4. Baseline Chart of Accounts (all with 0 initial balance)
    const insAcc = sqlite.prepare(
      'INSERT INTO accounts (code, name, account_type, balance, is_system, pharmacy_id) VALUES (?, ?, ?, 0, 1, ?)',
    );
    const acc101 = Number(
      insAcc.run(`1010-${pharmacyId}`, 'الصندوق الرئيسي', 'asset', pharmacyId).lastInsertRowid,
    );
    const acc102 = Number(
      insAcc.run(`1020-${pharmacyId}`, 'الحساب البنكي (نقاط البيع)', 'asset', pharmacyId).lastInsertRowid,
    );
    insAcc.run(`1030-${pharmacyId}`, 'المخزون الدوائي', 'asset', pharmacyId);
    insAcc.run(`1040-${pharmacyId}`, 'ذمم العملاء (الآجل)', 'asset', pharmacyId);
    insAcc.run(`1050-${pharmacyId}`, 'ذمم شركات التأمين', 'asset', pharmacyId);
    insAcc.run(`2010-${pharmacyId}`, 'ذمم الموردين', 'liability', pharmacyId);
    insAcc.run(`2020-${pharmacyId}`, 'ضرائب ورسوم مستحقة', 'liability', pharmacyId);
    insAcc.run(`3010-${pharmacyId}`, 'رأس المال الافتتاحي', 'equity', pharmacyId);
    insAcc.run(`4010-${pharmacyId}`, 'إيرادات مبيعات الأدوية', 'revenue', pharmacyId);
    insAcc.run(`4020-${pharmacyId}`, 'إيرادات أخرى', 'revenue', pharmacyId);
    insAcc.run(`5010-${pharmacyId}`, 'تكلفة المبيعات والمشتريات', 'expense', pharmacyId);
    insAcc.run(`5020-${pharmacyId}`, 'مصروفات تشغيلية وإدارية', 'expense', pharmacyId);
    insAcc.run(`5030-${pharmacyId}`, 'الرواتب والأجور والمكافآت', 'expense', pharmacyId);
    insAcc.run(`5040-${pharmacyId}`, 'خسائر تالف ومنتهي الصلاحية', 'expense', pharmacyId);

    // 5. Baseline Cash Boxes (all 0 balance)
    sqlite
      .prepare('INSERT INTO cash_boxes (name, box_type, account_id, balance, pharmacy_id) VALUES (?, ?, ?, 0, ?)')
      .run('الصندوق النقدي الرئيسي', 'cash', acc101, pharmacyId);
    sqlite
      .prepare('INSERT INTO cash_boxes (name, box_type, account_id, balance, pharmacy_id) VALUES (?, ?, ?, 0, ?)')
      .run('حساب البنك / نقاط البيع', 'bank', acc102, pharmacyId);

    // 6. Default Cash Customer (balance 0)
    sqlite
      .prepare(
        'INSERT INTO customers (name, phone, address, credit_limit, balance, notes, pharmacy_id, created_at) VALUES (?, ?, ?, 0, 0, ?, ?, ?)',
      )
      .run('عميل نقدي عام', '0500000000', 'العملاء المباشرين', 'حساب البيع النقدي السريع', pharmacyId, now);

    // 7. Linked HR profile for Owner
    sqlite
      .prepare(
        `INSERT INTO employees
          (user_id, full_name, job_title, specialty, phone, base_salary, commission_rate, hire_date, is_active, pharmacy_id)
         VALUES (?, ?, 'مالك الصيدلية / المدير العام', 'إدارة عامة وصيدلية', ?, 0, 0, ?, 1, ?)`,
      )
      .run(ownerUserId, params.ownerName.trim(), params.phone || '', now.slice(0, 10), pharmacyId);

    // 8. Seed tenant-isolated default integration configs
    const insIntg = sqlite.prepare(
      'INSERT OR IGNORE INTO integration_configs (integration_key, display_name, category, enabled, config_json, last_tested_at, last_status, notes, pharmacy_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insIntg.run('barcode_scanner', 'قارئ الباركود الليزري (HID / USB)', 'hardware', 1, JSON.stringify({ mode: 'keyboard_wedge', prefix: '', suffix: 'Enter' }), '', 'ready', 'جاهز للمسح التلقائي في نقطة البيع والمخزون', pharmacyId);
    insIntg.run('thermal_printer', 'طابعة الإيصالات الحرارية 80mm (ESC/POS)', 'hardware', 1, JSON.stringify({ paperWidth: '80mm', autoOpenCashDrawer: true }), '', 'ready', 'متوافقة مع معاينة الإيصال الحراري 80mm', pharmacyId);
    insIntg.run('label_printer', 'طابعة ملصقات الباركود Code128', 'hardware', 1, JSON.stringify({ labelWidthMm: 50, labelHeightMm: 25, columns: 3 }), '', 'ready', 'لطباعة ملصقات الرفوف والأصناف من المخزون', pharmacyId);
    insIntg.run('zatca_qr', 'الفوترة الإلكترونية ورمز QR الضريبي (ZATCA TLV)', 'compliance', 1, JSON.stringify({ sellerName: params.name.trim(), vatNumber: params.taxNumber || '', vatRatePct: 0 }), '', 'ready', 'توليد رمز QR TLV مشفر في الفواتير', pharmacyId);
    insIntg.run('insurance_api', 'بوابة ربط المطالبات التأمينية (NPHIES / API)', 'external_api', 0, JSON.stringify({ endpointUrl: '', providerCode: generatedCode }), '', 'configured', 'تصدير واستعلام موافقات التأمين', pharmacyId);

    sqlite.exec('COMMIT');

    const createdPharm = sqlite.prepare('SELECT * FROM pharmacies WHERE id = ?').get(pharmacyId) as Record<
      string,
      unknown
    >;
    const createdUser = rowToUser(
      sqlite.prepare('SELECT * FROM users WHERE id = ?').get(ownerUserId) as Record<string, unknown>,
    );

    return {
      pharmacyId,
      ownerUserId,
      pharmacy: createdPharm,
      owner: createdUser,
    };
  } catch (err) {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // ignore
    }
    throw err;
  }
}

export function deletePharmacyTenant(pharmacyId: number): { deletedName: string; deletedCode: string } {
  if (!Number.isInteger(pharmacyId) || pharmacyId <= 1) {
    throw new Error('لا يمكن حذف الصيدلية الرئيسية التأسيسية');
  }
  const existing = sqlite
    .prepare('SELECT id, name, code FROM pharmacies WHERE id = ?')
    .get(pharmacyId) as { id: number; name: string; code: string } | undefined;
  if (!existing) {
    throw new Error('الصيدلية المطلوب حذفها غير موجودة');
  }

  const tenantUsers = sqlite
    .prepare("SELECT id FROM users WHERE pharmacy_id = ? AND role != 'developer'")
    .all(pharmacyId) as Array<{ id: number }>;
  for (const u of tenantUsers) {
    revokeUserSessions(u.id, 'تم حذف حساب الصيدلية من قبل إدارة النظام');
  }

  sqlite.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    sqlite.prepare('DELETE FROM sold_items WHERE soldId IN (SELECT id FROM sold WHERE pharmacy_id = ?)').run(pharmacyId);
    sqlite
      .prepare('DELETE FROM sales_return_items WHERE return_id IN (SELECT id FROM sales_returns WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM purchase_order_items WHERE po_id IN (SELECT id FROM purchase_orders WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM stock_transfer_items WHERE transfer_id IN (SELECT id FROM stock_transfers WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM prescription_items WHERE prescription_id IN (SELECT id FROM prescriptions WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM medicine_batches WHERE medicine_id IN (SELECT id FROM inventeries WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM journal_lines WHERE journal_id IN (SELECT id FROM journal_entries WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM employee_attendance WHERE employee_id IN (SELECT id FROM employees WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM employee_transactions WHERE employee_id IN (SELECT id FROM employees WHERE pharmacy_id = ?)')
      .run(pharmacyId);
    sqlite
      .prepare('DELETE FROM loyalty_transactions WHERE customer_id IN (SELECT id FROM customers WHERE pharmacy_id = ?)')
      .run(pharmacyId);

    const scopedTables = [
      'currency_rate_history',
      'backup_snapshots',
      'hardware_audit_logs',
      'print_jobs',
      'hardware_devices',
      'barcode_history',
      'product_barcodes',
      'audit_logs',
      'stock_movements',
      'sales_returns',
      'sold',
      'held_bills',
      'pos_shifts',
      'purchase_returns',
      'purchase_orders',
      'stock_transfers',
      'stock_counts',
      'prescriptions',
      'doctors',
      'customers',
      'supplier',
      'warehouses',
      'categories',
      'inventeries',
      'vouchers',
      'journal_entries',
      'cash_boxes',
      'accounts',
      'employees',
      'operating_expenses',
      'promotions',
      'insurance_claims',
      'insurance_companies',
      'drug_interactions',
      'integration_configs',
      'drug_recalls',
      'controlled_dispense_logs',
    ];
    for (const tbl of scopedTables) {
      sqlite.prepare(`DELETE FROM ${tbl} WHERE pharmacy_id = ?`).run(pharmacyId);
    }

    sqlite.prepare("DELETE FROM users WHERE pharmacy_id = ? AND role != 'developer'").run(pharmacyId);
    sqlite.prepare('DELETE FROM pharmacies WHERE id = ?').run(pharmacyId);
    sqlite.exec('COMMIT; PRAGMA foreign_keys = ON;');

    return {
      deletedName: String(existing.name || ''),
      deletedCode: String(existing.code || ''),
    };
  } catch (err) {
    try {
      sqlite.exec('ROLLBACK; PRAGMA foreign_keys = ON;');
    } catch {
      // ignore
    }
    throw err;
  }
}

