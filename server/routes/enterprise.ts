import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  sqlite,
  sessions,
  currentTimestamp,
  getSiteSettings,
  syncMedicineFromBatches,
  postJournalEntry,
  logAudit,
  rowToUser,
  resolvePharmacyAccountId,
} from '../db.ts';
import {
  requireAuth,
  requirePermission,
  findUserById,
  sanitizeUser,
  computeAlerts,
  getPharmacyId,
  type AuthedRequest,
} from '../middleware.ts';
import { buildBackupPayload, restoreTenantScopedTables } from './backup.ts';

function buildZatcaTlvBase64(params: {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string;
  vatAmount: string;
}): string {
  const tags: Array<[number, string]> = [
    [1, params.sellerName],
    [2, params.vatNumber],
    [3, params.timestamp],
    [4, params.totalWithVat],
    [5, params.vatAmount],
  ];
  const chunks: Buffer[] = [];
  for (const [tag, value] of tags) {
    const valBuf = Buffer.from(value, 'utf8');
    chunks.push(Buffer.from([tag, Math.min(255, valBuf.length)]));
    chunks.push(valBuf.subarray(0, 255));
  }
  return Buffer.concat(chunks).toString('base64');
}

export function registerEnterpriseRoutes(app: Express): void {
  // =========================================================================
  // 0. Live System Readiness & Gap Assessment
  // =========================================================================
  app.get('/api/system-evaluation', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const countOf = (sql: string, ...args: Array<string | number>) =>
      Number((sqlite.prepare(sql).get(...args) as { cnt: number } | undefined)?.cnt ?? 0);

    const medCount = countOf('SELECT COUNT(*) AS cnt FROM inventeries WHERE pharmacy_id = ?', pharmId);
    const batchCount = countOf(
      'SELECT COUNT(*) AS cnt FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id WHERE i.pharmacy_id = ?',
      pharmId,
    );
    const warehouseCount = countOf('SELECT COUNT(*) AS cnt FROM warehouses WHERE pharmacy_id = ? AND is_active = 1', pharmId);
    const activeBranchCount = countOf(
      'SELECT COUNT(*) AS cnt FROM warehouses WHERE pharmacy_id = ? AND is_active = 1 AND is_branch_pos = 1',
      pharmId,
    );
    const salesCount = countOf("SELECT COUNT(*) AS cnt FROM sold WHERE pharmacy_id = ? AND status = 'completed'", pharmId);
    const purchaseCount = countOf('SELECT COUNT(*) AS cnt FROM purchase_orders WHERE pharmacy_id = ?', pharmId);
    const supplierCount = countOf('SELECT COUNT(*) AS cnt FROM supplier WHERE pharmacy_id = ?', pharmId);
    const customerCount = countOf('SELECT COUNT(*) AS cnt FROM customers WHERE pharmacy_id = ?', pharmId);
    const rxCount = countOf('SELECT COUNT(*) AS cnt FROM prescriptions WHERE pharmacy_id = ?', pharmId);
    const journalCount = countOf('SELECT COUNT(*) AS cnt FROM journal_entries WHERE pharmacy_id = ?', pharmId);
    const employeeCount = countOf('SELECT COUNT(*) AS cnt FROM employees WHERE pharmacy_id = ? AND is_active = 1', pharmId);
    const userCount = countOf(
      "SELECT COUNT(*) AS cnt FROM users WHERE pharmacy_id = ? AND role != 'developer' AND is_active = 1",
      pharmId,
    );
    const auditCount = countOf('SELECT COUNT(*) AS cnt FROM audit_logs WHERE pharmacy_id = ?', pharmId);

    const interactionCount = countOf('SELECT COUNT(*) AS cnt FROM drug_interactions');
    const controlledMedCount = countOf('SELECT COUNT(*) AS cnt FROM inventeries WHERE pharmacy_id = ? AND is_controlled = 1', pharmId);
    const controlledLogCount = countOf('SELECT COUNT(*) AS cnt FROM controlled_dispense_logs WHERE pharmacy_id = ?', pharmId);
    const insuranceCompanyCount = countOf(
      'SELECT COUNT(*) AS cnt FROM insurance_companies WHERE pharmacy_id = ? AND is_active = 1',
      pharmId,
    );
    const insuranceClaimCount = countOf('SELECT COUNT(*) AS cnt FROM insurance_claims WHERE pharmacy_id = ?', pharmId);
    const recallCount = countOf('SELECT COUNT(*) AS cnt FROM drug_recalls WHERE pharmacy_id = ?', pharmId);
    const promoCount = countOf('SELECT COUNT(*) AS cnt FROM promotions WHERE pharmacy_id = ? AND is_active = 1', pharmId);
    const expenseCount = countOf('SELECT COUNT(*) AS cnt FROM operating_expenses WHERE pharmacy_id = ?', pharmId);
    const integrationEnabledCount = countOf('SELECT COUNT(*) AS cnt FROM integration_configs WHERE enabled = 1');
    const integrationTestedCount = countOf("SELECT COUNT(*) AS cnt FROM integration_configs WHERE last_tested_at != ''");
    const snapshotCount = countOf('SELECT COUNT(*) AS cnt FROM backup_snapshots WHERE pharmacy_id = ?', pharmId);

    const alerts = computeAlerts(pharmId);
    const expiredActiveBatches = countOf(
      `SELECT COUNT(*) AS cnt FROM medicine_batches b
       JOIN inventeries i ON i.id = b.medicine_id
       WHERE i.pharmacy_id = ? AND b.status = 'active' AND b.qty_remaining > 0 AND b.expiry_date != '' AND b.expiry_date < ?`,
      pharmId,
      new Date().toISOString().slice(0, 10),
    );
    const pendingInsuranceClaims = countOf(
      "SELECT COUNT(*) AS cnt FROM insurance_claims WHERE pharmacy_id = ? AND status IN ('pending', 'submitted')",
      pharmId,
    );

    const coreModules = [
      {
        key: 'pos',
        title: 'المبيعات ونقطة البيع (POS)',
        status: 'complete',
        score: salesCount > 0 ? 100 : 90,
        evidence: `${salesCount} فاتورة مكتملة · دعم الورديات، التعليق، المرتجعات، والبحث بالبداية`,
        actionPage: 'billing',
      },
      {
        key: 'inventory',
        title: 'الأدوية والتشغيلات والمخازن (FEFO)',
        status: 'complete',
        score: medCount > 0 && batchCount > 0 ? 100 : 85,
        evidence: `${medCount} صنف · ${batchCount} تشغيلة FEFO · ${warehouseCount} مستودعات`,
        actionPage: 'inventories',
      },
      {
        key: 'purchasing',
        title: 'المشتريات والموردون',
        status: 'complete',
        score: supplierCount > 0 ? 100 : 85,
        evidence: `${supplierCount} مورد · ${purchaseCount} أمر شراء · مقارنة الأسعار وكشف الحساب`,
        actionPage: 'purchases',
      },
      {
        key: 'clinical_customers',
        title: 'العملاء والأطباء والوصفات',
        status: 'complete',
        score: customerCount > 0 ? 100 : 85,
        evidence: `${customerCount} عميل · ${rxCount} وصفة طبية مرتبطة بنقطة البيع`,
        actionPage: 'customers',
      },
      {
        key: 'accounting_hr',
        title: 'الحسابات والموظفون والرواتب',
        status: 'complete',
        score: journalCount > 0 && employeeCount > 0 ? 100 : 90,
        evidence: `${journalCount} قيد محاسبي مزدوج · ${employeeCount} موظف نشط`,
        actionPage: 'accounting',
      },
      {
        key: 'reports_rbac',
        title: 'التقارير والمستخدمون والصلاحيات',
        status: 'complete',
        score: userCount > 0 ? 100 : 90,
        evidence: `${userCount} مستخدم نشط · 7 أدوار و26 صلاحية تفصيلية`,
        actionPage: 'users',
      },
      {
        key: 'audit',
        title: 'سجل التدقيق والعمليات الحساسة',
        status: 'complete',
        score: auditCount > 0 ? 100 : 90,
        evidence: `${auditCount} حدث تدقيقي موثق مع تصنيف الخطورة والتصدير`,
        actionPage: 'hrAudit',
      },
    ];

    const expansionModules = [
      {
        key: 'clinical_vigilance',
        title: 'الإدارة الدوائية والرقابة السريرية',
        previousGap: 'تغطية جزئية',
        status: 'implemented',
        score: interactionCount >= 5 ? 100 : 85,
        details: `${interactionCount} قاعدة تداخل دوائي فعّالة · فحص التداخلات والحساسية حي في POS`,
        tab: 'clinical',
      },
      {
        key: 'insurance_complex_rx',
        title: 'إدارة التأمين والوصفات المعقدة',
        previousGap: 'غير مطبقة',
        status: 'implemented',
        score: insuranceCompanyCount > 0 ? 100 : 80,
        details: `${insuranceCompanyCount} شركة تأمين · ${insuranceClaimCount} مطالبة تأمينية · دعم الوصفات المزمنة وإعادة الصرف`,
        tab: 'insurance',
      },
      {
        key: 'supply_recalls',
        title: 'تتبع سلسلة التوريد والاستدعاءات',
        previousGap: 'جزئية',
        status: 'implemented',
        score: 100,
        details: `محرك تتبع التشغيلة من المورد حتى الفاتورة · ${recallCount} سجل استدعاء/حجر نشط`,
        tab: 'recalls',
      },
      {
        key: 'multi_branch',
        title: 'إدارة الفروع والتشغيل متعدد الصيدليات',
        previousGap: 'تحتاج توسعاً',
        status: 'implemented',
        score: activeBranchCount >= 2 ? 100 : 85,
        details: `${activeBranchCount} فروع مبيعات ومخازن نشطة بمؤشرات أهداف يومية وتحويلات بين الفروع`,
        tab: 'branches',
      },
      {
        key: 'pricing_loyalty',
        title: 'إدارة التسعير والعروض والولاء',
        previousGap: 'مفقودة',
        status: 'implemented',
        score: promoCount > 0 ? 100 : 85,
        details: `${promoCount} عرض ترويجي نشط + نقاط ولاء العملاء وكسب/استبدال تلقائي في POS`,
        tab: 'loyalty',
      },
      {
        key: 'expenses_profitability',
        title: 'إدارة المصروفات والتكاليف والربحية المتقدمة',
        previousGap: 'جزئية',
        status: 'implemented',
        score: 100,
        details: `مراكز التكلفة والمصروفات التشغيلية (${expenseCount} سجل) + صافي الربح بعد COGS والمصروفات والرواتب`,
        tab: 'analytics',
      },
      {
        key: 'controlled_drugs',
        title: 'الرقابة على الأدوية المقيدة',
        previousGap: 'لا توجد',
        status: 'implemented',
        score: 100,
        details: `حظر الصرف بدون هوية ووصفة في POS · ${controlledMedCount} صنف مقيد · ${controlledLogCount} سجل صرف رقابي`,
        tab: 'clinical',
      },
      {
        key: 'integrations',
        title: 'التكاملات الخارجية والأجهزة',
        previousGap: 'بدائية',
        status: integrationTestedCount > 0 ? 'implemented' : 'configured',
        score: integrationEnabledCount >= 3 ? (integrationTestedCount > 0 ? 100 : 90) : 75,
        details: `${integrationEnabledCount} تكاملات مفعلة (الباركود، الحرارية 80mm، ZATCA TLV QR، بوابة التأمين)`,
        tab: 'integrations',
      },
      {
        key: 'disaster_recovery',
        title: 'النسخ الاحتياطي والتعافي من الكوارث',
        previousGap: 'جزئية',
        status: 'implemented',
        score: snapshotCount > 0 ? 100 : 90,
        details: `تصدير/استيراد JSON كامل + ${snapshotCount} نقطة استعادة سريعة ببصمة SHA-256`,
        tab: 'integrations',
      },
      {
        key: 'smart_analytics',
        title: 'التحليلات الذكية ومؤشرات الأداء',
        previousGap: 'أساسية',
        status: 'implemented',
        score: 100,
        details: 'تصنيف ABC للمخزون، توقعات أيام التغطية وإعادة الطلب، وقيمة المخزون المعرض للانتهاء',
        tab: 'analytics',
      },
    ];

    const operationalFindings: Array<{ severity: 'warning' | 'info' | 'ok'; title: string; actionLabel: string; targetTab: string }> = [];
    if (expiredActiveBatches > 0) {
      operationalFindings.push({
        severity: 'warning',
        title: `توجد (${expiredActiveBatches}) تشغيلة منتهية الصلاحية ما زالت بحالة نشطة — يوصى بعزلها`,
        actionLabel: 'فحص التشغيلات',
        targetTab: 'recalls',
      });
    }
    if (alerts.outOfStock.length > 0 || alerts.lowStock.length > 0) {
      operationalFindings.push({
        severity: 'warning',
        title: `تنبيه مخزون: ${alerts.outOfStock.length} صنف نافد و${alerts.lowStock.length} صنف دون الحد الأدنى`,
        actionLabel: 'توقعات إعادة الطلب',
        targetTab: 'analytics',
      });
    }
    if (pendingInsuranceClaims > 0) {
      operationalFindings.push({
        severity: 'info',
        title: `توجد (${pendingInsuranceClaims}) مطالبة تأمينية بانتظار الاعتماد والتحصيل`,
        actionLabel: 'إدارة المطالبات',
        targetTab: 'insurance',
      });
    }
    if (snapshotCount === 0) {
      operationalFindings.push({
        severity: 'info',
        title: 'لم يتم إنشاء نقطة استعادة سريعة (Disaster Recovery Snapshot) بعد — يوصى بأخذ لقطة احتياطية الآن',
        actionLabel: 'إنشاء نقطة استعادة',
        targetTab: 'integrations',
      });
    }
    if (integrationTestedCount === 0) {
      operationalFindings.push({
        severity: 'info',
        title: 'يمكنك تشغيل اختبار سريع للتكاملات والأجهزة (ZATCA QR والباركود والطابعة) لتوثيق الجاهزية 100%',
        actionLabel: 'اختبار التكاملات',
        targetTab: 'integrations',
      });
    }

    const overallCoreScore = Math.round(coreModules.reduce((s, m) => s + m.score, 0) / coreModules.length);
    const overallExpansionScore = Math.round(
      expansionModules.reduce((s, m) => s + m.score, 0) / expansionModules.length,
    );
    const overallScore = Math.round((overallCoreScore + overallExpansionScore) / 2);

    return res.json({
      evaluatedAt: currentTimestamp(),
      overallScore,
      overallCoreScore,
      overallExpansionScore,
      coreModules,
      expansionModules,
      operationalFindings,
    });
  });

  // =========================================================================
  // 1 & 7. Clinical Interactions & Controlled Substances
  // =========================================================================
  app.get('/api/clinical/interactions', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const interactions = sqlite.prepare('SELECT * FROM drug_interactions WHERE pharmacy_id = ? ORDER BY id DESC').all(pharmId);
    return res.json({ interactions });
  });

  app.post('/api/clinical/interactions', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const ingredientA = String(req.body?.ingredientA ?? '').trim();
    const ingredientB = String(req.body?.ingredientB ?? '').trim();
    const severity = ['major', 'moderate', 'minor'].includes(String(req.body?.severity))
      ? String(req.body.severity)
      : 'moderate';
    const clinicalEffect = String(req.body?.clinicalEffect ?? '').trim();
    const recommendation = String(req.body?.recommendation ?? '').trim();

    if (!ingredientA || !ingredientB || !clinicalEffect) {
      return res.status(400).json({ error: 'يرجى إدخال المادتين الفعالتين والأثر السريري للتداخل' });
    }

    const info = sqlite
      .prepare(
        'INSERT INTO drug_interactions (ingredient_a, ingredient_b, severity, clinical_effect, recommendation, pharmacy_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ingredientA, ingredientB, severity, clinicalEffect, recommendation, pharmId, currentTimestamp());
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'clinical_interaction',
      entityId: id,
      details: `إضافة قاعدة تداخل دوائي: ${ingredientA} × ${ingredientB} (${severity})`,
      pharmacyId: pharmId,
    });
    const interaction = sqlite.prepare('SELECT * FROM drug_interactions WHERE id = ? AND pharmacy_id = ?').get(id, pharmId);
    return res.status(201).json({ interaction });
  });

  app.delete('/api/clinical/interactions/:id', requireAuth, requirePermission('manageMedicines'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const info = sqlite.prepare('DELETE FROM drug_interactions WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    if (info.changes === 0) return res.status(404).json({ error: 'قاعدة التداخل غير موجودة' });
    return res.json({ ok: true });
  });

  // Live clinical check for POS cart & patient safety
  app.post('/api/clinical/check-cart', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const medicineIds = Array.isArray(req.body?.medicineIds)
      ? (req.body.medicineIds as unknown[]).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0)
      : [];
    const customerId = req.body?.customerId ? Number(req.body.customerId) : null;

    if (medicineIds.length === 0) {
      return res.json({ alerts: [], interactionWarnings: [], controlledMedicines: [] });
    }

    const placeholders = medicineIds.map(() => '?').join(',');
    const meds = sqlite
      .prepare(
        `SELECT id, name, scientific_name, active_ingredient, requires_prescription, is_controlled, controlled_schedule, max_daily_dose, pregnancy_category
         FROM inventeries WHERE pharmacy_id = ? AND id IN (${placeholders})`,
      )
      .all(pharmId, ...medicineIds) as Array<Record<string, unknown>>;

    const allInteractions = sqlite.prepare('SELECT * FROM drug_interactions WHERE pharmacy_id = ?').all(pharmId) as Array<{
      id: number;
      ingredient_a: string;
      ingredient_b: string;
      severity: string;
      clinical_effect: string;
      recommendation: string;
    }>;

    const interactionWarnings: Array<{
      severity: string;
      pair: string;
      effect: string;
      recommendation: string;
    }> = [];

    const textFor = (m: Record<string, unknown>) =>
      `${String(m.name || '')} ${String(m.scientific_name || '')} ${String(m.active_ingredient || '')}`.toLowerCase();

    for (let i = 0; i < meds.length; i++) {
      for (let j = i + 1; j < meds.length; j++) {
        const t1 = textFor(meds[i]);
        const t2 = textFor(meds[j]);
        for (const rule of allInteractions) {
          const a = rule.ingredient_a.toLowerCase();
          const b = rule.ingredient_b.toLowerCase();
          if ((t1.includes(a) && t2.includes(b)) || (t1.includes(b) && t2.includes(a))) {
            interactionWarnings.push({
              severity: rule.severity,
              pair: `${String(meds[i].name)} + ${String(meds[j].name)} (${rule.ingredient_a} / ${rule.ingredient_b})`,
              effect: rule.clinical_effect,
              recommendation: rule.recommendation,
            });
          }
        }
      }
    }

    const alerts: Array<{ type: string; severity: string; message: string }> = [];
    if (customerId) {
      const cust = sqlite
        .prepare('SELECT name, allergies, chronic_conditions FROM customers WHERE id = ? AND pharmacy_id = ?')
        .get(customerId, pharmId) as { name: string; allergies: string; chronic_conditions: string } | undefined;
      if (cust && cust.allergies.trim()) {
        const allergyTokens = cust.allergies
          .split(/[,،\s]+/)
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length >= 3);
        for (const med of meds) {
          const mt = textFor(med);
          for (const tok of allergyTokens) {
            if (mt.includes(tok)) {
              alerts.push({
                type: 'allergy',
                severity: 'major',
                message: `تحذير حساسية للمريض ${cust.name}: الصنف "${String(med.name)}" قد يتعارض مع حساسية مسجلة (${cust.allergies})`,
              });
            }
          }
        }
      }
    }

    const controlledMedicines = meds
      .filter((m) => Number(m.is_controlled) === 1)
      .map((m) => ({
        id: Number(m.id),
        name: String(m.name),
        schedule: String(m.controlled_schedule || 'مراقب صرفاً'),
      }));

    return res.json({ alerts, interactionWarnings, controlledMedicines });
  });

  app.get('/api/controlled-logs', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const limit = Math.min(500, Math.max(20, Number(req.query.limit) || 200));
    const logs = sqlite
      .prepare('SELECT * FROM controlled_dispense_logs WHERE pharmacy_id = ? ORDER BY id DESC LIMIT ?')
      .all(pharmId, limit);
    return res.json({ logs });
  });

  app.post('/api/controlled-logs', requireAuth, requirePermission('posBilling'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const medicineId = Number(req.body?.medicineId);
    const patientName = String(req.body?.patientName ?? '').trim();
    const patientNationalId = String(req.body?.patientNationalId ?? '').trim();
    const doctorName = String(req.body?.doctorName ?? '').trim();
    const doctorLicense = String(req.body?.doctorLicense ?? '').trim();
    const prescriptionNumber = String(req.body?.prescriptionNumber ?? '').trim();
    const qty = Math.max(1, Number(req.body?.qty ?? 1));
    const notes = String(req.body?.notes ?? '').trim();

    const med = sqlite
      .prepare('SELECT id, name, controlled_schedule FROM inventeries WHERE id = ? AND pharmacy_id = ?')
      .get(medicineId, pharmId) as { id: number; name: string; controlled_schedule: string } | undefined;
    if (!med) return res.status(404).json({ error: 'الدواء غير موجود' });
    if (!patientName || !patientNationalId || !prescriptionNumber) {
      return res.status(400).json({ error: 'اسم المريض ورقم الهوية ورقم الوصفة الطبية حقول إلزامية للأدوية المقيدة' });
    }

    const defaultWh = sqlite.prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId) as
      | { id: number }
      | undefined;

    const info = sqlite
      .prepare(
        `INSERT INTO controlled_dispense_logs
          (sold_id, medicine_id, medicine_name, schedule, patient_name, patient_national_id, doctor_name, doctor_license, prescription_number, qty, warehouse_id, pharmacist_id, pharmacist_name, notes, pharmacy_id, dispensed_at)
         VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        med.id,
        med.name,
        med.controlled_schedule || 'مراقب صرفاً',
        patientName,
        patientNationalId,
        doctorName,
        doctorLicense,
        prescriptionNumber,
        qty,
        defaultWh?.id || 1,
        user.id,
        user.name,
        notes,
        pharmId,
        currentTimestamp(),
      );
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'controlled_dispense',
      entityType: 'controlled_drug',
      entityId: id,
      details: `توثيق سجل دواء مقيد "${med.name}" للمريض ${patientName} (${patientNationalId}) بوصفة ${prescriptionNumber}`,
      pharmacyId: pharmId,
    });
    const log = sqlite.prepare('SELECT * FROM controlled_dispense_logs WHERE id = ?').get(id);
    return res.status(201).json({ log });
  });

  // =========================================================================
  // 2. Insurance Companies & Claims
  // =========================================================================
  app.get('/api/insurance/companies', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const companies = sqlite
      .prepare(
        `SELECT ic.*,
                (SELECT COUNT(*) FROM insurance_claims cl WHERE cl.insurance_id = ic.id AND cl.pharmacy_id = ic.pharmacy_id) AS claimCount
         FROM insurance_companies ic WHERE ic.pharmacy_id = ? ORDER BY ic.id ASC`,
      )
      .all(pharmId);
    return res.json({ companies });
  });

  app.post('/api/insurance/companies', requireAuth, requirePermission('manageCustomers'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    const contactPhone = String(req.body?.contactPhone ?? '').trim();
    const defaultCoveragePct = Math.min(100, Math.max(0, Number(req.body?.defaultCoveragePct ?? 80)));
    const maxClaimLimit = Math.max(0, Number(req.body?.maxClaimLimit ?? 5000));

    if (!name) return res.status(400).json({ error: 'اسم شركة التأمين مطلوب' });

    const info = sqlite
      .prepare(
        `INSERT INTO insurance_companies (name, code, contact_phone, default_coverage_pct, max_claim_limit, balance, is_active, pharmacy_id, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 1, ?, ?)`,
      )
      .run(name, code, contactPhone, defaultCoveragePct, maxClaimLimit, pharmId, currentTimestamp());
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'insurance_company',
      entityId: id,
      details: `إضافة شركة تأمين: ${name} (تغطية افتراضية ${defaultCoveragePct}%)`,
      pharmacyId: pharmId,
    });
    const company = sqlite.prepare('SELECT * FROM insurance_companies WHERE id = ?').get(id);
    return res.status(201).json({ company });
  });

  app.put('/api/insurance/companies/:id', requireAuth, requirePermission('manageCustomers'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM insurance_companies WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'شركة التأمين غير موجودة' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name);
    const code = req.body?.code !== undefined ? String(req.body.code).trim().toUpperCase() : String(existing.code);
    const contactPhone =
      req.body?.contactPhone !== undefined ? String(req.body.contactPhone).trim() : String(existing.contact_phone);
    const defaultCoveragePct =
      req.body?.defaultCoveragePct !== undefined
        ? Math.min(100, Math.max(0, Number(req.body.defaultCoveragePct)))
        : Number(existing.default_coverage_pct);
    const maxClaimLimit =
      req.body?.maxClaimLimit !== undefined ? Math.max(0, Number(req.body.maxClaimLimit)) : Number(existing.max_claim_limit);
    const isActive = req.body?.isActive !== undefined ? (req.body.isActive ? 1 : 0) : Number(existing.is_active);

    sqlite
      .prepare(
        'UPDATE insurance_companies SET name = ?, code = ?, contact_phone = ?, default_coverage_pct = ?, max_claim_limit = ?, is_active = ? WHERE id = ? AND pharmacy_id = ?',
      )
      .run(name, code, contactPhone, defaultCoveragePct, maxClaimLimit, isActive, id, pharmId);

    const company = sqlite.prepare('SELECT * FROM insurance_companies WHERE id = ?').get(id);
    return res.json({ company });
  });

  app.get('/api/insurance/claims', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const claims = sqlite
      .prepare('SELECT * FROM insurance_claims WHERE pharmacy_id = ? ORDER BY id DESC LIMIT 200')
      .all(pharmId);
    return res.json({ claims });
  });

  app.patch('/api/insurance/claims/:id/status', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? '').trim();
    const reqCashBoxId = req.body?.cashBoxId ? Number(req.body.cashBoxId) : 0;
    if (!['pending', 'submitted', 'approved', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'حالة المطالبة غير صالحة' });
    }

    const claim = sqlite.prepare('SELECT * FROM insurance_claims WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | {
          id: number;
          claim_number: string;
          insurance_id: number;
          insurance_name: string;
          insurance_share: number;
          status: string;
        }
      | undefined;
    if (!claim) return res.status(404).json({ error: 'المطالبة غير موجودة' });
    if (claim.status === 'paid' && status !== 'paid') {
      return res.status(400).json({ error: 'لا يمكن تغيير حالة مطالبة تم تحصيلها محاسبياً بالفعل' });
    }

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      sqlite.prepare('UPDATE insurance_claims SET status = ? WHERE id = ? AND pharmacy_id = ?').run(status, id, pharmId);
      if (status === 'paid' && claim.status !== 'paid' && claim.insurance_share > 0) {
        const cashBox = (
          reqCashBoxId
            ? sqlite.prepare('SELECT * FROM cash_boxes WHERE id = ? AND pharmacy_id = ?').get(reqCashBoxId, pharmId)
            : sqlite
                .prepare("SELECT * FROM cash_boxes WHERE pharmacy_id = ? ORDER BY CASE WHEN box_type = 'bank' THEN 0 ELSE 1 END, id ASC LIMIT 1")
                .get(pharmId)
        ) as
          | { id: number; name: string; account_id: number }
          | undefined;
        const targetAccId = cashBox?.account_id || resolvePharmacyAccountId(pharmId, '1020');
        const insReceivableAccId = resolvePharmacyAccountId(pharmId, '1050');
        sqlite
          .prepare('UPDATE insurance_companies SET balance = MAX(0, ROUND(balance - ?, 2)) WHERE id = ? AND pharmacy_id = ?')
          .run(claim.insurance_share, claim.insurance_id, pharmId);
        postJournalEntry({
          description: `تحصيل مطالبة تأمين #${claim.claim_number} من ${claim.insurance_name}`,
          referenceType: 'insurance_claim',
          referenceId: claim.id,
          userId: user.id,
          pharmacyId: pharmId,
          lines: [
            { accountId: targetAccId, debit: claim.insurance_share, credit: 0, notes: cashBox?.name || 'البنك' },
            { accountId: insReceivableAccId, debit: 0, credit: claim.insurance_share, notes: claim.insurance_name },
          ],
        });
      }
      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'status_change',
        entityType: 'insurance_claim',
        entityId: id,
        details: `تحديث حالة مطالبة التأمين #${claim.claim_number} إلى (${status})`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }

    const updated = sqlite.prepare('SELECT * FROM insurance_claims WHERE id = ?').get(id);
    return res.json({ claim: updated });
  });

  // =========================================================================
  // 3. Supply Chain Traceability & Drug Recalls
  // =========================================================================
  app.get('/api/supply-chain/recalls', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const recalls = sqlite
      .prepare('SELECT * FROM drug_recalls WHERE pharmacy_id = ? ORDER BY id DESC')
      .all(pharmId);
    return res.json({ recalls });
  });

  app.post('/api/supply-chain/recalls', requireAuth, requirePermission('manageBatches'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const medicineId = Number(req.body?.medicineId);
    const batchNumber = String(req.body?.batchNumber ?? '').trim();
    const source = String(req.body?.source ?? 'sfda').trim();
    const severity = String(req.body?.severity ?? 'class_2').trim();
    const reason = String(req.body?.reason ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();

    if (!medicineId || !batchNumber || !reason) {
      return res.status(400).json({ error: 'يرجى تحديد الدواء ورقم التشغيلة وسبب الاستدعاء' });
    }
    const med = sqlite.prepare('SELECT id, name FROM inventeries WHERE id = ? AND pharmacy_id = ?').get(medicineId, pharmId) as
      | { id: number; name: string }
      | undefined;
    if (!med) return res.status(404).json({ error: 'الدواء غير موجود' });

    const matchingBatches = sqlite
      .prepare('SELECT id, qty_remaining FROM medicine_batches WHERE medicine_id = ? AND batch_number = ?')
      .all(medicineId, batchNumber) as Array<{ id: number; qty_remaining: number }>;

    const affectedQty = Number(
      matchingBatches.reduce((s, b) => s + (Number(b.qty_remaining) || 0), 0).toFixed(4),
    );
    const recallNumber = `RCL-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      // Auto-quarantine all batches matching this recall so POS immediately blocks dispensing
      sqlite
        .prepare("UPDATE medicine_batches SET status = 'quarantined' WHERE medicine_id = ? AND batch_number = ?")
        .run(medicineId, batchNumber);
      syncMedicineFromBatches(medicineId);

      const info = sqlite
        .prepare(
          `INSERT INTO drug_recalls
            (recall_number, medicine_id, medicine_name, batch_id, batch_number, source, severity, reason, affected_qty, status, initiated_by, initiated_by_name, notes, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'quarantined', ?, ?, ?, ?, ?)`,
        )
        .run(
          recallNumber,
          med.id,
          med.name,
          matchingBatches[0]?.id ?? null,
          batchNumber,
          source,
          severity,
          reason,
          affectedQty,
          user.id,
          user.name,
          notes,
          pharmId,
          currentTimestamp(),
        );
      const id = Number(info.lastInsertRowid);

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'recall_quarantine',
        entityType: 'drug_recall',
        entityId: id,
        details: `استدعاء وعزل فوري للتشغيلة "${batchNumber}" من "${med.name}" (${affectedQty} علبة) - السبب: ${reason}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');

      const recall = sqlite.prepare('SELECT * FROM drug_recalls WHERE id = ?').get(id);
      return res.status(201).json({ recall });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  app.patch('/api/supply-chain/recalls/:id/status', requireAuth, requirePermission('manageBatches'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const status = String(req.body?.status ?? '').trim();
    if (!['active', 'quarantined', 'returned_to_supplier', 'resolved'].includes(status)) {
      return res.status(400).json({ error: 'حالة الاستدعاء غير صالحة' });
    }
    const existing = sqlite.prepare('SELECT * FROM drug_recalls WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { id: number; recall_number: string; medicine_id: number; batch_number: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'سجل الاستدعاء غير موجود' });

    sqlite.prepare('UPDATE drug_recalls SET status = ? WHERE id = ? AND pharmacy_id = ?').run(status, id, pharmId);
    if (status === 'resolved') {
      sqlite
        .prepare("UPDATE medicine_batches SET status = 'active' WHERE medicine_id = ? AND batch_number = ? AND status = 'quarantined'")
        .run(existing.medicine_id, existing.batch_number);
      syncMedicineFromBatches(existing.medicine_id);
    }
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'status_change',
      entityType: 'drug_recall',
      entityId: id,
      details: `تحديث حالة استدعاء ${existing.recall_number} إلى ${status}`,
      pharmacyId: pharmId,
    });
    const recall = sqlite.prepare('SELECT * FROM drug_recalls WHERE id = ?').get(id);
    return res.json({ recall });
  });

  app.get('/api/supply-chain/trace-batch', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const q = String(req.query.batchNumber ?? '').trim();
    if (!q) {
      return res.status(400).json({ error: 'يرجى إدخال رقم التشغيلة للتتبع' });
    }
    const batches = sqlite
      .prepare(
        `SELECT b.*, i.name AS medicine_name, i.barcode, w.name AS warehouse_name
         FROM medicine_batches b
         JOIN inventeries i ON i.id = b.medicine_id
         LEFT JOIN warehouses w ON w.id = b.warehouse_id
         WHERE i.pharmacy_id = ? AND b.batch_number LIKE ?`,
      )
      .all(pharmId, `%${q}%`);
    const purchaseOrders = sqlite
      .prepare(
        `SELECT po.id, po.supplier_name, po.invoice_number, po.status, po.created_at, poi.medicine_name, poi.qty, poi.batch_number
         FROM purchase_order_items poi
         JOIN purchase_orders po ON po.id = poi.po_id
         WHERE po.pharmacy_id = ? AND poi.batch_number LIKE ?
         ORDER BY po.id DESC`,
      )
      .all(pharmId, `%${q}%`);
    const movements = sqlite
      .prepare(
        `SELECT m.*, COALESCE(w.name, 'الرئيسي') AS warehouse_name
         FROM stock_movements m
         LEFT JOIN warehouses w ON w.id = m.warehouse_id
         WHERE m.pharmacy_id = ? AND m.batch_number LIKE ?
         ORDER BY m.id DESC LIMIT 100`,
      )
      .all(pharmId, `%${q}%`);
    const affectedInvoices = sqlite
      .prepare(
        `SELECT s.id AS sold_id, s.name AS customer_name, s.contact, s.date, si.medicineId, si.name AS medicine_name, si.qty, si.batchNumber
         FROM sold_items si
         JOIN sold s ON s.id = si.soldId
         WHERE s.pharmacy_id = ? AND si.batchNumber LIKE ?
         ORDER BY s.id DESC LIMIT 100`,
      )
      .all(pharmId, `%${q}%`);
    const recalls = sqlite
      .prepare('SELECT * FROM drug_recalls WHERE pharmacy_id = ? AND batch_number LIKE ? ORDER BY id DESC')
      .all(pharmId, `%${q}%`);

    return res.json({ batchQuery: q, batches, purchaseOrders, movements, affectedInvoices, recalls });
  });

  // =========================================================================
  // 4. Multi-Branch Pharmacy Operations
  // =========================================================================
  app.get('/api/branches', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const today = currentTimestamp().slice(0, 10);
    const rows = sqlite
      .prepare(
        `SELECT w.*,
                (SELECT COALESCE(SUM(b.qty_remaining), 0) FROM medicine_batches b WHERE b.warehouse_id = w.id AND b.status = 'active') AS totalUnits,
                (SELECT COALESCE(SUM(b.qty_remaining * b.purchase_price), 0) FROM medicine_batches b WHERE b.warehouse_id = w.id AND b.status = 'active') AS costValuation,
                (SELECT COUNT(*) FROM sold s WHERE s.warehouse_id = w.id AND s.pharmacy_id = w.pharmacy_id AND s.status = 'completed') AS totalInvoices,
                (SELECT COALESCE(SUM(COALESCE(s.base_amount, CAST(s.amount AS REAL))), 0) FROM sold s WHERE s.warehouse_id = w.id AND s.pharmacy_id = w.pharmacy_id AND s.status = 'completed') AS totalSales,
                (SELECT COALESCE(SUM(COALESCE(s.base_amount, CAST(s.amount AS REAL))), 0) FROM sold s WHERE s.warehouse_id = w.id AND s.pharmacy_id = w.pharmacy_id AND s.status = 'completed' AND substr(s.date, 1, 10) = ?) AS todaySales,
                (SELECT COUNT(*) FROM pos_shifts sh WHERE sh.warehouse_id = w.id AND sh.pharmacy_id = w.pharmacy_id AND sh.status = 'open') AS openShiftsCount
         FROM warehouses w
         WHERE w.pharmacy_id = ?
         ORDER BY w.id ASC`,
      )
      .all(today, pharmId);
    return res.json({ branches: rows });
  });

  app.put('/api/branches/:id', requireAuth, requirePermission('manageWarehouses'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM warehouses WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'الفرع / المستودع غير موجود' });

    const name = req.body?.name !== undefined ? String(req.body.name).trim() : String(existing.name);
    const code = req.body?.code !== undefined ? String(req.body.code).trim().toUpperCase() : String(existing.code || 'BR-01');
    const managerName =
      req.body?.managerName !== undefined ? String(req.body.managerName).trim() : String(existing.manager_name || '');
    const phone = req.body?.phone !== undefined ? String(req.body.phone).trim() : String(existing.phone || '');
    const location =
      req.body?.location !== undefined ? String(req.body.location).trim() : String(existing.location || '');
    const isBranchPos =
      req.body?.isBranchPos !== undefined ? (req.body.isBranchPos ? 1 : 0) : Number(existing.is_branch_pos ?? 1);
    const targetDailySales =
      req.body?.targetDailySales !== undefined
        ? Math.max(0, Number(req.body.targetDailySales))
        : Number(existing.target_daily_sales ?? 3000);

    sqlite
      .prepare(
        `UPDATE warehouses
         SET name = ?, code = ?, manager_name = ?, phone = ?, location = ?, is_branch_pos = ?, target_daily_sales = ?
         WHERE id = ? AND pharmacy_id = ?`,
      )
      .run(name, code, managerName, phone, location, isBranchPos, targetDailySales, id, pharmId);
    const branch = sqlite.prepare('SELECT * FROM warehouses WHERE id = ?').get(id);
    return res.json({ branch });
  });

  // =========================================================================
  // 5. Promotions & Customer Loyalty
  // =========================================================================
  app.get('/api/promotions', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const promotions = sqlite
      .prepare('SELECT * FROM promotions WHERE pharmacy_id = ? ORDER BY id DESC')
      .all(pharmId);
    return res.json({ promotions });
  });

  app.post('/api/promotions', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const name = String(req.body?.name ?? '').trim();
    const promoType = String(req.body?.promoType ?? 'percentage').trim();
    const scope = ['all', 'category', 'medicine'].includes(String(req.body?.scope))
      ? String(req.body.scope)
      : 'all';
    const targetId = req.body?.targetId ? Number(req.body.targetId) : null;
    const discountPct = Math.min(100, Math.max(0, Number(req.body?.discountPct ?? 0)));
    const minQty = Math.max(1, Number(req.body?.minQty ?? 1));
    const startDate = String(req.body?.startDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const endDate = String(req.body?.endDate ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();

    if (!name || discountPct <= 0) {
      return res.status(400).json({ error: 'يرجى إدخال اسم العرض ونسبة الخصم بشكل صحيح' });
    }

    const info = sqlite
      .prepare(
        `INSERT INTO promotions (name, promo_type, scope, target_id, discount_pct, min_qty, start_date, end_date, is_active, notes, pharmacy_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .run(name, promoType, scope, targetId, discountPct, minQty, startDate, endDate, notes, pharmId, currentTimestamp());
    const id = Number(info.lastInsertRowid);
    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create',
      entityType: 'promotion',
      entityId: id,
      details: `إنشاء عرض ترويجي "${name}" بخصم ${discountPct}%`,
      pharmacyId: pharmId,
    });
    const promotion = sqlite.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    return res.status(201).json({ promotion });
  });

  app.put('/api/promotions/:id', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const existing = sqlite.prepare('SELECT * FROM promotions WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | Record<string, unknown>
      | undefined;
    if (!existing) return res.status(404).json({ error: 'العرض غير موجود' });

    const isActive = req.body?.isActive !== undefined ? (req.body.isActive ? 1 : 0) : Number(existing.is_active);
    const discountPct =
      req.body?.discountPct !== undefined
        ? Math.min(100, Math.max(0, Number(req.body.discountPct)))
        : Number(existing.discount_pct);
    const endDate = req.body?.endDate !== undefined ? String(req.body.endDate).trim() : String(existing.end_date);

    sqlite
      .prepare('UPDATE promotions SET is_active = ?, discount_pct = ?, end_date = ? WHERE id = ? AND pharmacy_id = ?')
      .run(isActive, discountPct, endDate, id, pharmId);
    const promotion = sqlite.prepare('SELECT * FROM promotions WHERE id = ?').get(id);
    return res.json({ promotion });
  });

  app.delete('/api/promotions/:id', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    sqlite.prepare('DELETE FROM promotions WHERE id = ? AND pharmacy_id = ?').run(id, pharmId);
    return res.json({ ok: true });
  });

  app.get('/api/loyalty/overview', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const customers = sqlite
      .prepare(
        "SELECT id, name, phone, loyalty_points, loyalty_tier FROM customers WHERE pharmacy_id = ? AND name != 'عميل نقدي عام' ORDER BY loyalty_points DESC",
      )
      .all(pharmId);
    const transactions = sqlite
      .prepare(
        `SELECT lt.*, c.name AS customer_name
         FROM loyalty_transactions lt
         JOIN customers c ON c.id = lt.customer_id
         WHERE c.pharmacy_id = ?
         ORDER BY lt.id DESC LIMIT 100`,
      )
      .all(pharmId);
    return res.json({ customers, transactions });
  });

  // =========================================================================
  // 6. Operating Expenses & Cost Centers
  // =========================================================================
  app.get('/api/accounting/expenses', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const expenses = sqlite
      .prepare(
        `SELECT e.*, COALESCE(w.name, 'الفرع الرئيسي') AS warehouse_name, COALESCE(cb.name, 'الصندوق') AS cash_box_name
         FROM operating_expenses e
         LEFT JOIN warehouses w ON w.id = e.warehouse_id
         LEFT JOIN cash_boxes cb ON cb.id = e.cash_box_id
         WHERE e.pharmacy_id = ?
         ORDER BY e.id DESC LIMIT 200`,
      )
      .all(pharmId);
    return res.json({ expenses });
  });

  app.post('/api/accounting/expenses', requireAuth, requirePermission('manageAccounting'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const title = String(req.body?.title ?? '').trim();
    const category = String(req.body?.category ?? 'other').trim();
    const reqWh = req.body?.warehouseId ? Number(req.body.warehouseId) : 0;
    const whRow = (
      reqWh
        ? sqlite.prepare('SELECT id FROM warehouses WHERE id = ? AND pharmacy_id = ?').get(reqWh, pharmId)
        : sqlite.prepare('SELECT id FROM warehouses WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId)
    ) as { id: number } | undefined;
    const warehouseId = whRow?.id || 1;
    const amount = Number(req.body?.amount ?? 0);
    const expenseDate = String(req.body?.expenseDate ?? '').trim() || currentTimestamp().slice(0, 10);
    const reqCashBoxId = req.body?.cashBoxId ? Number(req.body.cashBoxId) : 0;
    const receiptRef = String(req.body?.receiptRef ?? '').trim();
    const notes = String(req.body?.notes ?? '').trim();

    if (!title || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'يرجى إدخال بيان المصروف والمبلغ بشكل صحيح' });
    }

    const cashBox = (
      reqCashBoxId
        ? sqlite.prepare('SELECT * FROM cash_boxes WHERE id = ? AND pharmacy_id = ?').get(reqCashBoxId, pharmId)
        : sqlite.prepare('SELECT * FROM cash_boxes WHERE pharmacy_id = ? ORDER BY id ASC LIMIT 1').get(pharmId)
    ) as
      | { id: number; name: string; account_id: number; balance: number }
      | undefined;
    if (!cashBox) return res.status(404).json({ error: 'الصندوق المحدد غير موجود' });
    if (cashBox.balance < amount) {
      return res.status(400).json({ error: `رصيد "${cashBox.name}" (${cashBox.balance}) لا يكفي لصرف المصروف` });
    }

    const expenseAccId = resolvePharmacyAccountId(pharmId, '5020');

    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const info = sqlite
        .prepare(
          `INSERT INTO operating_expenses
            (title, category, warehouse_id, amount, expense_date, cash_box_id, receipt_ref, notes, user_id, pharmacy_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(title, category, warehouseId, Number(amount.toFixed(2)), expenseDate, cashBox.id, receiptRef, notes, user.id, pharmId, currentTimestamp());
      const id = Number(info.lastInsertRowid);

      postJournalEntry({
        description: `مصروف تشغيلي (${category}): ${title}`,
        referenceType: 'operating_expense',
        referenceId: id,
        userId: user.id,
        pharmacyId: pharmId,
        entryDate: expenseDate,
        lines: [
          { accountId: expenseAccId, debit: amount, credit: 0, notes: title },
          { accountId: cashBox.account_id, debit: 0, credit: amount, notes: cashBox.name },
        ],
      });

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'create',
        entityType: 'operating_expense',
        entityId: id,
        details: `تسجيل مصروف تشغيلي "${title}" بمبلغ ${amount}`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');

      const expense = sqlite.prepare('SELECT * FROM operating_expenses WHERE id = ?').get(id);
      return res.status(201).json({ expense });
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  });

  // =========================================================================
  // 8. External Hardware & ZATCA TLV Integrations
  // =========================================================================
  function ensureTenantIntegrations(pharmId: number) {
    const existingCount = (
      sqlite.prepare('SELECT COUNT(*) AS c FROM integration_configs WHERE pharmacy_id = ?').get(pharmId) as { c: number }
    ).c;
    if (existingCount > 0) return;
    const baseConfigs = sqlite
      .prepare('SELECT integration_key, display_name, category, enabled, config_json, notes FROM integration_configs WHERE pharmacy_id = 1')
      .all() as Array<{
      integration_key: string;
      display_name: string;
      category: string;
      enabled: number;
      config_json: string;
      notes: string;
    }>;
    const ins = sqlite.prepare(
      `INSERT OR IGNORE INTO integration_configs
       (integration_key, display_name, category, enabled, config_json, last_tested_at, last_status, notes, pharmacy_id)
       VALUES (?, ?, ?, ?, ?, '', 'untested', ?, ?)`,
    );
    for (const row of baseConfigs) {
      ins.run(row.integration_key, row.display_name, row.category, row.enabled, row.config_json, row.notes, pharmId);
    }
  }

  app.get('/api/integrations', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    ensureTenantIntegrations(pharmId);
    const integrations = sqlite
      .prepare('SELECT * FROM integration_configs WHERE pharmacy_id = ? ORDER BY id ASC')
      .all(pharmId);
    return res.json({ integrations });
  });

  app.put('/api/integrations/:key', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    ensureTenantIntegrations(pharmId);
    const key = String(req.params.key || '').trim();
    const existing = sqlite
      .prepare('SELECT * FROM integration_configs WHERE integration_key = ? AND pharmacy_id = ?')
      .get(key, pharmId) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ error: 'التكامل غير موجود' });

    const enabled = req.body?.enabled !== undefined ? (req.body.enabled ? 1 : 0) : Number(existing.enabled);
    const configJson =
      req.body?.config !== undefined
        ? JSON.stringify(req.body.config)
        : typeof req.body?.configJson === 'string'
          ? req.body.configJson
          : String(existing.config_json || '{}');
    const notes = req.body?.notes !== undefined ? String(req.body.notes).trim() : String(existing.notes || '');

    sqlite
      .prepare('UPDATE integration_configs SET enabled = ?, config_json = ?, notes = ? WHERE integration_key = ? AND pharmacy_id = ?')
      .run(enabled, configJson, notes, key, pharmId);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'update',
      entityType: 'integration',
      entityId: Number(existing.id),
      details: `تحديث إعدادات التكامل: ${String(existing.display_name)} (${enabled ? 'مفعل' : 'معطل'})`,
      pharmacyId: pharmId,
    });
    const integration = sqlite
      .prepare('SELECT * FROM integration_configs WHERE integration_key = ? AND pharmacy_id = ?')
      .get(key, pharmId);
    return res.json({ integration });
  });

  app.post('/api/integrations/:key/test', requireAuth, (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    ensureTenantIntegrations(pharmId);
    const key = String(req.params.key || '').trim();
    const existing = sqlite
      .prepare('SELECT * FROM integration_configs WHERE integration_key = ? AND pharmacy_id = ?')
      .get(key, pharmId) as
      | { id: number; integration_key: string; display_name: string; config_json: string }
      | undefined;
    if (!existing) return res.status(404).json({ error: 'التكامل غير موجود' });

    const now = currentTimestamp();
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(existing.config_json || '{}');
    } catch {
      cfg = {};
    }

    let testOutput = '';
    let nextStatus = 'configured';
    if (key === 'zatca_qr') {
      const site = getSiteSettings(pharmId);
      const tlv = buildZatcaTlvBase64({
        sellerName: String(cfg.sellerName || site.name),
        vatNumber: String(site.taxNumber || cfg.vatNumber || '310123456700003'),
        timestamp: new Date().toISOString(),
        totalWithVat: '100.00',
        vatAmount: '0.00',
      });
      nextStatus = tlv.length > 0 ? 'protocol_ready' : 'error';
      testOutput = `تم توليد وفحص بنية TLV Base64 محلياً (${tlv.slice(0, 28)}...)`;
    } else if (key === 'barcode_scanner') {
      nextStatus = 'needs_client_hardware_test';
      testOutput = 'تهيئة الخادم لقناة HID/2D محفوظة؛ يلزم إجراء اختبار مسح فعلي من جهاز القارئ على المتصفح.';
    } else if (key === 'thermal_printer') {
      nextStatus = 'needs_client_hardware_test';
      testOutput = 'تهيئة قالب 80mm محفوظة؛ يلزم اختبار الطابعة الفعلي عبر المتصفح أو Local Print Bridge.';
    } else if (key === 'label_printer') {
      nextStatus = 'needs_client_hardware_test';
      testOutput = 'محرك ملصقات Code128 SVG مهيأ؛ يلزم طباعة ملصق تجريبي للتأكد من محاذاة الورق الحراري.';
    } else {
      const endpoint = String(cfg.endpointUrl || '').trim();
      let validUrl = false;
      try {
        if (endpoint) {
          const parsed = new URL(endpoint);
          validUrl = parsed.protocol === 'https:' || parsed.protocol === 'http:';
        }
      } catch {
        validUrl = false;
      }
      nextStatus = validUrl ? 'configured' : 'missing_endpoint';
      testOutput = validUrl
        ? `تم التحقق من صيغة رابط الربط (${endpoint}) دون إجراء اتصال شبكي مباشر بالخادم الخارجي.`
        : 'يرجى تحديد رابط Endpoint صالح بصيغة https:// لإكمال إعداد التكامل.';
    }

    sqlite
      .prepare('UPDATE integration_configs SET last_tested_at = ?, last_status = ? WHERE integration_key = ? AND pharmacy_id = ?')
      .run(now, nextStatus, key, pharmId);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'test_integration',
      entityType: 'integration',
      entityId: existing.id,
      details: `فحص تكامل "${existing.display_name}": ${testOutput}`,
      pharmacyId: pharmId,
    });

    const integration = sqlite
      .prepare('SELECT * FROM integration_configs WHERE integration_key = ? AND pharmacy_id = ?')
      .get(key, pharmId);
    return res.json({ ok: true, status: nextStatus, message: testOutput, integration });
  });

  app.post('/api/integrations/zatca-qr', requireAuth, (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    ensureTenantIntegrations(pharmId);
    const site = getSiteSettings(pharmId);
    const row = sqlite
      .prepare("SELECT config_json FROM integration_configs WHERE integration_key = 'zatca_qr' AND pharmacy_id = ?")
      .get(pharmId) as { config_json: string } | undefined;
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(row?.config_json || '{}');
    } catch {
      cfg = {};
    }
    const sellerName = String(req.body?.sellerName || site.name || cfg.sellerName);
    const vatNumber = String(req.body?.vatNumber || site.taxNumber || cfg.vatNumber || '310123456700003');
    const timestamp = String(req.body?.timestamp || new Date().toISOString());
    const totalNum = Number(req.body?.totalAmount ?? 0);
    const vatRate = Number(cfg.vatRatePct ?? 0);
    const vatAmountNum =
      req.body?.vatAmount !== undefined
        ? Number(req.body.vatAmount)
        : Number(((totalNum * vatRate) / (100 + vatRate || 100)).toFixed(2));

    const tlvBase64 = buildZatcaTlvBase64({
      sellerName,
      vatNumber,
      timestamp,
      totalWithVat: totalNum.toFixed(2),
      vatAmount: vatAmountNum.toFixed(2),
    });

    return res.json({
      tlvBase64,
      fields: {
        sellerName,
        vatNumber,
        timestamp,
        totalWithVat: totalNum.toFixed(2),
        vatAmount: vatAmountNum.toFixed(2),
      },
    });
  });

  // =========================================================================
  // 9. Disaster Recovery Checkpoints & Verified Restore (Tenant Isolated)
  // =========================================================================
  app.get('/api/backup/snapshots', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const snapshots = sqlite
      .prepare(
        `SELECT id, snapshot_type, file_name, table_count, row_count, checksum_sha256, created_by, created_by_name, created_at
         FROM backup_snapshots WHERE pharmacy_id = ? ORDER BY id DESC LIMIT 30`,
      )
      .all(pharmId);
    return res.json({ snapshots });
  });

  app.post('/api/backup/checkpoint', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const label = String(req.body?.label ?? '').trim();
    const payload = buildBackupPayload(user.name, true, pharmId);
    const jsonStr = JSON.stringify(payload);
    const checksum = crypto.createHash('sha256').update(jsonStr).digest('hex');
    const fileName =
      label || `checkpoint-p${pharmId}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`;

    const info = sqlite
      .prepare(
        `INSERT INTO backup_snapshots
          (snapshot_type, file_name, table_count, row_count, checksum_sha256, payload_json, created_by, created_by_name, pharmacy_id, created_at)
         VALUES ('checkpoint', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        fileName,
        payload.tableCount,
        payload.totalRows,
        checksum,
        jsonStr,
        user.id,
        user.name,
        pharmId,
        currentTimestamp(),
      );
    const id = Number(info.lastInsertRowid);

    logAudit({
      userId: user.id,
      userName: user.name,
      action: 'create_checkpoint',
      entityType: 'database',
      entityId: id,
      details: `إنشاء نقطة استعادة سريعة للصيدلية #${pharmId} (${payload.tableCount} جدول، ${payload.totalRows} سجل، SHA256: ${checksum.slice(0, 12)})`,
      pharmacyId: pharmId,
    });

    const snapshot = sqlite
      .prepare(
        'SELECT id, snapshot_type, file_name, table_count, row_count, checksum_sha256, created_by, created_by_name, created_at FROM backup_snapshots WHERE id = ?',
      )
      .get(id);
    return res.status(201).json({ snapshot });
  });

  app.post('/api/backup/snapshots/:id/restore', requireAuth, requirePermission('manageSiteSettings'), (req: Request, res: Response) => {
    const { session, sid, user } = (req as AuthedRequest).auth;
    const pharmId = getPharmacyId(req);
    const id = Number(req.params.id);
    const snap = sqlite.prepare('SELECT * FROM backup_snapshots WHERE id = ? AND pharmacy_id = ?').get(id, pharmId) as
      | { id: number; file_name: string; checksum_sha256: string; payload_json: string; pharmacy_id: number }
      | undefined;
    if (!snap) return res.status(404).json({ error: 'نقطة الاستعادة غير موجودة' });

    const actualHash = crypto.createHash('sha256').update(snap.payload_json).digest('hex');
    if (actualHash !== snap.checksum_sha256) {
      return res.status(400).json({ error: 'فشل التحقق من سلامة بصمة SHA-256 لنقطة الاستعادة' });
    }

    const parsed = JSON.parse(snap.payload_json) as {
      pharmacyId?: number | null;
      tables: Record<string, Array<Record<string, unknown>>>;
    };
    if (parsed.pharmacyId && parsed.pharmacyId !== pharmId) {
      return res.status(403).json({ error: 'نقطة الاستعادة تخص صيدلية أخرى' });
    }

    let restoredRows = 0;

    sqlite.exec('PRAGMA foreign_keys = OFF;');
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const counts = restoreTenantScopedTables({
        tablesPayload: parsed.tables,
        targetPharmId: pharmId,
        excludeTables: ['backup_snapshots'],
      });
      restoredRows = counts.restoredRows;

      logAudit({
        userId: user.id,
        userName: user.name,
        action: 'restore_checkpoint',
        entityType: 'database',
        entityId: id,
        details: `استعادة فورية من نقطة التعافي "${snap.file_name}" (${restoredRows} سجل)`,
        pharmacyId: pharmId,
      });
      sqlite.exec('COMMIT');
    } catch (err) {
      try {
        sqlite.exec('ROLLBACK');
      } catch {
        // ignore
      }
      sqlite.exec('PRAGMA foreign_keys = ON;');
      return res.status(400).json({ error: err instanceof Error ? err.message : 'تعذر استعادة نقطة التعافي' });
    }
    sqlite.exec('PRAGMA foreign_keys = ON;');

    for (const [otherSid, otherSession] of Array.from(sessions.entries())) {
      if (otherSid !== sid) {
        const otherU = findUserById(otherSession.userId);
        if (!otherU || otherU.pharmacy_id === pharmId) {
          sessions.delete(otherSid);
        }
      }
    }
    session.bill = [];
    const refreshedUser =
      findUserById(user.id) ||
      rowToUser(sqlite.prepare('SELECT * FROM users WHERE pharmacy_id = ? LIMIT 1').get(pharmId) as Record<string, unknown>);
    if (refreshedUser) session.userId = refreshedUser.id;

    return res.json({
      ok: true,
      restoredRows,
      site: getSiteSettings(pharmId),
      user: refreshedUser ? sanitizeUser(refreshedUser) : sanitizeUser(user),
    });
  });

  // =========================================================================
  // 10. Smart Analytics & Advanced KPIs (ABC, Velocity/Reorder, Expiry Risk, Profitability)
  // =========================================================================
  app.get('/api/analytics/smart', requireAuth, requirePermission('viewReports'), (req: Request, res: Response) => {
    const pharmId = getPharmacyId(req);
    const today = currentTimestamp().slice(0, 10);
    const d30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const in60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    const in90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

    // 1. ABC Revenue & Velocity by Medicine
    const meds = sqlite
      .prepare('SELECT id, name, quantity, minStock, max_stock, purchase_price, price FROM inventeries WHERE pharmacy_id = ?')
      .all(pharmId) as Array<{
      id: number;
      name: string;
      quantity: number;
      minStock: number;
      max_stock: number;
      purchase_price: number;
      price: string;
    }>;

    const salesByMed = new Map<number, { qtySold: number; revenue: number; recent30Qty: number }>();
    const soldRows = sqlite
      .prepare(
        `SELECT si.medicineId, si.qty, si.unit_factor, si.price, s.date
         FROM sold_items si
         JOIN sold s ON s.id = si.soldId
         WHERE s.pharmacy_id = ? AND s.status = 'completed'`,
      )
      .all(pharmId) as Array<{ medicineId: number; qty: number; unit_factor: number; price: number; date: string }>;

    for (const r of soldRows) {
      const packs = (Number(r.qty) || 0) * (Number(r.unit_factor) || 1);
      const rev = (Number(r.price) || 0) * (Number(r.qty) || 0);
      const prev = salesByMed.get(r.medicineId) || { qtySold: 0, revenue: 0, recent30Qty: 0 };
      prev.qtySold += packs;
      prev.revenue += rev;
      if (String(r.date).slice(0, 10) >= d30) {
        prev.recent30Qty += packs;
      }
      salesByMed.set(r.medicineId, prev);
    }

    const totalRevenueAll = Array.from(salesByMed.values()).reduce((s, v) => s + v.revenue, 0);
    const ranked = meds
      .map((m) => {
        const st = salesByMed.get(m.id) || { qtySold: 0, revenue: 0, recent30Qty: 0 };
        const avgDaily = st.recent30Qty > 0 ? st.recent30Qty / 30 : st.qtySold / 90;
        const daysOfStockLeft = avgDaily > 0 ? Math.round(m.quantity / avgDaily) : null;
        const suggestedReorderQty =
          m.quantity <= m.minStock || (daysOfStockLeft !== null && daysOfStockLeft <= 14)
            ? Math.max(0, Math.ceil(Math.max(m.minStock * 2, avgDaily * 30) - m.quantity))
            : 0;
        return {
          medicineId: m.id,
          medicineName: m.name,
          currentQty: Number(m.quantity.toFixed(2)),
          minStock: m.minStock,
          qtySold: Number(st.qtySold.toFixed(2)),
          revenue: Number(st.revenue.toFixed(2)),
          avgDailyUsage: Number(avgDaily.toFixed(2)),
          daysOfStockLeft,
          suggestedReorderQty,
          abcClass: 'C' as 'A' | 'B' | 'C',
          revenueSharePct: totalRevenueAll > 0 ? Number(((st.revenue / totalRevenueAll) * 100).toFixed(1)) : 0,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    let cumulative = 0;
    for (const item of ranked) {
      if (totalRevenueAll > 0 && item.revenue > 0) {
        cumulative += item.revenue;
        const cumPct = (cumulative / totalRevenueAll) * 100;
        item.abcClass = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
      } else {
        item.abcClass = 'C';
      }
    }

    // 2. Expiry Value at Risk
    const expiryRisk = {
      expiredValue: Number(
        (
          sqlite
            .prepare(
              `SELECT COALESCE(SUM(b.qty_remaining * b.purchase_price), 0) AS val
               FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id
               WHERE i.pharmacy_id = ? AND b.qty_remaining > 0 AND b.expiry_date != '' AND b.expiry_date < ?`,
            )
            .get(pharmId, today) as { val: number }
        ).val.toFixed(2),
      ),
      within30DaysValue: Number(
        (
          sqlite
            .prepare(
              `SELECT COALESCE(SUM(b.qty_remaining * b.purchase_price), 0) AS val
               FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id
               WHERE i.pharmacy_id = ? AND b.status = 'active' AND b.qty_remaining > 0 AND b.expiry_date >= ? AND b.expiry_date <= ?`,
            )
            .get(pharmId, today, in30) as { val: number }
        ).val.toFixed(2),
      ),
      within60DaysValue: Number(
        (
          sqlite
            .prepare(
              `SELECT COALESCE(SUM(b.qty_remaining * b.purchase_price), 0) AS val
               FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id
               WHERE i.pharmacy_id = ? AND b.status = 'active' AND b.qty_remaining > 0 AND b.expiry_date > ? AND b.expiry_date <= ?`,
            )
            .get(pharmId, in30, in60) as { val: number }
        ).val.toFixed(2),
      ),
      within90DaysValue: Number(
        (
          sqlite
            .prepare(
              `SELECT COALESCE(SUM(b.qty_remaining * b.purchase_price), 0) AS val
               FROM medicine_batches b JOIN inventeries i ON i.id = b.medicine_id
               WHERE i.pharmacy_id = ? AND b.status = 'active' AND b.qty_remaining > 0 AND b.expiry_date > ? AND b.expiry_date <= ?`,
            )
            .get(pharmId, in60, in90) as { val: number }
        ).val.toFixed(2),
      ),
    };

    // 3. True Net Operating Profitability
    const totalSalesRevenue = Number(
      (
        sqlite
          .prepare("SELECT COALESCE(SUM(COALESCE(base_amount, CAST(amount AS REAL))), 0) AS val FROM sold WHERE pharmacy_id = ? AND status = 'completed'")
          .get(pharmId) as { val: number }
      ).val.toFixed(2),
    );
    const totalReturns = Number(
      (
        sqlite
          .prepare('SELECT COALESCE(SUM(refund_amount), 0) AS val FROM sales_returns WHERE pharmacy_id = ?')
          .get(pharmId) as { val: number }
      ).val.toFixed(2),
    );
    const cogsAccId = resolvePharmacyAccountId(pharmId, '5010');
    const totalCogs = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(SUM(jl.debit - jl.credit), 0) AS val
             FROM journal_lines jl
             JOIN journal_entries je ON je.id = jl.journal_id
             WHERE je.pharmacy_id = ? AND jl.account_id = ?`,
          )
          .get(pharmId, cogsAccId) as { val: number }
      ).val.toFixed(2),
    );
    const operatingExpensesTotal = Number(
      (
        sqlite
          .prepare('SELECT COALESCE(SUM(amount), 0) AS val FROM operating_expenses WHERE pharmacy_id = ?')
          .get(pharmId) as { val: number }
      ).val.toFixed(2),
    );
    const payrollExpensesTotal = Number(
      (
        sqlite
          .prepare(
            `SELECT COALESCE(SUM(t.amount), 0) AS val
             FROM employee_transactions t
             JOIN employees e ON e.id = t.employee_id
             WHERE e.pharmacy_id = ? AND t.tx_type != 'deduction'`,
          )
          .get(pharmId) as { val: number }
      ).val.toFixed(2),
    );
    const grossProfit = Number((totalSalesRevenue - totalReturns - totalCogs).toFixed(2));
    const netOperatingProfit = Number((grossProfit - operatingExpensesTotal - payrollExpensesTotal).toFixed(2));

    return res.json({
      abcItems: ranked,
      reorderRecommendations: ranked.filter((i) => i.suggestedReorderQty > 0),
      expiryRisk,
      profitability: {
        totalSalesRevenue,
        totalReturns,
        totalCogs,
        grossProfit,
        operatingExpensesTotal,
        payrollExpensesTotal,
        netOperatingProfit,
        netMarginPct: totalSalesRevenue > 0 ? Number(((netOperatingProfit / totalSalesRevenue) * 100).toFixed(1)) : 0,
      },
    });
  });
}
