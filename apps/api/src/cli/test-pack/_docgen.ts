import type { DomainSeeder } from './_types';

/** escape `|` ในข้อความก่อนลง cell — กัน markdown table พังเมื่อ marker มีอักขระตาราง */
const cell = (s: string): string => s.replace(/\|/g, '\\|');

/**
 * สร้าง README ของ checklist ทดสอบทั้งระบบจาก registry — เอกสารกับโค้ดจึงหลุดกันไม่ได้
 *
 * ฟังก์ชันนี้ **pure โดยตั้งใจ**: ไม่อ่านไฟล์ ไม่แตะ DB ไม่อ่าน process.env — ผู้เรียก
 * (branch `DOCGEN=1` ใน seed-test-pack.cli.ts) เป็นคนอ่าน App.tsx และเขียนไฟล์ผลลัพธ์
 * จึงเทสได้โดยไม่ต้องมีฐานข้อมูลหรือ filesystem
 *
 * @param domains  ALL_DOMAINS จาก _registry.ts (ใช้ key / label / routes / markerDoc)
 * @param allRoutes  path ทั้งหมดจาก apps/web/src/App.tsx หลังตัด /settings, `*`, `:itemId`
 */
export function renderChecklistReadme(domains: DomainSeeder[], allRoutes: string[]): string {
  const routeSet = new Set(allRoutes);
  const covered = new Set(domains.flatMap((d) => d.routes));
  const uncovered = allRoutes.filter((r) => !covered.has(r)).sort();
  // route ที่ registry อ้างแต่ App.tsx ไม่มีแล้ว = drift ขาออก (เช่น route ถูก rename)
  // — ต้องดังในเอกสาร ไม่ใช่หายเงียบ เพราะตารางข้อ 3 จะพาคนไปเปิดหน้าที่ไม่มีอยู่จริง
  const stale = [
    ...new Set(domains.flatMap((d) => d.routes.filter((r) => !routeSet.has(r)))),
  ].sort();

  const domainRows = domains
    .map((d) => `| \`${d.key}\` | ${cell(d.label)} | ${d.routes.length} | ${cell(d.markerDoc)} |`)
    .join('\n');

  // route เดียวอาจถูกหลายโดเมนครอบ (เช่น /insurance/exchange-requests) — ยุบเป็นแถวเดียว
  // ระบุทุกโดเมน แทนที่จะพิมพ์แถวซ้ำให้คนอ่านงง
  const routeOwners = new Map<string, string[]>();
  for (const d of domains) {
    for (const r of d.routes) {
      const owners = routeOwners.get(r) ?? [];
      owners.push(`${cell(d.label)} (\`${d.key}\`)`);
      routeOwners.set(r, owners);
    }
  }
  const routeRows = [...routeOwners.entries()]
    .map(([r, owners]) => `| \`${r}\` | ${owners.join(' · ')} |`)
    .join('\n');

  const staleSection = stale.length
    ? `
## ⚠️ route ที่ registry อ้างถึงแต่ไม่พบใน App.tsx (${stale.length} route)

route เหล่านี้ถูกประกาศไว้ใน \`routes\` ของโดเมน แต่ไม่มี \`path\` ตรงกันใน App.tsx แล้ว —
น่าจะถูก rename/ลบไป ให้แก้ \`routes\` ของโดเมนนั้นใน \`apps/api/src/cli/test-pack/\`
แล้ว generate เอกสารนี้ใหม่:

${stale.map((r) => `- \`${r}\``).join('\n')}
`
    : '';

  return `# คู่มือทดสอบทั้งระบบ — ตารางครอบคลุม route และวิธีล้างข้อมูลทดสอบ

