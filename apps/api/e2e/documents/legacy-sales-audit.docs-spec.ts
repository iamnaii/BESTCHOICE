import { readFileSync } from 'fs';
import { join } from 'path';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../src/utils/test-data-markers';
import { DocumentsHarness, startDocumentsApp } from './support/harness';
import { DocumentsWorld, seedDocumentsWorld } from './support/fixtures';
import { recordScenario, saveArtifact, ScenarioRecord, sha256 } from './support/artifacts';

/**
 * DOC-14 (issue #1573) — the read-only legacy sales diagnostic
 * (`docs/review/2026-09-11-sales/legacy-sales-audit.sql`) run against a synthetic fixture that
 * carries every class the reviewer has to tell apart: valid rows, "unknown" (evidence never
 * recorded), and mismatches. The SQL is executed exactly as written (its own SELECT statements,
 * inside a REPEATABLE READ READ ONLY transaction); the spec only adds a sale-number prefix filter
 * when it classifies rows, because the disposable database is shared with the other suites.
 *
 * Nothing here backfills or corrects anything — the read-only transaction is proven by trying an
 * UPDATE inside it. The historical audit on authorised data stays BLOCKED (recorded as such).
 */
const DOMAIN = 'legacy-sales-audit';
const SQL_PATH = join(__dirname, '../../../../docs/review/2026-09-11-sales/legacy-sales-audit.sql');
const SIMULATED = [
  'sales / bookings / cost snapshots are inserted directly as fixture rows (no POS, booking or finance-receivable flow) — the subject under test is the diagnostic SQL, not the writers',
  'only synthetic rows carrying the run prefix are classified; the global counts of the shared disposable database are recorded as-is',
];
const scenario = (record: Omit<ScenarioRecord, 'documents' | 'guards' | 'renderer' | 'source' | 'status' | 'simulated'> & Partial<ScenarioRecord>): ScenarioRecord => ({
  documents: ['LEGACY_SALES_AUDIT'], guards: ['none — SQL runs on the database session, no HTTP route involved'], renderer: 'none', source: 'prisma-fixture', status: 'PASS', simulated: SIMULATED, ...record,
});

type Row = Record<string, unknown>;
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? Number(v) : v)));
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(String(value)));

