// Build the API first: npm run build --workspace=@installment/api
// Run with production Node 20 (npm exec uses its cache; no project/global install):
// npm exec --yes --package=node@20 -- node tools/verify-shared-runtime.cjs .
// The optional argument is the repository root; default is this script's parent directory.
// Only copies compiled artifacts into a temporary runtime; always removes it afterward.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const workspace = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
assert.equal(process.versions.node.split('.')[0], '20', 'This smoke must use Node 20');
for (const artifact of ['apps/api/dist/src/utils/installment-calc.util.js', 'packages/shared/dist/index.js']) {
  assert(fs.existsSync(path.join(workspace, artifact)), `Missing ${artifact}; run npm run build --workspace=@installment/api first`);
}
const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bestchoice-calculator-node20-'));
try {
  const copy = (source, target) => {
    const destination = path.join(runtimeRoot, target);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, { recursive: true });
  };
  copy(path.join(workspace, 'apps/api/dist/src/utils/installment-calc.util.js'), 'apps/api/dist/src/utils/installment-calc.util.js');
  copy(path.join(workspace, 'packages/shared/package.json'), 'packages/shared/package.json');
  copy(path.join(workspace, 'packages/shared/dist'), 'packages/shared/dist');
  copy(path.dirname(require.resolve('decimal.js', { paths: [workspace] })), 'node_modules/decimal.js');
  fs.mkdirSync(path.join(runtimeRoot, 'node_modules/@installment'), { recursive: true });
  fs.symlinkSync('../../packages/shared', path.join(runtimeRoot, 'node_modules/@installment/shared'));
  assert(!fs.existsSync(path.join(runtimeRoot, 'packages/shared/src')));
  const output = execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const path = require('node:path');
    const Decimal = require('decimal.js');
    const shared = require('@installment/shared');
    const api = require('./apps/api/dist/src/utils/installment-calc.util');
    const functions = ['calcBcInstallment', 'calcGfinInstallment', 'findGfinMapping', 'findGfinOverpriceRule'];
    for (const name of functions) assert.equal(api[name], shared[name]);
    assert(require.resolve('@installment/shared').endsWith('/packages/shared/dist/index.js'));
    const bc = api.calcBcInstallment({
      installmentPrice: new Decimal(19900),
      months: 12,
      config: {
        minDownPct: new Decimal('0.15'),
        commissionPct: new Decimal('0.10'),
        vatPct: new Decimal('0.07'),
        ratePctByMonths: new Map([[12, new Decimal('0.50')]]),
        allowedMonths: [12],
      },
    });
    assert.equal(bc.isValid, true);
    assert.equal(bc.monthlyPayment.toFixed(2), '2413.21');
    assert.equal(bc.totalWithVat.toFixed(2), '28958.48');
    const product = { brand: 'Apple', model: 'iPhone 14 Pro', storage: '128 GB', category: 'PHONE_USED' };
    const mappings = [{ id: 'm1', gfinSeries: 'iPhone 14', gfinVariant: 'Pro', storage: '128GB', condition: 'HAND_2', maxPrice: new Decimal('21500'), modelMatchPattern: 'iPhone 14 Pro', isActive: true }];
    const rules = [{ id: 'r1', label: 'Used iPhone 14', seriesPattern: 'iPhone 14|iPhone 15', condition: 'HAND_2', allowance: new Decimal('1000'), isActive: true }];
    const mapping = api.findGfinMapping(product, mappings);
    assert.equal(mapping.id, 'm1');
    const overpriceRule = api.findGfinOverpriceRule(mapping, rules);
    assert.equal(overpriceRule.id, 'r1');
    const gfin = api.calcGfinInstallment({
      installmentPrice: new Decimal('19900'), product, months: 12, mapping, overpriceRule,
      rateFactor: { months: 12, factor: new Decimal('0.179238'), feePerInstallment: new Decimal('100'), isActive: true },
    });
    assert.equal(gfin.isValid, true);
    assert.equal(gfin.monthlyPayment.toFixed(2), '2923.00');
    assert.equal(gfin.totalPayback.toFixed(2), '35076.00');
    assert.equal(gfin.downAmountActual.toFixed(2), '4150.00');
    assert(Object.keys(require.cache).every(file => !file.endsWith('.ts')));
    assert(Object.keys(require.cache).every(file => file.startsWith(process.cwd() + path.sep)), 'All runtime modules must resolve within the isolated layout');
    console.log(JSON.stringify({
      node: process.version,
      layout: 'compiled API utility + shared dist/package.json + decimal.js + npm workspace symlink',
      sourceFilesAvailable: false,
      tsRuntimeHooks: false,
      identicalApiSharedFunctions: functions,
      bc: { monthlyPayment: bc.monthlyPayment.toFixed(2), totalWithVat: bc.totalWithVat.toFixed(2) },
      gfin: { monthlyPayment: gfin.monthlyPayment.toFixed(2), totalPayback: gfin.totalPayback.toFixed(2), actualDown: gfin.downAmountActual.toFixed(2) },
      status: 'PASS',
    }, null, 2));
  `], { cwd: runtimeRoot, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  process.stdout.write(output);
} finally {
  fs.rmSync(runtimeRoot, { recursive: true, force: true });
}
