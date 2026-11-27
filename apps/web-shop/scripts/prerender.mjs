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
 *   (/products/:id, /account, ...) จึงได้ shell เปล่าแบบเดิมเป๊ะ ไม่ใช่หน้าแรกเต็ม ๆ
 *   ที่ canonical ชี้ผิดหน้า
 * - คำขอออกนอกเครื่องทุกตัวถูกคุม: /api/* GET forward ไป PRERENDER_API_BASE
 *   (default = prod, ล้ม = 503 ให้หน้าโชว์ empty state), endpoint ตั้งค่า analytics
 *   ถูกตอบ 404 เสมอ (กัน GA4/Pixel ยิง hit จาก CI + กัน script tag ติดเข้า snapshot),
 *   ที่เหลือ (fonts/CDN) abort ทิ้ง — deploy ต้องไม่ค้างเพราะ CDN ภายนอกแขวน
 * - ตั้ง window.__BC_PRERENDER__ = true ด้วย addInitScript — UI คุกกี้ไม่ render ตอน prerender
 * - tripwire: captureRoute ตรวจ html ของทุก snapshot หา TRACKER_MARKERS (สคริปต์ tracker,
 *   data-consent-ui ของแบนเนอร์คุกกี้) — เจอ = build แดง กันความยินยอมรั่วเข้า static HTML
 * - โหมดเข้ม PRERENDER_STRICT=1 (รอบ build ตั้งเวลา .github/workflows/shop-refresh.yml เท่านั้น):
 *   ข้อมูลจาก API ต้องมาครบ ไม่งั้น build แดง — ดึงรายการสินค้าไม่ได้ · คำขอ /api ของหน้าใดล้ม (ต่อไม่ติด/5xx/429)
 *   หรือหน้ามีกล่อง error (ทั้งสองข้อลองเก็บหน้านั้นใหม่หนึ่งครั้งก่อน) · เก็บหน้าสินค้าที่ยังขายอยู่ได้ไม่ครบ. รอบตั้งเวลาไม่มีโค้ดเปลี่ยน ล้ม = เว็บคงของเดิม ซึ่งปลอดภัยกว่า
 *   deploy หน้าร้านที่สินค้าหายไปครึ่งร้าน. ค่าเริ่มต้นปิด ⇒ deploy หลัก (deploy-gcp.yml) best effort เหมือนเดิม
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import {
  TINY_PNG,
  createSpacer,
  isProductPhotoRequest,
  listInStockProductIds,
  sitemapWithProducts,
  unexpectedlyMissingProducts,
} from './prerender-products.mjs';

const WEB_SHOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(WEB_SHOP_DIR, 'dist');
const PORT = 4180;
const BASE = `http://localhost:${PORT}`;
const API_BASE = process.env.PRERENDER_API_BASE ?? 'https://www.bestchoicephone.com';
// ดูกติกาโหมดเข้มในคอมเมนต์หัวไฟล์ — shop-refresh.yml เช็คว่ามีคำ PRERENDER_STRICT ในไฟล์นี้ก่อน build
const STRICT = process.env.PRERENDER_STRICT === '1';

// /api/shop/installment-preview ติด @Throttle 60 คำขอ/นาที/IP (apps/api shop-catalog.controller.ts) และหน้าสินค้า
// หน้าหนึ่งเรียก 3–4 ครั้ง (ยอดผ่อนเริ่มบนหัวหน้า + เรท 1 / เรท 2 ในตัวคำนวณ) ⇒ ยิงตามจังหวะหน้าโดน 429 ราวครึ่งร้าน
// (ทดสอบกับ API จริง 28 พ.ย. 2569: เก็บหน้าสินค้าได้ 32 จาก 52 — ตัวที่พังทั้งหมดเป็น 429 ของ endpoint นี้).
// เว้นระยะ 1.25 วิ ⇒ หน้าต่าง 60 วิใด ๆ ไม่เกิน 49 คำขอ · หน้าสินค้า 50 หน้าใช้ราว 4 นาที (เพดานของ API ไม่ใช่ของเรา)
const INSTALLMENT_PREVIEW_PATH = '/api/shop/installment-preview';
const spaceInstallmentPreview = createSpacer(1250);

// คำขอ /api ที่ API ตอบไม่ได้ นับต่อหน้า (Page → จำนวน) — โหมดเข้มใช้ใน captureRoute
const apiFailures = new WeakMap();
/** API ตอบไม่ได้ = ต่อไม่ติด / หมดเวลา / 5xx / 429 · 4xx อื่นเป็นคำตอบจริง (เช่น 404 เครื่องถูกขายแล้ว) */
const isApiFailureStatus = (status) => status >= 500 || status === 429;
function recordApiFailure(req) {
  try {
    const page = req.frame().page();
    apiFailures.set(page, (apiFailures.get(page) ?? 0) + 1);
  } catch {
    // คำขอที่ไม่ได้มาจากหน้า (เช่น service worker) — ไม่มีหน้าให้ผูก
  }
}