describe('DOC-14 legacy sales diagnostic — read-only SQL over a fixture of valid / unknown / mismatched rows', () => {
  let h: DocumentsHarness;
  let world: DocumentsWorld;
  let prefix: string;
  let statements: string[];
  let selects: string[];
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await startDocumentsApp();
    world = await seedDocumentsWorld(h.prisma);
    prefix = `${TEST_DOC_PREFIX}${world.prefix}-DOC14-`;

    const sql = readFileSync(SQL_PATH, 'utf8');
    statements = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);
    selects = statements.filter((s) => /^select/i.test(s));
    saveArtifact(DOMAIN, 'legacy-sales-audit.sql', sql);

    const product = async (label: string, costPrice: string) => {
      const row = await h.prisma.product.create({ data: {
        name: `${TEST_NAME_PREFIX} DOC-14 ${label}`, brand: 'Apple', model: `iPhone 13 ${TEST_NAME_PREFIX} DOC-14 ${label}`, storage: '128GB', color: 'ดำ', category: 'PHONE_NEW',
        branchId: world.branches.a.id, costPrice, cashPrice: '12990', installmentPrice: '14990', imeiSerial: `${prefix}IMEI-${label}`, status: 'SOLD_CASH',
      } });
      return row.id;
    };
    const sale = async (label: string, data: {
      saleType: 'CASH' | 'INSTALLMENT' | 'EXTERNAL_FINANCE'; productId: string; netAmount: string; paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'CARD' | null;
      amountReceived?: string | null; financeAmount?: string | null; downPaymentAmount?: string | null; contractId?: string; snapshotCost?: string | null;
    }) => {
      const row = await h.prisma.sale.create({ data: {
        saleNumber: `${prefix}${label}`, saleType: data.saleType, customerId: world.customer.id, productId: data.productId, branchId: world.branches.a.id,
        salespersonId: world.users.salesA.id, sellingPrice: data.netAmount, netAmount: data.netAmount, paymentMethod: data.paymentMethod ?? null,
        amountReceived: data.amountReceived ?? null, financeAmount: data.financeAmount ?? null, downPaymentAmount: data.downPaymentAmount ?? null,
        contractId: data.contractId, notes: `${TEST_NAME_PREFIX} DOC-14 fixture ${label}`,
        ...(data.snapshotCost ? { costSnapshot: { create: { mainProductCost: data.snapshotCost } } } : {}),
      } });
      ids[label] = row.id;
      return row.id;
    };
    const booking = async (label: string, saleId: string, data: {
      depositAmount: string; depositPaidAt: Date | null; depositMethod: 'CASH' | 'BANK_TRANSFER' | 'CARD' | null; convertedAt: Date | null; productId: string | null;
    }) => {
      const row = await h.prisma.booking.create({ data: {
        bookingNumber: `${prefix}${label}`, customerId: world.customer.id, branchId: world.branches.a.id, status: 'CONVERTED', depositAmount: data.depositAmount, totalAmount: '12990',
        expireDate: new Date(Date.now() + 7 * 86_400_000), createdById: world.users.salesA.id, depositPaidAt: data.depositPaidAt, depositMethod: data.depositMethod,
        convertedToSaleId: saleId, convertedAt: data.convertedAt,
        items: { create: [{ productId: data.productId, description: data.productId ? 'เครื่องหลัก' : 'รายการเก่าไม่มีรหัสสินค้า (legacy item)', quantity: 1, unitPrice: '12990', amount: '12990' }] },
      } });
      ids[label] = row.id;
    };

    const paid = new Date('2026-09-01T03:00:00Z');
    // Q1 — cost snapshot: S1 legacy (no snapshot) · S2 snapshot equal · S3 snapshot ≠ current cost (drift, informational)
    await sale('S1-NO-SNAPSHOT', { saleType: 'CASH', productId: await product('S1', '8000'), netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', snapshotCost: null });
    await sale('S2-SNAPSHOT-EQUAL', { saleType: 'CASH', productId: await product('S2', '8000'), netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', snapshotCost: '8000' });
    const p3 = await product('S3', '8000');
    await sale('S3-SNAPSHOT-DRIFT', { saleType: 'CASH', productId: p3, netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', snapshotCost: '8000' });
    await h.prisma.product.update({ where: { id: p3 }, data: { costPrice: '8500' } }); // the current cost moved after the sale — must stay informational
    // S4 — installment sale bound to the world contract: counted by Q1 only when the contract is not DRAFT
    await sale('S4-INSTALLMENT-NO-SNAPSHOT', { saleType: 'INSTALLMENT', productId: world.contracts.a.productId, netAmount: '10000', contractId: world.contracts.a.id, snapshotCost: null });
    // Q3 — external finance: S5 received NULL (unknown) · S6 received 0 = down 0 (zero is evidence) · S7 received ≠ down (mismatch) · S8 equal (valid)
    await sale('S5-EXT-NULL', { saleType: 'EXTERNAL_FINANCE', productId: await product('S5', '8000'), netAmount: '12990', amountReceived: null, financeAmount: '9990', downPaymentAmount: '3000', snapshotCost: '8000' });
    await sale('S6-EXT-ZERO', { saleType: 'EXTERNAL_FINANCE', productId: await product('S6', '8000'), netAmount: '12990', amountReceived: '0', financeAmount: '12990', downPaymentAmount: '0', snapshotCost: '8000' });
    await sale('S7-EXT-MISMATCH', { saleType: 'EXTERNAL_FINANCE', productId: await product('S7', '8000'), netAmount: '12990', amountReceived: '5000', financeAmount: '9990', downPaymentAmount: '3000', snapshotCost: '8000' });
    await sale('S8-EXT-VALID', { saleType: 'EXTERNAL_FINANCE', productId: await product('S8', '8000'), netAmount: '12990', amountReceived: '3000', financeAmount: '9990', downPaymentAmount: '3000', snapshotCost: '8000' });
    // Q2 — bookings converted to sales: B1 deposit paid-at missing (unknown) · B2 consistent (valid) · B3 deposit ≠ down (mismatch) · B4 CARD deposit + legacy item without product (flagged by the method allow-list) · B5 zero deposit (valid)
    const pb1 = await product('B1', '8000');
    await booking('B1-NO-PAID-AT', await sale('S9-FROM-B1', { saleType: 'CASH', productId: pb1, netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', downPaymentAmount: '2000', snapshotCost: '8000' }), { depositAmount: '2000', depositPaidAt: null, depositMethod: 'CASH', convertedAt: paid, productId: pb1 });
    const pb2 = await product('B2', '8000');
    await booking('B2-VALID', await sale('S10-FROM-B2', { saleType: 'CASH', productId: pb2, netAmount: '12990', paymentMethod: 'BANK_TRANSFER', amountReceived: '12990', downPaymentAmount: '2000', snapshotCost: '8000' }), { depositAmount: '2000', depositPaidAt: paid, depositMethod: 'CASH', convertedAt: paid, productId: pb2 });
    const pb3 = await product('B3', '8000');
    await booking('B3-DEPOSIT-MISMATCH', await sale('S11-FROM-B3', { saleType: 'CASH', productId: pb3, netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', downPaymentAmount: '1500', snapshotCost: '8000' }), { depositAmount: '2000', depositPaidAt: paid, depositMethod: 'CASH', convertedAt: paid, productId: pb3 });
    const pb4 = await product('B4', '8000');
    await booking('B4-CARD-LEGACY-ITEM', await sale('S12-FROM-B4', { saleType: 'CASH', productId: pb4, netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', downPaymentAmount: '2000', snapshotCost: '8000' }), { depositAmount: '2000', depositPaidAt: paid, depositMethod: 'CARD', convertedAt: paid, productId: null });
    const pb5 = await product('B5', '8000');
    await booking('B5-ZERO-DEPOSIT', await sale('S13-FROM-B5', { saleType: 'CASH', productId: pb5, netAmount: '12990', paymentMethod: 'CASH', amountReceived: '12990', downPaymentAmount: '0', snapshotCost: '8000' }), { depositAmount: '0', depositPaidAt: paid, depositMethod: 'CASH', convertedAt: paid, productId: pb5 });
    saveArtifact(DOMAIN, 'fixture.json', JSON.stringify({ prefix, ids }, null, 2));
  }, 300000);

  afterAll(async () => {
    await h?.close();
  });

  it('the SQL file is the four SELECTs wrapped in a REPEATABLE READ READ ONLY transaction that ends with ROLLBACK', () => {
    expect(selects).toHaveLength(4);
    expect(statements[0]).toMatch(/^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/i);
    expect(statements[1]).toMatch(/^SET LOCAL statement_timeout/i);
    expect(statements[statements.length - 1]).toMatch(/^ROLLBACK$/i);
    expect(statements.some((s) => /^(update|insert|delete|alter|create|truncate)/i.test(s))).toBe(false);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/sql-provenance`, title: `docs/review/2026-09-11-sales/legacy-sales-audit.sql (sha256 ${sha256(readFileSync(SQL_PATH)).slice(0, 12)}…): BEGIN … READ ONLY + statement_timeout, 4 SELECTs, ROLLBACK — no writing statement`, routes: [], artifacts: [saveArtifact(DOMAIN, 'statements.json', JSON.stringify(statements, null, 2)).relativePath] }));
  });

  it('classifies the fixture: unknown vs zero vs mismatch vs valid, with cost drift kept informational', async () => {
    const before = plain(await h.prisma.$queryRawUnsafe('SELECT (SELECT count(*) FROM sales) AS sales, (SELECT count(*) FROM bookings) AS bookings, (SELECT count(*) FROM sale_cost_snapshots) AS snapshots, (SELECT max(updated_at) FROM sales) AS sales_updated, (SELECT max(updated_at) FROM bookings) AS bookings_updated')) as Row[];
    const contract = await h.prisma.contract.findUniqueOrThrow({ where: { id: world.contracts.a.id }, select: { status: true } });

    const results = await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '30s'`);
      const out: Row[][] = [];
      for (const query of selects) out.push(plain(await tx.$queryRawUnsafe(query)) as Row[]);
      // The prefixed variant of Q1 is the only derived query: the count is global by design, the assertion needs the fixture alone.
      out.push(plain(await tx.$queryRawUnsafe(`${selects[0]} AND s.sale_number LIKE $1`, `${prefix}%`)) as Row[]);
      return out;
    });
    const [q1, q2, q3, q4, q1Prefixed] = results;
    const mine = (rows: Row[]) => rows.filter((r) => String(r.sale_number).startsWith(prefix));
    const labels = (rows: Row[]) => mine(rows).map((r) => String(r.sale_number).slice(prefix.length)).sort();

    const s4Counted = contract.status !== 'DRAFT';
    expect(Number(q1Prefixed[0].completed_sales_without_cost_snapshot)).toBe(s4Counted ? 2 : 1);
    expect(Number(q1[0].completed_sales_without_cost_snapshot)).toBeGreaterThanOrEqual(s4Counted ? 2 : 1);
    expect(labels(q2)).toEqual(['S11-FROM-B3', 'S12-FROM-B4', 'S9-FROM-B1']);
    expect(labels(q3)).toEqual(['S5-EXT-NULL', 'S7-EXT-MISMATCH']);
    expect(labels(q4)).toEqual(['S3-SNAPSHOT-DRIFT']);
    // zero is evidence, null is not — the two must never collapse into one class
    const s5 = mine(q3).find((r) => String(r.sale_number).endsWith('S5-EXT-NULL'));
    expect(s5 && num(s5.amount_received)).toBeNull();
    expect(mine(q3).some((r) => String(r.sale_number).endsWith('S6-EXT-ZERO'))).toBe(false);
    const b1 = mine(q2).find((r) => String(r.sale_number).endsWith('S9-FROM-B1'));
    expect(b1 && b1.deposit_paid_at).toBeNull();
    const drift = mine(q4)[0];
    expect({ snapshot: num(drift.main_product_cost), current: num(drift.current_product_cost) }).toEqual({ snapshot: 8000, current: 8500 });
    const snapshotAfter = await h.prisma.saleCostSnapshot.findUniqueOrThrow({ where: { saleId: ids['S3-SNAPSHOT-DRIFT'] } });
    expect(String(snapshotAfter.mainProductCost)).toBe('8000'); // history untouched by the drift report

    const after = plain(await h.prisma.$queryRawUnsafe('SELECT (SELECT count(*) FROM sales) AS sales, (SELECT count(*) FROM bookings) AS bookings, (SELECT count(*) FROM sale_cost_snapshots) AS snapshots, (SELECT max(updated_at) FROM sales) AS sales_updated, (SELECT max(updated_at) FROM bookings) AS bookings_updated')) as Row[];
    expect(after).toEqual(before);

    const classification = {
      contractStatusOfS4: contract.status,
      Q1_completed_sales_without_cost_snapshot: { global: Number(q1[0].completed_sales_without_cost_snapshot), fixture: Number(q1Prefixed[0].completed_sales_without_cost_snapshot), expectedUnknown: ['S1-NO-SNAPSHOT', ...(s4Counted ? ['S4-INSTALLMENT-NO-SNAPSHOT'] : [])], notCandidates: ['S2-SNAPSHOT-EQUAL', 'S3-SNAPSHOT-DRIFT', 'S5…S13 (all carry a snapshot)'] },
      Q2_booking_evidence: { globalRows: q2.length, fixtureRows: labels(q2), classes: { 'S9-FROM-B1': 'expected unknown — deposit_paid_at never recorded', 'S11-FROM-B3': 'mismatch — deposit 2000 vs down payment 1500', 'S12-FROM-B4': 'flagged by the method allow-list (CARD) + legacy item without product — reviewer decides false positive vs defect' }, notCandidates: ['S10-FROM-B2 (consistent)', 'S13-FROM-B5 (zero deposit, fully paid at sale)'] },
      Q3_external_finance: { globalRows: q3.length, fixtureRows: labels(q3), classes: { 'S5-EXT-NULL': 'expected unknown — amount_received NULL', 'S7-EXT-MISMATCH': 'mismatch — received 5000 vs down 3000' }, notCandidates: ['S6-EXT-ZERO (0 = 0, zero is evidence)', 'S8-EXT-VALID (3000 = 3000)'] },
      Q4_cost_drift: { globalRows: q4.length, fixtureRows: labels(q4), classes: { 'S3-SNAPSHOT-DRIFT': 'informational — snapshot 8000 vs current 8500, snapshot left untouched' } },
      rowCountsBeforeAfter: { before, after },
    };
    const artifacts = [
      saveArtifact(DOMAIN, 'results.json', JSON.stringify({ q1, q1Prefixed, q2: mine(q2), q3: mine(q3), q4: mine(q4), globalRowCounts: { q2: q2.length, q3: q3.length, q4: q4.length } }, null, 2)).relativePath,
      saveArtifact(DOMAIN, 'classification.json', JSON.stringify(classification, null, 2)).relativePath,
    ];
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/fixture-classification`, title: `13 fixture sales + 5 converted bookings → Q1 ${classification.Q1_completed_sales_without_cost_snapshot.fixture} unknown-cost, Q2 ${labels(q2).length} booking candidates (1 unknown / 1 mismatch / 1 allow-list), Q3 ${labels(q3).length} external-finance candidates (1 NULL / 1 mismatch; 0-baht row NOT flagged), Q4 1 cost drift (informational) — row counts and updated_at identical before/after`, routes: [], artifacts, notes: `S4 bound to contract ${contract.status} → ${s4Counted ? 'counted' : 'excluded'} by Q1; the SQL's deposit-method allow-list (CASH/BANK_TRANSFER/QR_EWALLET) flags CARD and CREDIT_BALANCE/ONLINE_GATEWAY deposits — those need the receipt before they are called defects; booking_items are not inspected by the SQL (legacy item without product surfaced only through the CARD row)` }));
  });

  it('the diagnostic session cannot write: an UPDATE inside the same READ ONLY transaction is rejected (SQLSTATE 25006)', async () => {
    const failures: Array<{ code: unknown; message: string }> = [];
    await h.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await tx.$queryRawUnsafe(selects[0]);
      await tx.$executeRawUnsafe('UPDATE sales SET notes = notes WHERE sale_number = $1', `${prefix}S1-NO-SNAPSHOT`);
    }).catch((error: { code?: unknown; meta?: { code?: unknown; message?: unknown }; message?: unknown }) => {
      failures.push({ code: error?.meta?.code ?? error?.code, message: String(error?.meta?.message ?? error?.message ?? error) });
    });
    expect(failures).toHaveLength(1);
    const failure = failures[0];
    expect(`${failure.code} ${failure.message}`).toMatch(/25006|read-only transaction/);
    const row = await h.prisma.sale.findUniqueOrThrow({ where: { id: ids['S1-NO-SNAPSHOT'] }, select: { notes: true, updatedAt: true } });
    expect(row.notes).toBe(`${TEST_NAME_PREFIX} DOC-14 fixture S1-NO-SNAPSHOT`);
    recordScenario(DOMAIN, scenario({ id: `${DOMAIN}/read-only-guarantee`, title: `UPDATE inside the READ ONLY transaction → ${failure.code} (${failure.message.slice(0, 80)}); fixture row unchanged`, routes: [], artifacts: [saveArtifact(DOMAIN, 'read-only-probe.json', JSON.stringify(failure, null, 2)).relativePath] }));
  });

  it('historical audit on authorised data — BLOCKED (fixture evidence only)', () => {
    recordScenario(DOMAIN, scenario({
      id: `${DOMAIN}/historical-audit`, status: 'BLOCKED', routes: [], artifacts: [],
      title: 'No owner-authorised historical dataset or source documents (receipts / JE) were available to this run — the SQL is proven on the fixture only; nothing about real data passing is claimed',
      unverified: ['production / staging rows after the sale_cost_snapshot migration', 'candidate-by-candidate comparison against receipts, journal entries and source documents', 'the per-group defect / expected-unknown / false-positive tally on real data'],
    }));
  });
});
