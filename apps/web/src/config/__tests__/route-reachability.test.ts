import { describe, it, expect } from 'vitest';
// `?raw` ของ Vite — อ่านซอร์สจริงโดยไม่ต้องพึ่ง node types (tsconfig ของ web ไม่มี)
import appSource from '../../App.tsx?raw';
import { resolveZoneForPath, COMMON_PATHS } from '../menu';

/**
 * ความสอดคล้องระหว่าง **ProtectedRoute (App.tsx)** กับ **sidebar (menu.ts)**
 *
 * MainLayout ตัดสินใจแบบนี้ (components/layout/MainLayout.tsx):
 *   targetZone = resolveZoneForPath(role, pathname)
 *   ถ้า null และ "role อื่นมีหน้านี้ในเมนู" → toast "ไม่มีสิทธิ์" + เด้งกลับ Dashboard
 *
 * ⇒ สองไฟล์นี้ต้องตรงกัน ไม่งั้นเกิดบั๊ก 2 ทิศ:
 *   A. route อนุญาต แต่เมนูไม่มี  → ผู้ใช้โดนเด้งจากหน้าที่ตัวเองมีสิทธิ์
 *   B. เมนูมี แต่ route ไม่อนุญาต → ผู้ใช้กดเมนูของตัวเองแล้วโดนปฏิเสธ
 *
 * เทสอ่าน `roles={[...]}` จาก App.tsx ของจริง จึงไม่ต้องซิงก์รายการด้วยมือ —
 * เพิ่ม route ใหม่แล้วลืมเมนู (หรือกลับกัน) เทสนี้แดงทันที
 *
 * ── หนี้ที่ค้างอยู่ ────────────────────────────────────────────────
 * KNOWN_GAPS ด้านล่างคือช่องว่างที่ **มีอยู่ก่อนแล้ว** ตอนเทสนี้ถูกเขียน (2026-08-29)
 * แต่ละบรรทัดต้องให้เจ้าของตัดสินว่า "เพิ่มเข้าเมนู" หรือ "ถอด role ออกจาก route"
 * — เป็นคำถามธุรกิจ ไม่ใช่เทคนิคล้วน
 *
 * **รายการนี้มีได้แค่สั้นลง ห้ามยาวขึ้น** — ถ้าจะเพิ่มบรรทัดใหม่แปลว่ากำลังปล่อยบั๊กเข้าไป
 *
 * คู่กับ cta-reachability.test.ts ซึ่งคุมฝั่ง "ปุ่มบนหน้าจอ" (คนละมุมกัน)
 */

const ALL_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER', 'SALES', 'ACCOUNTANT'];

/** A: route อนุญาต role นี้ แต่ไม่มีในเมนูของ role นี้ ⇒ โดน MainLayout เด้ง */
const KNOWN_GAPS_ROUTE_ALLOWS_MENU_MISSING = [
  'ACCOUNTANT /bookings',
  'ACCOUNTANT /finance-portfolio',
  'ACCOUNTANT /finance/aging-report',
  'ACCOUNTANT /finance/bad-debt-report',
  'ACCOUNTANT /finance/balance-sheet',
  'ACCOUNTANT /finance/contract-cancellation',
  'ACCOUNTANT /finance/e-receipt-auto',
  'ACCOUNTANT /finance/general-journal',
  'ACCOUNTANT /finance/intercompany-report',
  'ACCOUNTANT /insurance',
  'ACCOUNTANT /stock/products',
  'BRANCH_MANAGER /assets',
  'BRANCH_MANAGER /insurance/exchange-requests',
  'BRANCH_MANAGER /profit-loss',
  'BRANCH_MANAGER /shop/accounting',
  'FINANCE_MANAGER /accounting/intercompany',
  'FINANCE_MANAGER /bookings',
  'FINANCE_MANAGER /crm',
  'FINANCE_MANAGER /finance/aging-report',
  'FINANCE_MANAGER /finance/bad-debt-report',
  'FINANCE_MANAGER /finance/balance-sheet',
  'FINANCE_MANAGER /finance/cash-flow',
  'FINANCE_MANAGER /finance/contract-cancellation',
  'FINANCE_MANAGER /finance/e-receipt-auto',
  'FINANCE_MANAGER /finance/equity-statement',
  'FINANCE_MANAGER /finance/general-journal',
  'FINANCE_MANAGER /finance/general-ledger',
  'FINANCE_MANAGER /finance/intercompany-report',
  'FINANCE_MANAGER /insurance',
  'FINANCE_MANAGER /insurance/exchange-requests',
  'FINANCE_MANAGER /monthly-close',
  'FINANCE_MANAGER /stock/products',
  'OWNER /chat',
  'OWNER /crm',
  'SALES /insurance/exchange-requests',
];

