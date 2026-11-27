#!/usr/bin/env node
/**
 * นับหน้าเครื่องใน sitemap.xml ของหน้าร้าน — ด่านของรอบ build ตั้งเวลา (.github/workflows/shop-refresh.yml)
 *
 *   node tools/shop-refresh/sitemap-products.mjs count <sitemap ที่ build ได้>
 *   node tools/shop-refresh/sitemap-products.mjs check-drop <sitemap ที่ build ได้> <URL sitemap บนเว็บ> [--allow-drop]
 *     ก่อน deploy: หน้าเครื่องเหลือน้อยกว่าครึ่งของที่ขึ้นเว็บอยู่ ⇒ exit 1 (กัน API ตอบรายการว่าง/ขาดแบบไม่ error)
 *   node tools/shop-refresh/sitemap-products.mjs verify-live <sitemap ที่ build ได้> <URL หลัก> [URL สำรอง]
 *     หลัง deploy: sitemap บนเว็บต้องมีหน้าเครื่องชุดเดียวกับที่ build — ลอง 4 รอบห่าง 15 วิ ·
 *     URL หลักไม่ตรงแต่ URL สำรองตรง = ผ่านพร้อมคำเตือน (โดเมนหลักยังไม่อัปเดต แต่ release ขึ้นแล้ว —
 *     กติกาเดียวกับด่าน "Verify shop is actually live" ของ deploy-gcp.yml)
 *
 * ไม่มี dependency — รันด้วย node ได้เลยโดยไม่ต้อง npm ci
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PRODUCT_LOC = /<loc>\s*(https:\/\/www\.bestchoicephone\.com\/products\/[^<\s]+?)\s*<\/loc>/g;

/** URL หน้าเครื่อง (/products/<id>) ตามลำดับในไฟล์ ไม่ซ้ำ — หน้ารวม /products ไม่นับ */
export function productUrls(xml) {
  if (typeof xml !== 'string' || !xml.includes('<urlset')) {
    throw new Error('ไม่ใช่ sitemap.xml (ไม่มี <urlset>)');
  }
  return [...new Set([...xml.matchAll(PRODUCT_LOC)].map((m) => m[1]))];
}

/** ก่อน deploy: build ได้น้อยกว่าครึ่งของที่ขึ้นเว็บอยู่ ⇒ ข้อความอธิบาย · ผ่าน ⇒ null */
export function dropProblem(builtUrls, liveUrls) {
  if (builtUrls.length * 2 >= liveUrls.length) return null;
  return (
    `หน้าเครื่องใน build ใหม่มี ${builtUrls.length} หน้า น้อยกว่าครึ่งของที่ขึ้นเว็บอยู่ ` +
    `(${liveUrls.length} หน้า) — ไม่ deploy เพราะอาจเป็น API ตอบรายการขาด`
  );
}

/** หลัง deploy: sitemap บนเว็บต้องมีหน้าเครื่องชุดเดียวกับที่ build ⇒ ไม่ตรง = ข้อความอธิบาย · ตรง ⇒ null */
export function liveMismatch(builtUrls, liveUrls) {
  const live = new Set(liveUrls);
  if (builtUrls.length === live.size && builtUrls.every((url) => live.has(url))) return null;
  return `หน้าเครื่องใน build มี ${builtUrls.length} หน้า แต่ sitemap บนเว็บมี ${live.size} หน้า (หรือคนละชุด)`;
}

const inActions = process.env.GITHUB_ACTIONS === 'true';
const annotate = (level, msg) => (inActions ? `::${level}::${msg}` : msg);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSitemap(url) {
  // พารามิเตอร์ท้าย URL กันได้ของที่ค้างใน cache ระหว่างทาง (ไฟล์นี้ตั้ง no-cache ใน firebase.json อยู่แล้ว)
  const busted = new URL(url);
  busted.searchParams.set('shop_refresh', String(Date.now()));
  const res = await fetch(busted, {
    headers: { accept: 'application/xml,text/xml' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.text();
}

const readBuilt = (file) => productUrls(readFileSync(file, 'utf8'));

async function verifyLive(built, primary, fallback) {
  const attempts = 4;
  let last = '';
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const mismatch = liveMismatch(built, productUrls(await fetchSitemap(primary)));
      if (mismatch === null) return { ok: true, via: primary };
      last = `${primary}: ${mismatch}`;
    } catch (err) {
      last = `${primary}: ${err.message}`;
    }
    if (fallback) {
      try {
        if (liveMismatch(built, productUrls(await fetchSitemap(fallback))) === null) {
          return { ok: true, via: fallback };
        }
      } catch {
        // ใช้ข้อความของ URL หลักเป็นเหตุผล — สำรองเป็นแค่ทางยืนยันว่า release ขึ้นแล้ว
      }
    }
    if (i < attempts) {
      console.log(`รอบ ${i}: ${last} — รอ 15 วิ`);
      await sleep(15_000);
    }
  }
  return { ok: false, reason: last };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const args = rest.filter((a) => !a.startsWith('--'));
  const flags = new Set(rest.filter((a) => a.startsWith('--')));

  if (command === 'count' && args.length === 1) {
    console.log(readBuilt(args[0]).length);
    return 0;
  }
  if (command === 'check-drop' && args.length === 2) {
    const built = readBuilt(args[0]);
    const live = productUrls(await fetchSitemap(args[1]));
    console.log(`หน้าเครื่องใน build ใหม่: ${built.length} · บนเว็บตอนนี้: ${live.length}`);
    const problem = dropProblem(built, live);
    if (problem === null) return 0;
    if (flags.has('--allow-drop')) {
      console.log(annotate('warning', `${problem} — ผ่านเพราะสั่งยอมให้ลดได้ (allow_big_drop)`));
      return 0;
    }
    console.error(
      annotate(
        'error',
        `${problem} · ถ้าขายออกจริง กด Run workflow ของ shop-refresh แล้วติ๊ก allow_big_drop`,
      ),
    );
    return 1;
  }
  if (command === 'verify-live' && (args.length === 2 || args.length === 3)) {
    const built = readBuilt(args[0]);
    const result = await verifyLive(built, args[1], args[2]);
    if (!result.ok) {
      console.error(annotate('error', `sitemap บนเว็บยังไม่ใช่รอบนี้ — ${result.reason}`));
      return 1;
    }
    if (result.via !== args[1]) {
      console.log(
        annotate('warning', `${args[1]} ยังไม่ใช่รอบนี้ แต่ ${result.via} ใช่แล้ว ⇒ release ขึ้นแล้ว`),
      );
    } else {
      console.log(`sitemap บนเว็บมีหน้าเครื่อง ${built.length} หน้าตรงกับ build แล้ว`);
    }
    return 0;
  }
  console.error(
    'ใช้: sitemap-products.mjs count <file> | check-drop <file> <url> [--allow-drop] | verify-live <file> <url> [url สำรอง]',
  );
  return 2;
}

// ตั้ง exitCode แทน process.exit() — exit ทันทีหลัง fetch ขณะ socket ของ undici ยังปิดไม่เสร็จ
// ทำ Node บน Windows ล้มด้วย assertion ของ libuv (UV_HANDLE_CLOSING) และได้ exit code มั่ว
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(annotate('error', err.message));
      process.exitCode = 1;
    },
  );
}
