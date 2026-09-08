import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { acquireLock, owned, repo, run } from './local-preview.mjs';

test('active commands are excluded and interrupted commands do not leave permanent locks', () => {
  const name = `test-${randomUUID()}`;
  const release = acquireLock(name);
  try { assert.throws(() => acquireLock(name), /Another local/); } finally { release(); }
  const moduleUrl = pathToFileURL(join(repo, 'tools/local-preview.mjs')).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { acquireLock } from ${JSON.stringify(moduleUrl)}; acquireLock(${JSON.stringify(name)}); process.kill(process.pid, 'SIGTERM');`]);
  assert.equal(child.signal, 'SIGTERM');
  const recovered = acquireLock(name);
  recovered();
});

test('only the same checkout and live run in synthetic mode can be managed', () => {
  const state = { repo, runId: 'our-run' };
  const info = { repoRoot: repo, runId: 'our-run', isolated: true, ocr: 'mock', storage: 'local-files' };
  assert.equal(owned(state, info), true);
  for (const change of [{ repoRoot: '/another-checkout' }, { runId: 'another-run' }, { isolated: false }, { ocr: 'real' }, { storage: 'gcs' }]) {
    assert.equal(owned(state, { ...info, ...change }), false);
  }
  assert.equal(owned({ repo }, { ...info, runId: undefined }), false);
});

test('failed checks propagate an error instead of continuing', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'process.exit(7)']), /failed \(7\)/);
});

test('logging check output retains failures and diagnostic text', async () => {
  const root = mkdtempSync('/tmp/bc-local-check-log.');
  const log = join(root, 'check.log');
  try {
    await assert.rejects(run(process.execPath, ['-e', 'console.error("fixture-check-failure"); process.exit(7)'], repo, log), /failed \(7\)/);
    assert.match(readFileSync(log, 'utf8'), /fixture-check-failure/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('legacy check script stops on lint errors and never prints success', () => {
  const root = mkdtempSync('/tmp/bc-local-check-test.');
  try {
    for (const path of ['tools', 'apps/api', 'apps/web', 'bin']) mkdirSync(join(root, path), { recursive: true });
    copyFileSync(join(repo, 'tools/run-tests.sh'), join(root, 'tools/run-tests.sh'));
    writeFileSync(join(root, 'tools/check-types.sh'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o700 });
    writeFileSync(join(root, 'bin/npx'), '#!/usr/bin/env bash\necho lint-failed >&2\nexit 7\n', { mode: 0o700 });
    const result = spawnSync('bash', [join(root, 'tools/run-tests.sh'), '--skip-e2e'], {
      cwd: '/tmp', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}` }, encoding: 'utf8',
    });
    assert.equal(result.status, 7);
    assert.match(result.stderr, /lint-failed/);
    assert.doesNotMatch(result.stdout, /All checks passed|check manually/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