/** B: เมนูมี path นี้ แต่ ProtectedRoute ไม่อนุญาต role นี้ ⇒ กดแล้วโดนปฏิเสธ */
const KNOWN_GAPS_MENU_HAS_ROUTE_DENIES: string[] = [
  // ว่าง — ทิศนี้แก้หมดแล้ว (2026-08-30). ถ้ามีบรรทัดโผล่มาใหม่แปลว่ากำลังปล่อยบั๊กเข้าไป
];

const src: string = appSource;

/** path ที่จงใจ redirect — MainLayout ไม่มีวันเห็น path นี้ค้างบน URL */
const redirects = new Set(
  [...src.matchAll(/<Route\s+path="([^"]+)"\s+element=\{<Navigate/g)].map((m) => m[1]),
);

/** path → roles ที่ ProtectedRoute ระบุไว้ (ข้าม dynamic segment กับ redirect) */
const guarded = [...src.matchAll(/<Route\s+path="([^"]+)"([\s\S]*?)(?=<Route\s|$)/g)]
  .filter(([, path]) => !path.includes(':') && !path.includes('*'))
  .filter(([, path]) => !redirects.has(path) && !COMMON_PATHS.has(path))
  // /settings/* อยู่นอกขอบเขตเทสนี้: resolveZoneForPath มีทางลัด return 'settings'
  // ให้ทุก role ที่มี showSettingsGear โดยไม่ดู registry ⇒ ใช้เป็นตัวแทน "มีในเมนู"
  // ไม่ได้ เมนูตั้งค่าจริงกรองด้วย visibleCategories() ใน settings-access.ts อีกชั้น
  .filter(([, path]) => !path.startsWith('/settings'))
  .map(([, path, body]) => {
    const m = body.match(/roles=\{\[([^\]]*)\]\}/);
    return { path, roles: m ? [...m[1].matchAll(/'(\w+)'/g)].map((r) => r[1]) : [] };
  })
  .filter((r) => r.roles.length > 0);

const inMenu = (role: string, path: string) => resolveZoneForPath(role, path) !== null;

const gapsA = guarded
  .flatMap(({ path, roles }) => roles.map((role) => ({ path, role })))
  .filter(({ path, role }) => !inMenu(role, path))
  // ตรงกับเงื่อนไขจริงของ MainLayout: เด้งเฉพาะเมื่อ role อื่นมีหน้านี้ในเมนู
  // (ถ้าไม่มีใครมีเลย = หาไม่เจอจากเมนู แต่ไม่เด้ง — คนละปัญหา เบากว่า)
  .filter(({ path, role }) => ALL_ROLES.some((r) => r !== role && inMenu(r, path)))
  .map(({ role, path }) => `${role} ${path}`)
  .sort();

const gapsB = ALL_ROLES.flatMap((role) =>
  guarded
    .filter(({ path, roles }) => !roles.includes(role) && inMenu(role, path))
    .map(({ path }) => `${role} ${path}`),
).sort();

describe('ProtectedRoute ↔ sidebar ต้องสอดคล้องกัน', () => {
  it('พาร์ส App.tsx ได้จริง (กันเทสเขียวเพราะ regex ไม่แมตช์อะไรเลย)', () => {
    expect(guarded.length).toBeGreaterThan(20);
  });

  it('A · ไม่มีช่องว่างใหม่ (route อนุญาต แต่เมนูไม่มี ⇒ โดนเด้งจากหน้าที่มีสิทธิ์)', () => {
    const fresh = gapsA.filter((g) => !KNOWN_GAPS_ROUTE_ALLOWS_MENU_MISSING.includes(g));
    expect(fresh, `ช่องว่างใหม่ — เพิ่มเข้าเมนูของ role นั้น หรือถอด role ออกจาก route:\n${fresh.join('\n')}`).toEqual([]);
  });

  it('B · ไม่มีช่องว่างใหม่ (เมนูมี แต่ route ไม่อนุญาต ⇒ กดเมนูตัวเองแล้วโดนปฏิเสธ)', () => {
    const fresh = gapsB.filter((g) => !KNOWN_GAPS_MENU_HAS_ROUTE_DENIES.includes(g));
    expect(fresh, `ช่องว่างใหม่ — ถอดออกจากเมนู หรือเพิ่ม role เข้า route:\n${fresh.join('\n')}`).toEqual([]);
  });

  it('KNOWN_GAPS ไม่มีบรรทัดตกค้างที่แก้ไปแล้ว (รายการมีได้แค่สั้นลง)', () => {
    const stale = [
      ...KNOWN_GAPS_ROUTE_ALLOWS_MENU_MISSING.filter((g) => !gapsA.includes(g)),
      ...KNOWN_GAPS_MENU_HAS_ROUTE_DENIES.filter((g) => !gapsB.includes(g)),
    ];
    expect(stale, `แก้ไปแล้ว — ลบออกจาก KNOWN_GAPS ด้วย ไม่งั้นบั๊กกลับมาได้เงียบ ๆ:\n${stale.join('\n')}`).toEqual([]);
  });
});
