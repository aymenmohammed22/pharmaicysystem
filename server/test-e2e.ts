import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';
import {
  sqlite,
  sessions,
  provisionNewPharmacyTenant,
  deletePharmacyTenant,
} from './db.ts';
import { registerPharmacyRoutes } from './routes/pharmacy.ts';
import { registerPosRoutes } from './routes/pos.ts';
import { registerPurchasingRoutes } from './routes/purchasing.ts';
import { registerClinicalRoutes } from './routes/clinical.ts';
import { registerAccountingRoutes } from './routes/accounting.ts';
import { registerHrAndReportsRoutes } from './routes/hrAndReports.ts';
import { registerBackupRoutes } from './routes/backup.ts';
import { registerEnterpriseRoutes } from './routes/enterprise.ts';
import { registerHardwareAndBarcodeRoutes } from './routes/hardwareAndBarcodes.ts';
import {
  calculateGs1CheckDigit,
  detectBarcodeSymbology,
  generateInternalEan13,
  isValidEan13,
  isValidEan8,
  isValidGtin14,
  normalizeScannerInput,
  parseGs1Barcode,
} from '../shared/gs1Barcode.ts';

async function apiCall(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

function runGs1UnitTests(): number {
  let count = 0;

  // 1. Arabic-Indic digits + AIM prefix stripping
  assert.equal(normalizeScannerInput(']E0٦٢٨١٢٣٤٥٦٧٨٩٧'), '6281234567897');
  count += 1;

  // 2. Arabic HID keyboard scramble repair vs normal Arabic medicine name search preservation
  assert.equal(normalizeScannerInput('شسي', { fixArabicLayout: true }), 'asd');
  assert.equal(normalizeScannerInput('بانادول'), 'بانادول');
  count += 1;

  // 3. GS1 Check digit helpers
  const body12 = '628123456789';
  const ean13 = `${body12}${calculateGs1CheckDigit(body12)}`;
  assert.equal(isValidEan13(ean13), true);
  assert.equal(isValidEan13('6281234567890'), false);
  assert.equal(isValidEan8(`1234567${calculateGs1CheckDigit('1234567')}`), true);
  assert.equal(isValidGtin14(`0${ean13}`), true);
  count += 1;

  // 4. Restricted 200 internal barcode generator
  const internal = generateInternalEan13();
  assert.equal(internal.startsWith('200'), true);
  assert.equal(internal.length, 13);
  assert.equal(isValidEan13(internal), true);
  assert.equal(detectBarcodeSymbology(internal), 'EAN13');
  count += 1;

  // 5. GS1 DataMatrix HRI parsing + leap year DD=00 rule (280200 -> 2028-02-29)
  const hri = `(01)0${ean13}(17)280200(10)BATCH99(21)SER001`;
  const parsedHri = parseGs1Barcode(hri);
  assert.equal(parsedHri.isGs1, true);
  assert.equal(parsedHri.gtin13, ean13);
  assert.equal(parsedHri.expiryDate, '2028-02-29');
  assert.equal(parsedHri.batchNumber, 'BATCH99');
  assert.equal(parsedHri.serialNumber, 'SER001');
  assert.equal(detectBarcodeSymbology(hri), 'GS1_DATAMATRIX');
  count += 1;

  // 6. GS1 DataMatrix FNC1 (<GS> = \x1D) binary scanner payload with AIM ]d2 prefix
  const binaryStream = `]d2010${ean13}17291100\x1D10LOTX2\x1D21S777`;
  const parsedBin = parseGs1Barcode(binaryStream);
  assert.equal(parsedBin.isGs1, true);
  assert.equal(parsedBin.gtin13, ean13);
  assert.equal(parsedBin.expiryDate, '2029-11-30');
  assert.equal(parsedBin.batchNumber, 'LOTX2');
  assert.equal(parsedBin.serialNumber, 'S777');
  count += 1;

  return count;
}

async function main() {
  console.log('==========================================================');
  console.log('ITQAN SOFT - SYSTEM AUDIT, GS1, IDOR & POS CONCURRENCY E2E');
  console.log('==========================================================');

  const unitPassed = runGs1UnitTests();
  console.log(`[PASS] Stage 5 Unit Tests (${unitPassed}/6 assertions)`);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  registerPharmacyRoutes(app);
  registerPosRoutes(app);
  registerPurchasingRoutes(app);
  registerClinicalRoutes(app);
  registerAccountingRoutes(app);
  registerHrAndReportsRoutes(app);
  registerBackupRoutes(app);
  registerEnterpriseRoutes(app);
  registerHardwareAndBarcodeRoutes(app);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  let tenantAId = 0;
  let tenantBId = 0;
  let tokenA = '';
  let tokenB = '';

  try {
    // Provision two isolated tenants so production data in pharmacy #1 is untouched
    const provA = provisionNewPharmacyTenant({
      name: `Test Pharmacy A ${suffix}`,
      ownerName: 'Owner A',
      ownerUsername: `e2e_owner_a_${suffix}`,
      ownerEmail: `e2e_a_${suffix}@test.local`,
      ownerPassword: 'TestPassword123!',
    });
    const provB = provisionNewPharmacyTenant({
      name: `Test Pharmacy B ${suffix}`,
      ownerName: 'Owner B',
      ownerUsername: `e2e_owner_b_${suffix}`,
      ownerEmail: `e2e_b_${suffix}@test.local`,
      ownerPassword: 'TestPassword123!',
    });
    tenantAId = provA.pharmacyId;
    tenantBId = provB.pharmacyId;

    tokenA = crypto.randomBytes(24).toString('hex');
    tokenB = crypto.randomBytes(24).toString('hex');
    sessions.set(tokenA, { userId: provA.ownerUserId, bill: [] });
    sessions.set(tokenB, { userId: provB.ownerUserId, bill: [] });

    // Load Tenant A warehouse & cashBox & category
    const catRes = await apiCall(baseUrl, '/api/categories', {
      method: 'POST',
      token: tokenA,
      body: { name: 'مسكنات E2E', details: 'اختبار', pic: 'cap.png' },
    });
    assert.equal(catRes.status, 201);
    const catA = (catRes.data.category as { id: number }).id;

    const whA = (await apiCall(baseUrl, '/api/warehouses', { token: tokenA })).data.warehouses as Array<{ id: number }>;
    assert.ok(whA.length >= 1);
    const whIdA = whA[0].id;

    // Generate valid EAN-13 codes
    const packEan = (await apiCall(baseUrl, '/api/barcodes/generate', { method: 'POST', token: tokenA })).data
      .barcode as string;
    const stripEan = (await apiCall(baseUrl, '/api/barcodes/generate', { method: 'POST', token: tokenA })).data
      .barcode as string;
    assert.equal(isValidEan13(packEan), true);
    assert.equal(isValidEan13(stripEan), true);

    // Create Medicine A in Tenant A with multi-unit setup & qty = 5 packs
    const medRes = await apiCall(baseUrl, '/api/inventories', {
      method: 'POST',
      token: tokenA,
      body: {
        catId: catA,
        name: 'Amoxil 500mg E2E',
        scientificName: 'Amoxicillin',
        activeIngredient: 'Amoxicillin',
        barcode: packEan,
        price: 40,
        purchasePrice: 25,
        quantity: 5,
        minStock: 2,
        stripsPerPack: 2,
        stripPrice: 20,
        piecesPerPack: 20,
        piecePrice: 2,
        batchNumber: 'BATCH-GOOD-01',
        expiryDate: '2029-12-31',
      },
    });
    assert.equal(medRes.status, 201);
    const medIdA = (medRes.data.item as { id: number }).id;

    // Bind extra strip barcode + reject invalid EAN check digit
    const badCheckRes = await apiCall(baseUrl, '/api/barcodes', {
      method: 'POST',
      token: tokenA,
      body: {
        medicineId: medIdA,
        barcode: '6281234567890',
        symbology: 'EAN13',
        unitType: 'strip',
        validateCheckDigit: true,
      },
    });
    assert.equal(badCheckRes.status, 400);

    const stripBindRes = await apiCall(baseUrl, '/api/barcodes', {
      method: 'POST',
      token: tokenA,
      body: {
        medicineId: medIdA,
        barcode: stripEan,
        unitType: 'strip',
        validateCheckDigit: true,
      },
    });
    assert.equal(stripBindRes.status, 201);
    const stripBarcodeId = (stripBindRes.data.barcodeRecord as { id: number }).id;

    // Add second batch B-EXPIRE and quarantine it to test GS1 batch guard
    const qBatchRes = await apiCall(baseUrl, '/api/batches', {
      method: 'POST',
      token: tokenA,
      body: {
        medicineId: medIdA,
        warehouseId: whIdA,
        batchNumber: 'BATCH-QUAR-99',
        expiryDate: '2028-10-31',
        qty: 2,
        purchasePrice: 25,
      },
    });
    assert.equal(qBatchRes.status, 201);
    const qBatchId = qBatchRes.data.batchId as number;
    const lockBatchRes = await apiCall(baseUrl, `/api/batches/${qBatchId}/status`, {
      method: 'PATCH',
      token: tokenA,
      body: { status: 'quarantined', reason: 'E2E Hold' },
    });
    assert.equal(lockBatchRes.status, 200);

    // Create Customer, Insurance Company, Clinical Interaction, and Hardware Device in Tenant A
    const custRes = await apiCall(baseUrl, '/api/customers', {
      method: 'POST',
      token: tokenA,
      body: { name: 'عميل E2E', phone: '0500001122', creditLimit: 2000 },
    });
    assert.equal(custRes.status, 201);
    const customerIdA = (custRes.data.customer as { id: number }).id;

    const insCompRes = await apiCall(baseUrl, '/api/insurance/companies', {
      method: 'POST',
      token: tokenA,
      body: { name: 'تأمين اختبار E2E', defaultCoveragePct: 50, maxClaimLimit: 1000 },
    });
    assert.equal(insCompRes.status, 201);
    const insIdA = (insCompRes.data.company as { id: number }).id;

    const interRes = await apiCall(baseUrl, '/api/clinical/interactions', {
      method: 'POST',
      token: tokenA,
      body: {
        ingredientA: 'Warfarin',
        ingredientB: 'Aspirin',
        severity: 'major',
        clinicalEffect: 'Bleeding risk',
      },
    });
    assert.equal(interRes.status, 201);
    const interIdA = (interRes.data.interaction as { id: number }).id;

    const hwListRes = await apiCall(baseUrl, '/api/hardware/devices', { token: tokenA });
    assert.equal(hwListRes.status, 200);
    const devicesA = hwListRes.data.devices as Array<{ id: number }>;
    assert.ok(devicesA.length >= 4);
    const devIdA = devicesA[0].id;

    // -----------------------------------------------------------------------
    // 1. MULTI-TENANT IDOR CHECKS (Tenant B tries touching Tenant A resources)
    // -----------------------------------------------------------------------
    assert.equal(
      (await apiCall(baseUrl, `/api/inventories/${medIdA}`, { method: 'PUT', token: tokenB, body: { name: 'Hack' } }))
        .status,
      404,
    );
    assert.equal(
      (await apiCall(baseUrl, `/api/inventories/${medIdA}`, { method: 'DELETE', token: tokenB })).status,
      404,
    );
    assert.equal(
      (
        await apiCall(baseUrl, `/api/batches/${qBatchId}/status`, {
          method: 'PATCH',
          token: tokenB,
          body: { status: 'active' },
        })
      ).status,
      404,
    );
    assert.equal(
      (await apiCall(baseUrl, `/api/customers/${customerIdA}/statement`, { token: tokenB })).status,
      404,
    );
    assert.equal(
      (await apiCall(baseUrl, `/api/clinical/interactions/${interIdA}`, { method: 'DELETE', token: tokenB })).status,
      404,
    );
    assert.equal(
      (await apiCall(baseUrl, `/api/barcodes/${stripBarcodeId}`, { method: 'DELETE', token: tokenB })).status,
      404,
    );
    assert.equal(
      (
        await apiCall(baseUrl, `/api/hardware/devices/${devIdA}/audit`, {
          method: 'POST',
          token: tokenB,
          body: { status: 'hacked' },
        })
      ).status,
      404,
    );
    console.log('[PASS] Multi-Tenant IDOR Isolation across 7 endpoints');

    // -----------------------------------------------------------------------
    // 2. GS1 DATAMATRIX & MULTI-UNIT BARCODE SCANNING
    // -----------------------------------------------------------------------
    // Expired GS1 DataMatrix -> 400
    const expiredGs1 = await apiCall(baseUrl, '/api/bill/scan', {
      method: 'POST',
      token: tokenA,
      body: { barcode: `(01)0${packEan}(17)200101(10)BATCH-GOOD-01` },
    });
    assert.equal(expiredGs1.status, 400);

    // Quarantined batch GS1 DataMatrix -> 400
    const quarantinedGs1 = await apiCall(baseUrl, '/api/bill/scan', {
      method: 'POST',
      token: tokenA,
      body: { barcode: `(01)0${packEan}(17)281031(10)BATCH-QUAR-99` },
    });
    assert.equal(quarantinedGs1.status, 400);

    // Valid GS1 DataMatrix with binary <GS> -> 200 & matches medicine
    const goodGs1 = await apiCall(baseUrl, '/api/bill/scan', {
      method: 'POST',
      token: tokenA,
      body: { barcode: `]d2010${packEan}17291231\x1D10BATCH-GOOD-01\x1D21SN1` },
    });
    assert.equal(goodGs1.status, 200);
    assert.equal((goodGs1.data.addedItem as { id: number }).id, medIdA);

    // Clear bill, then test strip barcode auto-unit selection
    await apiCall(baseUrl, '/api/bill/clear', { method: 'POST', token: tokenA });
    const stripScan = await apiCall(baseUrl, '/api/bill/scan', {
      method: 'POST',
      token: tokenA,
      body: { barcode: stripEan },
    });
    assert.equal(stripScan.status, 200);
    const stripBill = stripScan.data.bill as Array<{ saleUnit: string; unitFactor: number }>;
    assert.equal(stripBill.length, 1);
    assert.equal(stripBill[0].saleUnit, 'شريط');
    assert.equal(stripBill[0].unitFactor, 0.5);
    await apiCall(baseUrl, '/api/bill/clear', { method: 'POST', token: tokenA });
    console.log('[PASS] GS1 DataMatrix Parsing, Expiry/Quarantine Guards & Multi-Unit Scanning');

    // -----------------------------------------------------------------------
    // 3. POS CHECKOUT, SALES RETURN QTY CAP, INVOICE CANCEL & INSURANCE REVERSAL
    // -----------------------------------------------------------------------
    const shiftOpen = await apiCall(baseUrl, '/api/shifts/open', {
      method: 'POST',
      token: tokenA,
      body: { openingCash: 500, warehouseId: whIdA },
    });
    assert.equal(shiftOpen.status, 201);

    // Add 3 packs via scan/add
    await apiCall(baseUrl, '/api/bill/add', { method: 'POST', token: tokenA, body: { id: medIdA, saleUnit: 'علبة' } });
    await apiCall(baseUrl, '/api/bill/item/' + medIdA, { method: 'PATCH', token: tokenA, body: { qty: 3 } });

    const checkoutRes = await apiCall(baseUrl, '/api/bill/checkout', {
      method: 'POST',
      token: tokenA,
      body: {
        name: 'عميل E2E',
        contact: '0500001122',
        discount: 0,
        paymentMethod: 'insurance',
        customerId: customerIdA,
        warehouseId: whIdA,
        insuranceId: insIdA,
        coveragePct: 50,
        policyNumber: 'POL-E2E',
        approvalCode: 'APP-E2E',
      },
    });
    assert.equal(checkoutRes.status, 201);
    const soldId = (checkoutRes.data.invoice as { id: number }).id;

    // Verify customer points earned (>0) & insurance receivable balance > 0
    const custAfterSale = sqlite
      .prepare('SELECT loyalty_points FROM customers WHERE id = ?')
      .get(customerIdA) as { loyalty_points: number };
    const insAfterSale = sqlite
      .prepare('SELECT balance FROM insurance_companies WHERE id = ?')
      .get(insIdA) as { balance: number };
    assert.ok(custAfterSale.loyalty_points > 0);
    assert.ok(insAfterSale.balance > 0);

    // Sales return exceeding sold quantity (try returning 4 out of 3) -> MUST fail 400
    const overReturnRes = await apiCall(baseUrl, '/api/sales-returns', {
      method: 'POST',
      token: tokenA,
      body: {
        soldId,
        reason: 'محاولة إرجاع أكبر من المباع',
        refundMethod: 'cash',
        items: [{ medicineId: medIdA, qty: 4, unitFactor: 1, refundPrice: 40 }],
      },
    });
    assert.equal(overReturnRes.status, 400);

    // Cancel invoice -> must cancel claim, zero insurance balance, revert loyalty & stock
    const cancelRes = await apiCall(baseUrl, `/api/sold/${soldId}/cancel`, {
      method: 'POST',
      token: tokenA,
    });
    assert.equal(cancelRes.status, 200);

    const claimAfterCancel = sqlite
      .prepare('SELECT status FROM insurance_claims WHERE sold_id = ?')
      .get(soldId) as { status: string };
    const insAfterCancel = sqlite
      .prepare('SELECT balance FROM insurance_companies WHERE id = ?')
      .get(insIdA) as { balance: number };
    const custAfterCancel = sqlite
      .prepare('SELECT loyalty_points FROM customers WHERE id = ?')
      .get(customerIdA) as { loyalty_points: number };
    const invAfterCancel = sqlite
      .prepare('SELECT quantity FROM inventeries WHERE id = ?')
      .get(medIdA) as { quantity: number };

    assert.equal(claimAfterCancel.status, 'cancelled');
    assert.equal(Number(insAfterCancel.balance.toFixed(2)), 0);
    assert.equal(custAfterCancel.loyalty_points, 0);
    assert.equal(invAfterCancel.quantity, 5);
    console.log('[PASS] Return Qty Cap, Invoice Cancel Reversing Insurance Claims/Balance & Loyalty');

    // -----------------------------------------------------------------------
    // 4. CONCURRENT POS CHECKOUT RACE SAFETY
    // -----------------------------------------------------------------------
    const raceToken2 = crypto.randomBytes(24).toString('hex');
    sessions.set(raceToken2, { userId: provA.ownerUserId, bill: [] });
    await apiCall(baseUrl, '/api/bill/add', { method: 'POST', token: tokenA, body: { id: medIdA, saleUnit: 'علبة' } });
    await apiCall(baseUrl, '/api/bill/item/' + medIdA, { method: 'PATCH', token: tokenA, body: { qty: 4 } });
    await apiCall(baseUrl, '/api/bill/add', { method: 'POST', token: raceToken2, body: { id: medIdA, saleUnit: 'علبة' } });
    await apiCall(baseUrl, '/api/bill/item/' + medIdA, { method: 'PATCH', token: raceToken2, body: { qty: 4 } });

    const [r1, r2] = await Promise.all([
      apiCall(baseUrl, '/api/bill/checkout', {
        method: 'POST',
        token: tokenA,
        body: { name: 'Race1', contact: '', discount: 0, warehouseId: whIdA },
      }),
      apiCall(baseUrl, '/api/bill/checkout', {
        method: 'POST',
        token: raceToken2,
        body: { name: 'Race2', contact: '', discount: 0, warehouseId: whIdA },
      }),
    ]);
    sessions.delete(raceToken2);

    const raceStatuses = [r1.status, r2.status].sort();
    // Exactly one succeeds (201) and one rejects cleanly (400/409) without negative stock
    assert.ok(raceStatuses.includes(201), 'One concurrent checkout must succeed');
    assert.ok(raceStatuses[0] !== 201 || raceStatuses[1] !== 201, 'Both cannot oversell 4+4 from stock=5');
    const stockAfterRace = (sqlite.prepare('SELECT quantity FROM inventeries WHERE id = ?').get(medIdA) as { quantity: number })
      .quantity;
    assert.equal(stockAfterRace, 1);
    console.log('[PASS] Concurrent POS Checkout Oversell Prevention');

    // -----------------------------------------------------------------------
    // 5. ACCOUNTING DOUBLE-ENTRY & AS-OF BALANCE SHEET INVARIANT
    // -----------------------------------------------------------------------
    const unbalanced = sqlite
      .prepare(
        `SELECT je.id, ROUND(SUM(jl.debit), 2) AS d, ROUND(SUM(jl.credit), 2) AS c
         FROM journal_entries je
         JOIN journal_lines jl ON jl.journal_id = je.id
         WHERE je.pharmacy_id = ?
         GROUP BY je.id
         HAVING ABS(d - c) > 0.01`,
      )
      .all(tenantAId);
    assert.equal(unbalanced.length, 0);

    const today = new Date().toISOString().slice(0, 10);
    const stmtRes = await apiCall(baseUrl, `/api/accounting/statements?from=${today}&to=${today}`, { token: tokenA });
    assert.equal(stmtRes.status, 200);
    const bs = stmtRes.data.balanceSheet as {
      totalAssets: number;
      totalLiabilities: number;
      totalEquity: number;
      retainedEarnings: number;
    };
    const bsDiff = Math.abs(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity));
    assert.ok(bsDiff < 0.05, `Balance sheet out of balance by ${bsDiff} (A=${bs.totalAssets}, L=${bs.totalLiabilities}, E+RE=${bs.totalEquity})`);
    assert.ok(Math.abs(bs.retainedEarnings - 60) < 0.05, `Expected net retained earnings 60 from 4-pack sale, got ${bs.retainedEarnings}`);
    console.log('[PASS] Accounting Balanced JEs & As-Of Date-Filtered Balance Sheet Equation');

    // -----------------------------------------------------------------------
    // 6. HARDWARE DEVICES, HONEST AUDIT LOGGING & PRINT QUEUE
    // -----------------------------------------------------------------------
    const auditRes = await apiCall(baseUrl, `/api/hardware/devices/${devIdA}/audit`, {
      method: 'POST',
      token: tokenA,
      body: {
        eventType: 'hid_scan_test',
        transport: 'usb_hid',
        status: 'verified_by_user_scan',
        details: 'E2E Real Scan Payload Verification',
      },
    });
    assert.equal(auditRes.status, 200);
    assert.equal((auditRes.data.device as { last_status: string }).last_status, 'verified_by_user_scan');

    const pjCreate = await apiCall(baseUrl, '/api/hardware/print-jobs', {
      method: 'POST',
      token: tokenA,
      body: {
        jobType: 'thermal_receipt',
        title: 'E2E Receipt Print Job',
        deviceId: devIdA,
        protocol: 'ESCPOS',
        transport: 'browser_print',
        status: 'queued',
        copies: 1,
      },
    });
    assert.equal(pjCreate.status, 201);
    const pjId = (pjCreate.data.job as { id: number }).id;

    const pjDone = await apiCall(baseUrl, `/api/hardware/print-jobs/${pjId}`, {
      method: 'PATCH',
      token: tokenA,
      body: { status: 'completed' },
    });
    assert.equal(pjDone.status, 200);
    assert.equal((pjDone.data.job as { status: string }).status, 'completed');
    console.log('[PASS] Hardware Diagnostics Audit & Print Job Queue Lifecycle');
  } finally {
    if (tokenA) sessions.delete(tokenA);
    if (tokenB) sessions.delete(tokenB);
    if (tenantAId > 1) {
      try {
        deletePharmacyTenant(tenantAId);
      } catch (e) {
        console.error('Cleanup error tenantA:', e);
      }
    }
    if (tenantBId > 1) {
      try {
        deletePharmacyTenant(tenantBId);
      } catch (e) {
        console.error('Cleanup error tenantB:', e);
      }
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  const integrity = sqlite.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
  const fkErrors = sqlite.prepare('PRAGMA foreign_key_check').all();
  assert.equal(integrity[0]?.integrity_check, 'ok');
  assert.equal(fkErrors.length, 0);
  console.log('[PASS] Post-Test Cleanup & SQLite PRAGMA integrity_check=ok / foreign_key_check=[]');
  console.log('==========================================================');
  console.log('ALL AUTOMATED E2E, GS1, IDOR, CONCURRENCY & ACCOUNTING TESTS PASSED');
  console.log('==========================================================');
}

main().catch((err) => {
  console.error('[FAIL] E2E suite failed:', err);
  process.exit(1);
});