> **ไฟล์นี้ generate จากโค้ด — อย่าแก้ด้วยมือ**
> สร้างใหม่: \`DOCGEN=1 npm --prefix apps/api run seed:test-pack\` (ไม่ต้องมีฐานข้อมูล)
> แหล่งข้อมูล: \`apps/api/src/cli/test-pack/_registry.ts\` (\`routes\` + \`markerDoc\`
> ของแต่ละโดเมน) + รายการ route จาก \`apps/web/src/App.tsx\`

## 0. คำเตือนก่อนใช้

- **แพ็กนี้ยังไม่เคยถูกรัน seed → cleanup ครบวงจรกับฐานข้อมูลจริง** (พัฒนาบนเครื่องที่ไม่มี
  Postgres — ผ่าน unit tests + type check เท่านั้น) ⇒ รอบแรกให้รันบน dev/staging และถือว่า
  การรันนั้นเป็นส่วนหนึ่งของการทดสอบ อย่าเริ่มที่ prod
- ทั้ง seed และ cleanup เริ่มที่ **DRY-RUN เสมอ** เมื่อไม่ใส่ \`CONFIRM_*\` — อ่านผล dry-run
  ก่อนยืนยันทุกครั้ง
- ก่อนรัน LIVE บน prod: สร้าง backup ก่อนเสมอ (PITR ของ Cloud SQL ปิดอยู่ — จุดกู้คืนมีแค่
  backup รายวัน): \`gcloud sql backups create --instance=bestchoice-db --description="before-test-pack"\`
- ตอน cleanup ให้อ่าน **warnings** ที่พิมพ์ออกมาเสมอ — แถวในตารางข้อ 2 ที่มี ⚠️ คือตาราง
  KEEP ที่ factory reset ไม่ล้างให้ ต้องพึ่ง cleanup ของแพ็กนี้เท่านั้น
- ชื่อฐานข้อมูลบน prod คือ \`bestchoice\` (ไม่ใช่ \`bestchoice_prod\` ตามที่ runbook เก่า
  บางฉบับเขียน)

## 1. วิธีรัน

### Seed (สร้างข้อมูลทดสอบ)

\`\`\`bash
# dry-run — พิมพ์ว่าจะสร้างอะไร ไม่เขียน DB
EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack

# สร้างจริง (เฟส 1-2: เขียน Prisma ตรง — ไม่มี JE)
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run seed:test-pack

# เฉพาะบางโดเมน (key ตามตารางข้อ 2)
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> DOMAINS=contracts,expenses \\
  npm --prefix apps/api run seed:test-pack

# เฟส 3 — เดินเรื่องผ่าน service จริง (JE ทุกใบมาจากโค้ด production เท่านั้น)
CONFIRM_SEED=YES_I_AM_SURE EXPECTED_DB_NAME=<db> DRIVE=1 \\
  npm --prefix apps/api run seed:test-pack
# เพิ่ม POST_DATE=YYYY-MM-DD ได้ ถ้าต้องการโพสต์ลงวันอื่นที่งวดบัญชียังเปิด

# บน prod ต้องเพิ่ม: NODE_ENV=production ALLOW_PROD_SEED=YES_I_AM_SURE
\`\`\`

- seed มีด่าน **preflight** — ถ้าเงื่อนไขตั้งต้นไม่ครบ (เช่น งวดบัญชีของเดือนที่จะโพสต์ปิดอยู่)
  จะพิมพ์ปัญหาเป็นภาษาไทยแล้วหยุดก่อนเขียนอะไรทั้งสิ้น
- รันซ้ำได้ — แถวที่มีอยู่แล้วถูกข้าม (พิมพ์เป็น "ข้าม")

### Cleanup (ล้างข้อมูลทดสอบ)

\`\`\`bash
# dry-run — พิมพ์รายการที่จะลบ (ด่านสุดท้ายของคนกดก่อนยืนยัน)
EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack

# ลบจริง — เดินย้อนลำดับการสร้างเสมอ (โดเมนหลังถือ FK ของโดเมนหน้า)
CONFIRM_CLEANUP=YES_I_AM_SURE EXPECTED_DB_NAME=<db> npm --prefix apps/api run cleanup:test-pack

# ล้างรายโดเมน: เพิ่ม DOMAINS=<key>
# บน prod ต้องเพิ่ม: NODE_ENV=production ALLOW_PROD_CLEANUP=YES_I_AM_SURE
\`\`\`

## 2. โดเมนและวิธีล้าง (${domains.length} โดเมน)

คอลัมน์ "วิธีที่ cleanup ค้นแถว" คือ marker ที่ cleanup ใช้ตามหาข้อมูลทดสอบของโดเมนนั้น —
ถ้าสร้างข้อมูลเพิ่มระหว่างเทสด้วยมือ ให้ใช้ marker เดียวกันจึงจะถูกกวาดตอนล้าง

| โดเมน (\`DOMAINS=\`) | ชื่อ | จำนวน route | วิธีที่ cleanup ค้นแถว |
|---|---|---|---|
${domainRows}

## 3. route → โดเมนที่ทำให้มีข้อมูล (${routeOwners.size} route)

| route | โดเมน |
|---|---|
${routeRows}
${staleSection}
## 4. route ที่ไม่มีโดเมน seed ครอบ (${uncovered.length} route)

รายการนี้คือคำประกาศตรง ๆ ว่าแพ็กนี้ **ไม่ได้** seed อะไรบ้าง — ให้อ่านว่า "ไม่ครอบโดยตั้งใจ"
ไม่ใช่ "ลืม" ส่วนใหญ่เป็นสามกลุ่ม:

- **รายงาน/แดชบอร์ด** ที่อ่านข้อมูลจากโดเมนอื่น (งบทดลอง, สรุปรายวัน, รายงานภาษี ฯลฯ) —
  มีข้อมูลให้ดูทันทีที่โดเมนต้นทางถูก seed แล้วเดินเรื่องด้วย DRIVE=1
- **หน้า public / LIFF** ที่ต้องมี token หรือ session จริง — ทดสอบด้วยการทำจริงบนหน้าจอ
- **โดเมนที่ตัดออกจากขอบเขตโดยเจตนา** (spec §12): แชท, CRM, รีวิว, โฆษณา, ใบขายนำเข้า
  (imported sales), MDM

${uncovered.length ? uncovered.map((r) => `- \`${r}\``).join('\n') : '— ไม่มี —'}
`;
}
