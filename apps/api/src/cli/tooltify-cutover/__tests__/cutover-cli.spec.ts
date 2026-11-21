import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkoutRevision, runCutover, type CliDependencies } from '../../tooltify-cutover.cli';
import type { ImportPlan } from '../types';

const confirm = 'YES_I_AM_SURE';
const args = ['apply', '--apply', '--plan-hash', 'reviewed', '--manifest', 'fixture.json'];
function fixture() {
  const zero = { units: 0, cost: '0.00' };
  const stage = { kind: 'STOCK', totals: zero, groups: [] };
  const plan = {
    kind: 'SALES',
    planHash: 'reviewed',
    codeRevision: 'code',
    dbIdentity: 'fingerprint',
    manifestHash: 'manifest',
    issues: [],
    items: [],
    excluded: [],
    totals: { conflicts: 0 },
    reconciliationSnapshot: {
      uniquePhysicalRows: 0,
      cannotVerifySource: false,
      canonical: stage,
      adjustments: stage,
      source: { kind: 'STOCK', detail: zero, groups: [] },
    },
  } as unknown as ImportPlan;
  const deps = {
    env: {
      EXPECTED_DB_NAME: 'bc_vitest_test',
      EXPECTED_DB_FINGERPRINT: 'fingerprint',
      CONFIRM_TOOLTIFY_IMPORT: confirm,
    },
    verifySocket: jest.fn(async () => true),
    identity: jest.fn(async () => ({
      database: 'bc_vitest_test',
      host: '/tmp/bc-vitest-db.AbC123/socket',
      port: '55477',
      schema: 'public',
      fingerprint: 'fingerprint',
    })),
    prepare: jest.fn(async () => plan),
    apply: jest.fn(async () => ({ batchId: 'b', status: 'APPLIED' })),
    report: jest.fn(),
    inspect: jest.fn(),
    reconcile: jest.fn(),
    verify: jest.fn(async () => ({ canOpen: true })),
  };
  return { deps: deps as unknown as CliDependencies, calls: deps, plan };
}
describe('operational cutover guards', () => {
  it('defaults to dry-run, ignoring legacy write flags', async () => {
    const { deps, calls } = fixture();
    deps.env.CONFIRM_IMPORT = confirm;
    expect(await runCutover(['--manifest', 'fixture.json'], deps)).toBe(0);
    expect(calls.prepare).toHaveBeenCalled();
    expect(calls.apply).not.toHaveBeenCalled();
  });
  it.each(['EXPECTED_DB_NAME', 'EXPECTED_DB_FINGERPRINT', 'CONFIRM_TOOLTIFY_IMPORT'])(
    'requires %s before writing',
    async (key) => {
      const { deps, calls } = fixture();
      for (const wrong of [undefined, 'incorrect']) {
        deps.env[key] = wrong;
        expect(await runCutover(args, deps)).not.toBe(0);
        expect(calls.apply).not.toHaveBeenCalled();
      }
    },
  );
  it('fails_before_write_when_plan_changed', async () => {
    const { deps, calls } = fixture();
    expect(
      await runCutover(
        ['apply', '--apply', '--plan-hash', 'stale', '--manifest', 'fixture.json'],
        deps,
      ),
    ).not.toBe(0);
    expect(calls.apply).not.toHaveBeenCalled();
  });
  it('requires complete evidence and a clean plan', async () => {
    const { deps, calls, plan } = fixture();
    plan.reconciliationSnapshot.cannotVerifySource = true;
    expect(await runCutover(args, deps)).not.toBe(0);
    plan.reconciliationSnapshot.cannotVerifySource = false;
    plan.issues.push({ code: 'UNRESOLVED_SOURCE_DECISION', source: null, message: '' });
    expect(await runCutover(args, deps)).not.toBe(0);
    expect(calls.apply).not.toHaveBeenCalled();
  });
  it('requires a client-side local harness socket even when server identity resembles a test host', async () => {
    const { deps, calls } = fixture();
    calls.verifySocket.mockResolvedValue(false);
    expect(await runCutover(args, deps)).toBe(1);
    expect(calls.apply).not.toHaveBeenCalled();
  });
  it.each([
    ['apply', '--manifest', 'f'],
    ['apply', '--plan-hash', 'reviewed', '--manifest', 'f'],
    ['apply', '--apply', '--manifest', 'f'],
    ['rollback', '--apply', '--manifest', 'f'],
    ['rollback-dry-run', '--manifest', 'f'],
  ])('blocks incomplete or unavailable write mode %s', async (...argv) => {
    const { deps, calls } = fixture();
    expect(await runCutover(argv, deps)).toBe(1);
    expect(calls.apply).not.toHaveBeenCalled();
    expect(calls.verify).not.toHaveBeenCalled();
  });
  it('exits nonzero when the committed batch cannot be verified', async () => {
    const { deps, calls } = fixture();
    calls.verify.mockResolvedValue({ canOpen: false });
    expect(await runCutover(args, deps)).toBe(1);
    expect(calls.apply).toHaveBeenCalledTimes(1);
    expect(calls.verify).toHaveBeenCalledTimes(1);
  });
  it('requires additional confirmation for unproven servers even under NODE_ENV=test', async () => {
    const { deps, calls } = fixture();
    deps.env.NODE_ENV = 'test';
    calls.identity.mockResolvedValue({ ...(await calls.identity()), host: '127.0.0.1' });
    expect(await runCutover(args, deps)).not.toBe(0);
    expect(calls.apply).not.toHaveBeenCalled();
    deps.env.ALLOW_PROD_TOOLTIFY_IMPORT = confirm;
    expect(await runCutover(args, deps)).toBe(0);
    expect(calls.apply).toHaveBeenCalledTimes(1);
  });
});

