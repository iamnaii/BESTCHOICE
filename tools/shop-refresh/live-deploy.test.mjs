// node --test tools/shop-refresh/live-deploy.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEPLOY_JOB_NAME,
  DEPLOY_WORKFLOW,
  busyDeployRuns,
  findLiveDeploy,
} from './live-deploy.mjs';

test('ชื่อ job ตรงกับ job deploy-web ใน deploy-gcp.yml จริง (เปลี่ยนชื่อ job ⇒ รอบตั้งเวลาหาคอมมิตไม่เจอ)', () => {
  const yml = readFileSync(
    new URL(`../../.github/workflows/${DEPLOY_WORKFLOW}`, import.meta.url),
    'utf8',
  ).replace(/\r\n/g, '\n'); // checkout บน Windows ได้ CRLF
  // ทั้งบล็อกของ job (บรรทัดเยื้อง ≥ 4 ช่อง หรือบรรทัดว่าง) จนถึง key ระดับ job ถัดไป
  const block = yml.match(/\n {2}deploy-web:\n(?:(?: {4}.*)?\n)+/)?.[0] ?? '';
  assert.match(block, new RegExp(`\\n {4}name: ${DEPLOY_JOB_NAME}\\n`));
  // job นี้เป็นตัว deploy hosting:shop — ถ้าย้ายไป job อื่น "deploy-web สำเร็จ" จะไม่ได้แปลว่าหน้าร้านขึ้นแล้ว
  assert.match(block, /--only hosting:shop/);
});

const run = (id, over = {}) => ({
  id,
  head_sha: `sha${id}`,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  ...over,
});
const deployJob = (conclusion) => ({ name: DEPLOY_JOB_NAME, conclusion });

/** API ปลอม: runs เรียงใหม่ก่อน (แบบที่ GitHub คืน) + jobs ต่อ run · จดทุก path ที่ถูกเรียก */
function fakeApi(runs, jobsByRun) {
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (path.startsWith('actions/workflows/')) return { workflow_runs: runs };
    const id = Number(path.match(/^actions\/runs\/(\d+)\/jobs/)?.[1]);
    return { jobs: jobsByRun[id] ?? [] };
  };
  return { api, calls };
}

test('busyDeployRuns: นับเฉพาะ run ของ main จาก push/กดรันเองที่ยังไม่จบ', () => {
  const runs = [
    run(1, { status: 'in_progress' }),
    run(2, { status: 'queued', event: 'workflow_dispatch' }),
    run(3, { status: 'waiting' }),
    run(4, { status: 'in_progress', event: 'pull_request', head_branch: 'feat/x' }),
    run(5, { status: 'in_progress', head_branch: 'feat/y' }),
    run(6),
  ];
  assert.deepEqual(
    busyDeployRuns(runs).map((r) => r.id),
    [1, 2, 3],
  );
});

test('findLiveDeploy: ข้าม run ที่ deploy-web ยังไม่สำเร็จ แล้วคืนคอมมิตของ run ล่าสุดที่ deploy-web สำเร็จ', async () => {
  const runs = [run(30, { status: 'in_progress' }), run(20), run(10)];
  const { api, calls } = fakeApi(runs, {
    30: [{ name: 'Build Web + Web-Shop', conclusion: 'success' }, deployJob(null)],
    20: [deployJob('failure')],
    10: [deployJob('success'), { name: 'Deploy API to Cloud Run', conclusion: 'failure' }],
  });
  const result = await findLiveDeploy(api);
  assert.equal(result.sha, 'sha10');
  assert.equal(result.runUrl, 'https://github.com/o/r/actions/runs/10');
  assert.deepEqual(
    result.busy.map((r) => r.id),
    [30],
  );
  // ขอ jobs ทุก attempt — re-run เฉพาะ job ที่ล้มไม่ทำให้ deploy-web ของ attempt แรกหาย
  assert.ok(calls.includes('actions/runs/10/jobs?filter=all&per_page=100'));
  assert.ok(calls[0].startsWith('actions/workflows/deploy-gcp.yml/runs?branch=main'));
});

test('findLiveDeploy: deploy-web สำเร็จแล้วแม้ run ยังไม่จบ (deploy-api ยังรัน) ⇒ คอมมิตนั้นขึ้นเว็บแล้ว', async () => {
  const { api } = fakeApi([run(40, { status: 'in_progress' }), run(30)], {
    40: [deployJob('success')],
    30: [deployJob('success')],
  });
  const result = await findLiveDeploy(api);
  assert.equal(result.sha, 'sha40');
  assert.equal(result.busy.length, 1);
});

test('findLiveDeploy: run ของ PR ไม่นับแม้มี job ชื่อเดียวกันสำเร็จ', async () => {
  const { api } = fakeApi([run(50, { event: 'pull_request', head_branch: 'main' }), run(10)], {
    50: [deployJob('success')],
    10: [deployJob('success')],
  });
  assert.equal((await findLiveDeploy(api)).sha, 'sha10');
});

test('findLiveDeploy: ไม่มี run ไหน deploy-web สำเร็จ (หรือ job ถูกเปลี่ยนชื่อ) ⇒ sha = null', async () => {
  const { api } = fakeApi([run(10), run(5)], {
    10: [{ name: 'Deploy Web', conclusion: 'success' }],
    5: [deployJob('skipped')],
  });
  assert.equal((await findLiveDeploy(api)).sha, null);
});