// ร่องรอยที่ห้ามหลุดเข้า snapshot (captureRoute จะ throw ถ้าเจอ):
// googletagmanager/google-analytics = GA4, connect.facebook/facebook.com/tr = Meta Pixel,
// analytics.tiktok = TikTok Pixel, line-scdn = LINE Tag, data-consent-ui = แบนเนอร์/
// dialog คุกกี้ (ต้องไม่ถูก render ตอน prerender)
const TRACKER_MARKERS = [
  'googletagmanager.com',
  'google-analytics.com',
  'connect.facebook.net',
  'facebook.com/tr',
  'analytics.tiktok.com',
  'line-scdn.net',
  'data-consent-ui',
];

// 14 หน้าใน sitemap.xml — เพิ่ม/ลด route ที่นี่ต้องอัป sitemap คู่กันเสมอ
// apiDependent = เนื้อหาหลักมาจาก API: ถ้า API ล่มระหว่าง deploy ให้ผ่านพร้อมคำเตือน
// (หน้า static ล้วนห้ามมี error state เด็ดขาด — เจอ = build แดง)
const ROUTES = [
  { path: '/', apiDependent: true },
  { path: '/products', apiDependent: true },
  { path: '/promotions', apiDependent: true },
  { path: '/how-it-works', apiDependent: false },
  { path: '/installment-terms', apiDependent: false },
  { path: '/sell', apiDependent: false },
  { path: '/about', apiDependent: false },
  { path: '/contact', apiDependent: false },
  { path: '/shipping', apiDependent: false },
  { path: '/returns', apiDependent: false },
  { path: '/privacy', apiDependent: false },
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

async function captureRoute(context, { path: route, apiDependent, product = false }) {
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
    // หน้าสินค้า: title ต้องเป็นชื่อรุ่นแล้ว (usePageMeta ต่อท้าย " | BESTCHOICE ลพบุรี") —
    // ยังเป็นชื่อหน้าแรก = ข้อมูลยังไม่มา/ไม่พบเครื่อง ห้ามเก็บ
    if (product && !/ \| BESTCHOICE ลพบุรี$/.test(title)) {
      throw new Error(`${route}: ยังไม่ได้ชื่อรุ่น ("${title}")`);
    }
    // หน้าสินค้าต้องมี JSON-LD Product ใน HTML ดิบ (crawler ที่ไม่รัน JS อ่านจากตรงนี้) —
    // ไม่มี = หน้ายังไม่ใช่หน้าสินค้าจริง (เช่นหน้า "ไม่พบสินค้า" ซึ่งมี title ของตัวเองแล้ว)
    if (product && !html.includes('"@type":"Product"')) {
      throw new Error(`${route}: ไม่มี JSON-LD Product ใน snapshot`);
    }
    // หน้า noindex (ไม่พบหน้า/ไม่พบสินค้า) ห้ามถูกแช่เป็นไฟล์และห้ามเข้า sitemap
    if (await page.evaluate(() => document.querySelector('meta[name="robots"]') !== null)) {
      throw new Error(`${route}: snapshot ติด meta robots (หน้า noindex)`);
    }
    if (rootLength < 200) throw new Error(`${route}: #root แทบว่าง (${rootLength} chars)`);
    // canonical จาก usePageMeta = window.location.pathname ซึ่ง percent-encode
    // อักษรไทยแล้ว — เทียบกับ route ที่ encode ให้ตรงกัน
    if (canonical !== `https://www.bestchoicephone.com${encodeURI(route)}`) {
      throw new Error(`${route}: canonical ไม่ตรง ("${canonical}")`);
    }
    // Tripwire — snapshot ต้องไม่มี tracker/แบนเนอร์คุกกี้ (ใช้ร่วมกับ block endpoint ด้านบน)
    const marker = TRACKER_MARKERS.find((m) => html.includes(m));
    if (marker) {
      throw new Error(`${route}: snapshot มีร่องรอย tracker หรือแบนเนอร์คุกกี้ ("${marker}")`);
    }
    // โหมดเข้ม: API ตอบไม่ได้ระหว่างเก็บหน้านี้ ⇒ ห้ามเก็บ. ดูกล่อง error อย่างเดียวไม่พอ — React Query ลองใหม่
    // แบบเว้นช่วง networkidle จึงมาถึงตอนหน้ายังโหลดค้าง (skeleton) ก่อนกล่อง error ขึ้น (ทดสอบจริง 28 พ.ย. 2569:
    // API ล่มทั้งเส้น หน้าแรก/หน้ารวม/โปรโมชันผ่านด่านเดิมทุกข้อ)
    // throw ⇒ captureWithRetry ลองใหม่หนึ่งครั้ง · ยังพัง = หน้า marketing ทำ build แดง /
    // หน้าสินค้ากลายเป็นเครื่องที่เก็บไม่ได้ (ตัดสินด้วย unexpectedlyMissingProducts ท้ายรอบ)
    const failedApiCalls = apiFailures.get(page) ?? 0;
    if (STRICT && failedApiCalls > 0) {
      throw new Error(`${route}: API ตอบไม่ได้ ${failedApiCalls} คำขอระหว่างเก็บหน้า`);
    }
    if (html.includes('เกิดข้อผิดพลาด')) {
      if (!apiDependent) throw new Error(`${route}: หน้า static มี error state ใน snapshot`);
      if (STRICT) throw new Error(`${route}: มี error state ใน snapshot (API ล่มระหว่าง prerender?)`);
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
    // UI คุกกี้อ่านธงนี้แล้วไม่ render อะไรเลย (tripwire ใน captureRoute พิสูจน์ซ้ำ)
    await context.addInitScript(() => {
      window.__BC_PRERENDER__ = true;
    });
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
        let upstream;
        try {
          if (url.pathname === INSTALLMENT_PREVIEW_PATH) await spaceInstallmentPreview();
          const res = await fetch(`${API_BASE}${url.pathname}${url.search}`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });
          upstream = {
            status: res.status,
            contentType: res.headers.get('content-type') ?? 'application/json',
            body: Buffer.from(await res.arrayBuffer()),
          };
        } catch {
          recordApiFailure(req);
          return routeHandle.fulfill({ status: 503, body: '{}' }).catch(() => {});
        }
        if (isApiFailureStatus(upstream.status)) recordApiFailure(req);
        // ส่งคำตอบไม่ได้ = หน้าปิดไปแล้ว หรือหน้ายกเลิกคำขอระหว่างรอคิว (React Query ยกเลิกคำขอเก่าเมื่อเปลี่ยนงวด) —
        // ไม่มีใครรอคำตอบแล้ว จึงไม่ใช่ API ล้ม และห้ามโยนออกไปเป็น unhandled rejection ที่ล้มทั้งโปรเซส
        return routeHandle
          .fulfill({
            status: upstream.status,
            headers: { 'content-type': upstream.contentType },
            body: upstream.body,
          })
          .catch(() => {});
      }
      // รูปสินค้าเป็น URL เต็มบนโดเมนจริง — ตอบ PNG 1×1 แทนดาวน์โหลดจริง ไม่งั้น <img> ล้ม
      // แล้ว snapshot มีข้อความ "โหลดรูปนี้ไม่สำเร็จ" (src ใน HTML ยังเป็น URL จริง)
      if (req.method() === 'GET' && isProductPhotoRequest(url, API_BASE)) {
        return routeHandle.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
      }
      // โฮสต์ภายนอก (fonts, CDN, tracker) — ตัดทิ้ง: DOM ไม่ต้องใช้ และห้ามให้
      // CDN ภายนอกแขวน networkidle จน deploy แดง
      return routeHandle.abort();
    });

    // เก็บให้ครบทุก route ก่อน แล้วค่อยเขียน — ดูกติกาในคอมเมนต์หัวไฟล์
    for (const routeDef of ROUTES) {
      snapshots.push(await captureWithRetry(context, routeDef));
    }

    // หน้าสินค้าที่ขายอยู่ (ส่วน B6) — best effort ทั้งชุด: ล้มเฉพาะตัวไหนก็ข้ามตัวนั้น
    let productIds = [];
    try {
      productIds = await listInStockProductIds(API_BASE);
    } catch (err) {
      if (STRICT) throw new Error(`โหมดเข้ม: ดึงรายการสินค้าไม่สำเร็จ — ${err.message}`);
      console.warn(`⚠ ดึงรายการสินค้าไม่สำเร็จ — ข้าม snapshot หน้าสินค้า: ${err.message}`);
    }
    const PRODUCT_CONCURRENCY = 4;
    for (let i = 0; i < productIds.length; i += PRODUCT_CONCURRENCY) {
      const batch = productIds.slice(i, i + PRODUCT_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((id) =>
          captureWithRetry(context, { path: `/products/${id}`, apiDependent: true, product: true }),
        ),
      );
      results.forEach((r, j) => {
        if (r.status === 'fulfilled') snapshots.push({ ...r.value, productId: batch[j] });
        else console.warn(`⚠ ข้าม /products/${batch[j]}: ${r.reason?.message ?? r.reason}`);
      });
    }
    // สรุปบรรทัดเดียว — ข้ามทีละเครื่องเงียบเกินไปถ้าล้มทั้งชุด (build ไม่ล้ม ตั้งใจ best effort)
    if (productIds.length > 0) {
      const captured = snapshots.filter((s) => s.productId).length;
      const summary = `หน้าสินค้า: เก็บได้ ${captured} จาก ${productIds.length} หน้า`;
      if (captured === 0) console.warn(`⚠ ${summary} — sitemap รอบนี้ไม่มีหน้าสินค้าเลย`);
      else console.log(`${captured < productIds.length ? '⚠' : '✓'} ${summary}`);
    }
    if (STRICT) {
      const capturedIds = snapshots.filter((s) => s.productId).map((s) => s.productId);
      // เก็บไม่ครบเท่านั้นถึงต้องถามรายการรอบสอง — แยกเครื่องที่ขายออกระหว่าง build ออกจากหน้าที่พังจริง
      let stillListed;
      if (capturedIds.length < productIds.length) {
        try {
          stillListed = await listInStockProductIds(API_BASE);
        } catch (err) {
          stillListed = null;
          console.warn(`⚠ ดึงรายการสินค้ารอบสองไม่สำเร็จ: ${err.message}`);
        }
      }
      const missing = unexpectedlyMissingProducts(productIds, capturedIds, stillListed);
      if (missing.length > 0) {
        throw new Error(
          `โหมดเข้ม: เก็บหน้าสินค้าไม่ได้ ${missing.length} เครื่องที่ยังขายอยู่ (${missing.join(', ')})`,
        );
      }
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
  // sitemap.xml = 14 หน้าเดิมจาก public + เครื่องที่ snapshot สำเร็จ (ส่วน B6)
  const productIdsDone = snapshots.filter((s) => s.productId).map((s) => s.productId);
  const sitemapPath = path.join(DIST, 'sitemap.xml');
  const today = new Date().toISOString().slice(0, 10);
  await writeFile(
    sitemapPath,
    sitemapWithProducts(await readFile(sitemapPath, 'utf8'), productIdsDone, today),
  );
  console.log(`✓ sitemap.xml + ${productIdsDone.length} หน้าสินค้า`);
  console.log(`\nPrerendered ${snapshots.length} routes + spa-shell.html`);
} catch (err) {
  console.error(err);
  exitCode = 1;
} finally {
  preview.kill('SIGTERM');
}
process.exit(exitCode);
