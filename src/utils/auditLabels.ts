import type { AuditLogRecord } from '../types';

export type AuditSeverity = 'high' | 'medium' | 'low';

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: 'تسجيل دخول',
  logout: 'تسجيل خروج',
  create: 'إضافة / إنشاء',
  update: 'تعديل / تحديث',
  delete: 'حذف نهائي',
  cancel: 'إلغاء فاتورة',
  checkout: 'إصدار فاتورة بيع',
  sales_return: 'مرتجع مبيعات',
  purchase_return: 'مرتجع مشتريات',
  approve: 'اعتماد طلب/تحويل',
  receive: 'استلام مخزني',
  status_change: 'تغيير حالة / حجز',
  stocktake: 'تسوية جرد مخزني',
  block_user: 'منع وحظر مستخدم',
  allow_user: 'سماح وتفعيل مستخدم',
  update_site: 'تعديل إعدادات الصيدلية والعملة',
  export_database: 'تصدير قاعدة البيانات (JSON)',
  import_database: 'استيراد واستعادة قاعدة البيانات',
  open_shift: 'فتح وردية كاشير',
  close_shift: 'إغلاق ومطابقة وردية',
  attendance: 'تسجيل حضور/انصراف',
  controlled_dispense: 'صرف دواء مقيد (مراقب)',
  recall_quarantine: 'استدعاء وعزل تشغيلة دوائية',
  test_integration: 'اختبار تكامل/جهاز خارجي',
  create_checkpoint: 'إنشاء نقطة استعادة سريعة (SHA-256)',
  restore_checkpoint: 'استعادة نظام من نقطة تعافي',
};

export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  user: 'المستخدمين والصلاحيات',
  sold: 'فواتير المبيعات (POS)',
  invoice: 'أرشيف الفواتير',
  sales_return: 'مرتجعات المبيعات',
  pos_shift: 'ورديات الكاشير',
  medicine: 'الأدوية والأصناف',
  category: 'التصنيفات الدوائية',
  batch: 'التشغيلات والصلاحية',
  warehouse: 'المستودعات',
  stock_transfer: 'التحويلات المخزنية',
  supplier: 'الموردين',
  purchase_order: 'طلبات وفواتير الشراء',
  purchase_return: 'مرتجعات المشتريات',
  customer: 'العملاء والذمم',
  doctor: 'الأطباء',
  prescription: 'الوصفات الطبية',
  account: 'شجرة الحسابات',
  journal_entry: 'القيود المحاسبية',
  voucher: 'سندات القبض والصرف',
  employee: 'ملفات الموظفين',
  employee_tx: 'الرواتب والسلف والعمولات',
  site: 'إعدادات النظام والعملة',
  database: 'قاعدة البيانات الكاملة',
  clinical_interaction: 'التداخلات الدوائية',
  controlled_drug: 'سجل الأدوية المقيدة',
  insurance_company: 'شركات التأمين',
  insurance_claim: 'مطالبات التأمين',
  drug_recall: 'استدعاءات الأدوية والتوريد',
  promotion: 'العروض والتسعير الترويجي',
  operating_expense: 'المصروفات التشغيلية',
  integration: 'التكاملات والأجهزة الخارجية',
};

const HIGH_SENSITIVITY_ACTIONS = new Set([
  'delete',
  'cancel',
  'block_user',
  'import_database',
  'export_database',
  'create_checkpoint',
  'restore_checkpoint',
  'controlled_dispense',
  'recall_quarantine',
  'update_site',
  'sales_return',
  'purchase_return',
  'stocktake',
  'status_change',
  'close_shift',
]);

const MEDIUM_SENSITIVITY_ACTIONS = new Set([
  'allow_user',
  'approve',
  'receive',
  'checkout',
  'update',
  'open_shift',
  'test_integration',
]);

export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] || action;
}

export function getAuditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] || entityType;
}

export function getAuditSeverity(log: Pick<AuditLogRecord, 'action' | 'entity_type'>): AuditSeverity {
  if (HIGH_SENSITIVITY_ACTIONS.has(log.action)) {
    return 'high';
  }
  if (log.entity_type === 'user' && (log.action === 'create' || log.action === 'update')) {
    return 'high';
  }
  if (log.entity_type === 'site' || log.entity_type === 'database') {
    return 'high';
  }
  if (
    MEDIUM_SENSITIVITY_ACTIONS.has(log.action) ||
    log.entity_type === 'voucher' ||
    log.entity_type === 'journal_entry' ||
    log.entity_type === 'account' ||
    log.entity_type === 'employee_tx'
  ) {
    return 'medium';
  }
  return 'low';
}

export function getAuditSeverityBadge(severity: AuditSeverity): {
  label: string;
  className: string;
} {
  if (severity === 'high') {
    return {
      label: 'عملية حساسة',
      className: 'bg-red-100 text-red-800 border border-red-200',
    };
  }
  if (severity === 'medium') {
    return {
      label: 'إجراء إداري/مالي',
      className: 'bg-amber-100 text-amber-800 border border-amber-200',
    };
  }
  return {
    label: 'نشاط اعتيادي',
    className: 'bg-slate-100 text-slate-700 border border-slate-200',
  };
}
