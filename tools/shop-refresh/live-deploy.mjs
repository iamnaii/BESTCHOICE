#!/usr/bin/env node
/**
 * หาคอมมิตที่หน้าร้านขึ้นเว็บอยู่จริง + deploy หลักกำลังรันไหม — รอบ build ตั้งเวลา (.github/workflows/shop-refresh.yml)
 *
 *   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node tools/shop-refresh/live-deploy.mjs
 *   → เขียน sha / run_url / busy / busy_url ลง $GITHUB_OUTPUT (ไม่มีตัวแปรนี้ = พิมพ์ออกจอ)
 *
 * กติกา:
 * - "ขึ้นเว็บอยู่" = run ล่าสุดของ deploy-gcp.yml บน main (push หรือกดรันเอง) ที่ job `Deploy Web to Firebase Hosting`
 *   สำเร็จ — ไม่ใช่หัว main: โค้ดที่ยังไม่ผ่านเทส/deploy ล้ม ต้องไม่หลุดขึ้นเว็บทางรอบตั้งเวลา
 * - นับ job จากทุก attempt (filter=all) — กด "Re-run failed jobs" แล้ว deploy-web ของ attempt แรกยังนับ
 * - "busy" = run ของ deploy-gcp.yml บน main ที่ยังไม่จบ ⇒ รอบตั้งเวลาข้าม (ห้ามใช้ concurrency group
 *   ร่วมกับ deploy หลัก — GitHub ยกเลิก run ที่รอคิวเมื่อมี run ใหม่เข้า group เดียวกัน)
 * - เปลี่ยนชื่อ job deploy-web ใน deploy-gcp.yml ต้องแก้ DEPLOY_JOB_NAME ด้วย (เทสอ่านไฟล์จริงจับให้)
 *
 * ไม่มี dependency — รันด้วย node ได้เลยโดยไม่ต้อง npm ci
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEPLOY_WORKFLOW = 'deploy-gcp.yml';
export const DEPLOY_JOB_NAME = 'Deploy Web to Firebase Hosting';
const DEPLOY_EVENTS = new Set(['push', 'workflow_dispatch']);
const RUNS_TO_SCAN = 30;

/** run ที่ deploy เว็บได้จริง — main จาก push / กดรันเอง (run ของ PR ไม่ deploy) */
const isMainDeployRun = (run) => run.head_branch === 'main' && DEPLOY_EVENTS.has(run.event);

/** deploy หลักที่ยังไม่จบ (รอคิว / กำลังรัน / รออนุมัติ) */
export function busyDeployRuns(runs) {
  return runs.filter((run) => isMainDeployRun(run) && run.status !== 'completed');
}

/**
 * @param api (path) => Promise<json> — path ต่อจาก /repos/{owner}/{repo}/
 * @returns { sha, runUrl, busy } — sha = null เมื่อหาไม่พบใน RUNS_TO_SCAN run ล่าสุด
 */
export async function findLiveDeploy(api) {
  const { workflow_runs: runs = [] } = await api(
    `actions/workflows/${DEPLOY_WORKFLOW}/runs?branch=main&per_page=${RUNS_TO_SCAN}`,
  );
  const busy = busyDeployRuns(runs);
  // GitHub คืน run ใหม่ก่อน — run แรกที่ deploy-web สำเร็จคือคอมมิตที่ขึ้นเว็บอยู่
  // (concurrency ของ deploy-gcp.yml เรียง run ตามลำดับที่สร้าง จึงไม่มี run เก่า deploy ทับ run ใหม่)
  for (const run of runs) {
    if (!isMainDeployRun(run)) continue;
    const { jobs = [] } = await api(`actions/runs/${run.id}/jobs?filter=all&per_page=100`);
    if (jobs.some((job) => job.name === DEPLOY_JOB_NAME && job.conclusion === 'success')) {
      return { sha: run.head_sha, runUrl: run.html_url, busy };
    }
  }
  return { sha: null, runUrl: null, busy };
}

function githubApi(repo, token, base) {
  return async (path) => {
    const res = await fetch(`${base}/repos/${repo}/${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`GitHub API ${path} → ${res.status}`);
    return res.json();
  };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('ต้องตั้ง GITHUB_REPOSITORY และ GH_TOKEN');
  const base = process.env.GITHUB_API_URL || 'https://api.github.com';

  const { sha, runUrl, busy } = await findLiveDeploy(githubApi(repo, token, base));
  const outputs = {
    sha: sha ?? '',
    run_url: runUrl ?? '',
    busy: busy.length > 0 ? 'true' : 'false',
    busy_url: busy[0]?.html_url ?? '',
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  console.log(lines.join('\n'));

  if (!sha) {
    console.error(
      `ไม่พบ run ของ ${DEPLOY_WORKFLOW} บน main ที่ job "${DEPLOY_JOB_NAME}" สำเร็จใน ${RUNS_TO_SCAN} run ล่าสุด`,
    );
    return 1;
  }
  return 0;
}

// exitCode แทน process.exit() — ดูเหตุผลใน sitemap-products.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(err.message);
      process.exitCode = 1;
    },
  );
}
