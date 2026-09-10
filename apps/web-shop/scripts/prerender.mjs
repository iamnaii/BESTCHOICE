/**
 * Post-build prerender — snapshot หน้า marketing ของ SPA เป็น HTML จริงต่อ route
 *
 * ทำไม: AI crawlers (GPTBot / ClaudeBot / PerplexityBot) และ Bing ไม่รัน JavaScript —
 * SPA เปล่า ๆ ทำให้พวกมันเห็นแค่ <div id="root"></div>. สคริปต์นี้เปิด dist ผ่าน
 * `vite preview` แล้วใช้ headless Chromium เก็บ DOM ที่เรนเดอร์เสร็จ (รวม title/meta/
 * canonical/OG ที่ usePageMeta stamp แล้ว) เขียนเป็น dist/<route>/index.html —
 * Firebase Hosting เสิร์ฟไฟล์ตรงก่อนถึง rewrite เสมอ
 *
 * กติกาสำคัญ (มาจากรอบรีวิว — อย่ารื้อโดยไม่อ่าน):
 * - เก็บ snapshot ครบทุก route ก่อน แล้วค่อยเขียนไฟล์ทีเดียวตอนท้าย — ห้ามเขียน
 *   dist/index.html ระหว่างทาง เพราะ vite preview เสิร์ฟไฟล์จากดิสก์สด ๆ ทำให้
 *   route ถัดไปเรนเดอร์จาก snapshot ที่เปื้อนแล้ว (meta/analytics ของหน้าแรกติดไปด้วย)
 * - shell สะอาด (index.html ที่ vite build ออกมา) ถูกเก็บเป็น dist/spa-shell.html
 *   และ firebase.json ชี้ rewrite ** ไปที่นั่น — route ที่ไม่ได้ prerender
 *   (/products/:id, /cart, ...) จึงได้ shell เปล่าแบบเดิมเป๊ะ ไม่ใช่หน้าแรกเต็ม ๆ
 *   ที่ canonical ชี้ผิดหน้า
 * - คำขอออกนอกเครื่องทุกตัวถูกคุม: /api/* GET forward ไป PRERENDER_API_BASE
 *   (default = prod, ล้ม = 503 ให้หน้าโชว์ empty state), endpoint ตั้งค่า analytics
 *   ถูกตอบ 404 เสมอ (กัน GA4/Pixel ยิง hit จาก CI + กัน script tag ติดเข้า snapshot),
 *   ที่เหลือ (fonts/CDN) abort ทิ้ง — deploy ต้องไม่ค้างเพราะ CDN ภายนอกแขวน
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const WEB_SHOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(WEB_SHOP_DIR, 'dist');
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const API_BASE = process.env.PRERENDER_API_BASE ?? 'https://www.bestchoicephone.com';

// 11 หน้าใน sitemap.xml — เพิ่ม/ลด route ที่นี่ต้องอัป sitemap คู่กันเสมอ
// apiDependent = เนื้อหาหลักมาจาก API: ถ้า API ล่มระหว่าง deploy ให้ผ่านพร้อมคำเตือน
// (หน้า static ล้วนห้ามมี error state เด็ดขาด — เจอ = build แดง)
const ROUTES = [
  { path: '/', apiDependent: true },
  { path: '/products', apiDependent: true },
  { path: '/promotions', apiDependent: true },
  { path: '/how-it-works', apiDependent: false },
  { path: '/installment-terms', apiDependent: false },
  { path: '/sell', apiDependent: false },
  { path: '/saving-plan', apiDependent: false },
  { path: '/about', apiDependent: false },
  { path: '/contact', apiDependent: false },
  { path: '/shipping', apiDependent: false },
  { path: '/returns', apiDependent: false },
  // Landing เจาะคำค้นท้องถิ่น — path ภาษาไทย: browser จะ encode เป็น %XX ตอนขอ
  // (canonical ที่ usePageMeta stamp ก็เป็นแบบ encode) แต่ชื่อโฟลเดอร์ใน dist เป็น
  // ตัวอักษรไทยตรง ๆ — Firebase decode path ก่อน match ไฟล์ให้เอง
  { path: '/ผ่อนไอโฟนลพบุรี', apiDependent: false },
  { path: '/iphone-มือสอง-ลพบุรี', apiDependent: false },
  { path: '/ผ่อนมือถือไม่ใช้บัตรเครดิต', apiDependent: false },
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

async function captureRoute(context, { path: route, apiDependent }) {
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
    // canonical จาก usePageMeta = window.location.pathname ซึ่ง percent-encode
    // อักษรไทยแล้ว — เทียบกับ route ที่ encode ให้ตรงกัน
    if (canonical !== `https://www.bestchoicephone.com${encodeURI(route)}`) {
      throw new Error(`${route}: canonical ไม่ตรง ("${canonical}")`);
    }
    if (html.includes('เกิดข้อผิดพลาด')) {
      if (!apiDependent) throw new Error(`${route}: หน้า static มี error state ใน snapshot`);
      console.warn(`⚠ ${route}: มี error state ใน snapshot (API ล่มระหว่าง prerender?)`);
    }
    return { route, html, title };
  } finally {
    await page.close();
  }
}

async function captureWithRetry(context, routeDef) {
  try {
    return await captureRoute(context, routeDef);
  } catch (err) {
    console.warn(`↻ ${routeDef.path}: ${err.message} — ลองใหม่อีกครั้ง`);
    return captureRoute(context, routeDef);
  }
}

const preview = startPreview();
let exitCode = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  const snapshots = [];
  try {
    // Save final visible content, never paused below-fold GSAP reveal styles.
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    await context.route('**/*', async (routeHandle) => {
      const req = routeHandle.request();
      const url = new URL(req.url());
      // asset ของแอปเองจาก preview server — ปล่อยผ่าน
      if (url.origin === BASE) {
        if (!url.pathname.startsWith('/api/')) return routeHandle.continue();
        // ห้าม analytics ติดตั้งระหว่าง prerender — 404 → fetchRuntimeConfig คืน null
        if (url.pathname.startsWith('/api/shop/public-config/analytics')) {
          return routeHandle.fulfill({ status: 404, body: '{}' });
        }
        if (req.method() !== 'GET') return routeHandle.fulfill({ status: 503, body: '{}' });
        // forward /api/* GET ไป prod เพื่อให้ snapshot มีข้อมูลจริง
        try {
          const upstream = await fetch(`${API_BASE}${url.pathname}${url.search}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });
          return routeHandle.fulfill({
            status: upstream.status,
            headers: {
              'content-type': upstream.headers.get('content-type') ?? 'application/json',
            },
            body: Buffer.from(await upstream.arrayBuffer()),
          });
        } catch {
          return routeHandle.fulfill({ status: 503, body: '{}' });
        }
      }
      // โฮสต์ภายนอก (fonts, CDN, tracker) — ตัดทิ้ง: DOM ไม่ต้องใช้ และห้ามให้
      // CDN ภายนอกแขวน networkidle จน deploy แดง
      return routeHandle.abort();
    });

    // เก็บให้ครบทุก route ก่อน แล้วค่อยเขียน — ดูกติกาในคอมเมนต์หัวไฟล์
    for (const routeDef of ROUTES) {
      snapshots.push(await captureWithRetry(context, routeDef));
    }
  } finally {
    await browser.close();
  }

  // shell สะอาดสำหรับ route ที่ไม่ได้ prerender (คู่กับ rewrite ** → /spa-shell.html)
  await copyFile(path.join(DIST, 'index.html'), path.join(DIST, 'spa-shell.html'));

  for (const { route, html, title } of snapshots) {
    const outFile =
      route === '/' ? path.join(DIST, 'index.html') : path.join(DIST, route.slice(1), 'index.html');
    await mkdir(path.dirname(outFile), { recursive: true });
    await writeFile(outFile, `<!-- prerendered ${new Date().toISOString()} -->\n${html}`);
    console.log(`✓ ${route} → ${path.relative(WEB_SHOP_DIR, outFile)} (${title})`);
  }
  console.log(`\nPrerendered ${snapshots.length} routes + spa-shell.html`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  preview.kill('SIGTERM');
}
process.exit(exitCode);