it('rejects changed code at the same HEAD', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tooltify-revision-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  try {
    git('init', '-q');
    const source = join(dir, 'apps/api/src/cli/tooltify-cutover.cli.ts');
    await mkdir(join(dir, 'apps/api/src/cli'), { recursive: true });
    await writeFile(source, 'export const value=1;');
    await writeFile(join(dir, '.gitignore'), 'dist/\n');
    git('add', '.');
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    );
    const rev = checkoutRevision(true, dir, source);
    const compiled = join(dir, 'dist', 'tooltify-cutover.cli.js');
    await mkdir(join(dir, 'dist'));
    await writeFile(compiled, 'module.exports={}');
    const { deps, calls, plan } = fixture();
    calls.prepare.mockImplementation(async () => {
      checkoutRevision(true, dir, compiled);
      return plan;
    });
    expect(await runCutover(args, deps)).toBe(1);
    expect(calls.report).toHaveBeenCalledWith({ error: 'TRACKED_SOURCE_ENTRY_REQUIRED' });
    expect(calls.apply).not.toHaveBeenCalled();
    await writeFile(source, 'export const value=2;');
    expect(checkoutRevision(false, dir, source)).toBe(rev + '-dirty');
    expect(() => checkoutRevision(true, dir, source)).toThrow('CLEAN_REVIEWED_CHECKOUT_REQUIRED');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(['import-tooltify', 'import-tooltify-stock'])(
  '%s rejects legacy writes before connecting without a manifest',
  (name) => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve(__dirname, '../../' + name + '.cli.ts')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          DATABASE_URL: 'invalid',
          CONFIRM_IMPORT: 'YES_I_AM_SURE',
          CONFIRM_IMPORT_STOCK: 'YES_I_AM_SURE',
          IMPORT_AS_IS: '1',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('MANIFEST_REQUIRED');
  },
);

it('refuses read-only reconciliation for the other pinned kind', async () => {
  const { deps, calls } = fixture();
  calls.reconcile.mockResolvedValue({ kind: 'SALES', canOpen: true });
  expect(
    await runCutover(
      [
        'reconcile',
        '--source-kind',
        'current-stock-snapshot',
        '--batch-id',
        'b',
        '--manifest',
        'f',
      ],
      deps,
    ),
  ).toBe(1);
  expect(calls.report).toHaveBeenCalledWith({ error: 'BATCH_KIND_MISMATCH' });
});
