/**
 * Post-build prerender — snapshot หน้า marketing ของ SPA เป็น HTML จริงต่อ route
 *
 * ทำไม: AI crawlers (GPTBot / ClaudeBot / PerplexityBot) และ Bing ไม่รัน JavaScript —
 * SPA เปล่า ๆ ทำให้พวกมันเห็นแค่ <div id="root"></div>. สคริปต์นี้เปิด dist ผ่าน
 * `vite preview` แล้วใช้ headless Chromium เก็บ DOM ที่เรนเดอร์เสร็จ (รวม title/meta/
 * canonical/OG ที่ usePageMeta stamp แล้ว) เขียนเป็น dist/<route>/index.html —
 * Firebase Hosting เสิร์ฟไฟล์ตรงก่อนถึง rewrite ** → /index.html เสมอ
 *
 * - เรียกผ่าน `npm run build:prerender` (build ปกติของ PR gate ไม่แตะสคริปต์นี้)
 * - /api/* ระหว่าง snapshot ถูก forward ไป PRERENDER_API_BASE (default = prod) —
 *   ล้มเหลว = ตอบ 503 ให้หน้าเรนเดอร์ empty/error state ของตัวเองแทนที่จะค้าง
 * - route ที่ไม่อยู่ในลิสต์ (เช่น /products/:id) ยังตกไปที่ index.html (snapshot หน้าแรก)
 *   ซึ่ง client router เรนเดอร์ทับทันทีเหมือน SPA เดิม
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB_SHOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(WEB_SHOP_DIR, 'dist');
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const API_BASE = process.env.PRERENDER_API_BASE ?? 'https://www.bestchoicephone.com';

// 11 หน้าใน sitemap.xml — เพิ่ม/ลด route ที่นี่ต้องอัป sitemap คู่กันเสมอ
const ROUTES = [
  '/',
  '/products',
  '/promotions',
  '/how-it-works',
  '/installment-terms',
  '/sell',
  '/saving-plan',
  '/about',
  '/contact',
  '/shipping',
  '/returns',
];

function startPreview() {
  const child = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    cwd: WEB_SHOP_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[vite preview] ${d}`));
  return child;
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch {
      // ยังไม่ขึ้น — ลองใหม่
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`vite preview did not start on :${PORT} within ${timeoutMs}ms`);
}

async function snapshotRoute(context, route) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 45_000 });
    // ให้ React effect รอบท้าย (usePageMeta ฯลฯ) ทำงานจบ
    await page.waitForTimeout(400);
    const html = await page.content();
    const title = await page.title();
    const rootLength = await page.evaluate(
      () => document.getElementById('root')?.innerHTML.length ?? 0,
    );
    const canonical = await page.evaluate(
      () => document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    );

    // Sanity gates — snapshot เสียต้องทำให้ build แดง ไม่ใช่ deploy หน้าเปล่าเงียบ ๆ
    if (!title.includes('BESTCHOICE')) throw new Error(`${route}: title เพี้ยน ("${title}")`);
    if (rootLength < 200) throw new Error(`${route}: #root แทบว่าง (${rootLength} chars)`);
    if (canonical !== `https://www.bestchoicephone.com${route}`) {
      throw new Error(`${route}: canonical ไม่ตรง ("${canonical}")`);
    }
    if (html.includes('เกิดข้อผิดพลาด')) {
      console.warn(`⚠ ${route}: มี error state ใน snapshot (API ล่มระหว่าง prerender?)`);
    }

    const outFile =
      route === '/' ? path.join(DIST, 'index.html') : path.join(DIST, route.slice(1), 'index.html');
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, `<!-- prerendered ${new Date().toISOString()} -->\n${html}`);
    console.log(`✓ ${route} → ${path.relative(WEB_SHOP_DIR, outFile)} (${title})`);
  } finally {
    await page.close();
  }
}

const preview = startPreview();
let exitCode = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    // forward /api/* GET ไป prod เพื่อให้ snapshot มีข้อมูลจริง; อย่างอื่นตอบ 503
    await context.route('**/api/**', async (routeHandle) => {
      const req = routeHandle.request();
      if (req.method() !== 'GET') return routeHandle.fulfill({ status: 503, body: '{}' });
      try {
        const url = new URL(req.url());
        const upstream = await fetch(`${API_BASE}${url.pathname}${url.search}`, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        });
        return routeHandle.fulfill({
          status: upstream.status,
          headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
          body: Buffer.from(await upstream.arrayBuffer()),
        });
      } catch {
        return routeHandle.fulfill({ status: 503, body: '{}' });
      }
    });
    for (const route of ROUTES) {
      await snapshotRoute(context, route);
    }
  } finally {
    await browser.close();
  }
  console.log(`\nPrerendered ${ROUTES.length} routes.`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  preview.kill('SIGTERM');
}
process.exit(exitCode);
