import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function collect(config) {
  const result = spawnSync('node_modules/.bin/jest', ['--config', `apps/api/e2e/${config}`, '--listTests', '--runInBand', '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).map(path => path.split('/').at(-1));
}

test('CI collects the isolated credit specs exactly once, outside the shared service database suite', () => {
  const defaults = collect('jest-e2e.json');
  const isolated = collect('jest-chat-credit.json');
  for (const file of ['chat-credit-check.e2e-spec.ts', 'credit-approval.e2e-spec.ts', 'credit-payment-flow.e2e-spec.ts']) {
    assert.ok(!defaults.includes(file), `${file} must not run against the shared CI service database`);
    assert.ok(isolated.includes(file), `${file} must run in the dedicated suite`);
  }
  const workflow = readFileSync('.github/workflows/deploy-gcp.yml', 'utf8');
  assert.match(workflow, /needs: \[[^\]]*test-chat-credit/);
  assert.match(workflow, /run: bash tools\/test-chat-credit.sh/);
});
