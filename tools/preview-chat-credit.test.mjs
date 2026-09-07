import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('a failed preview start never stops an already running PostgreSQL instance', () => {
  const root = mkdtempSync('/tmp/bc-chat-credit.ownership-');
  const bin = join(root, 'fake-pg');
  const log = join(root, 'commands.log');
  mkdirSync(bin); mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'data/PG_VERSION'), '16');
  writeFileSync(log, '');
  writeFileSync(join(bin, 'pg_ctl'), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$CREDIT_START_TEST_LOG"\nexit 1\n', { mode: 0o700 });
  try {
    const run = spawnSync('bash', ['tools/preview-chat-credit.sh'], { env: { ...process.env, CREDIT_PREVIEW_DIR: root, CREDIT_PG_BIN: bin, CREDIT_START_TEST_LOG: log }, encoding: 'utf8' });
    assert.equal(run.status, 1);
    assert.doesNotMatch(readFileSync(log, 'utf8'), /\bstop\b/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('browser verification refuses real storage before creating any fixture', () => {
  const stub = `globalThis.fetch = async url => {
    if (String(url).endsWith('/preview/info')) return Response.json({ isolated: true, ocr: 'mock', storage: 'gcs' });
    throw new Error('UNEXPECTED_MUTATION');
  };`;
  const run = spawnSync(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(stub)}`, 'tools/check-chat-credit-preview.mjs'], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.doesNotMatch(run.stderr, /UNEXPECTED_MUTATION/);
  assert.match(run.stderr, /local-files/);
});
