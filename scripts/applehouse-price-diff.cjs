/**
 * Compare two AppleHouse buyback snapshots and write a Thai review summary.
 *
 *   node scripts/applehouse-price-diff.cjs <previous.json> <new.json> [--body <out.md>]
 *   node scripts/applehouse-price-diff.cjs --check <new.json>     (validate only)
 *
 * Exits 2 when the new snapshot is invalid (same rules as the importer
 * apps/api/prisma/seed-sell-valuations-applehouse.ts), so a broken fetch never
 * becomes a pull request. When GITHUB_OUTPUT is set it records `changed`,
 * `title` and `date` for the workflow (.github/workflows/applehouse-prices-refresh.yml).
 */
const fs = require('node:fs');

const SOURCE = 'https://applehouseth.com/';
const BIG_MOVE = 0.15; // flag a price that moves 15% or more in one round
const MAX_DROP = 0.2; // warn loudly when 20% or more of the models disappear

const key = row => `${row.model.toLowerCase()}|${row.storage.toLowerCase()}`;
const baht = n => Number(n).toLocaleString('en-US');
const signed = n => (n > 0 ? `+${baht(n)}` : baht(n));

function validate(snapshot) {
  const errors = [];
  if (snapshot.source !== SOURCE) errors.push(`แหล่งข้อมูลไม่ใช่ ${SOURCE}`);
  if (!Number.isFinite(Date.parse(snapshot.fetchedAt))) errors.push('ไม่มีเวลาที่ดึงข้อมูล');
  if (!Array.isArray(snapshot.rows) || !snapshot.rows.length) errors.push('ไม่มีราคาเลย');
  const seen = new Set();
  for (const row of snapshot.rows ?? []) {
    const id = key(row);
    if (seen.has(id)) errors.push(`รุ่นซ้ำ: ${row.model} ${row.storage}`);
    seen.add(id);
    if (!/^iPhone\b/i.test(row.model)) errors.push(`ไม่ใช่ iPhone: ${row.model}`);
    if (!/^\d+(GB|TB)$/.test(row.storage)) errors.push(`ความจุผิดรูป: ${row.model} ${row.storage}`);
    if (!Number.isSafeInteger(row.basePrice) || row.basePrice <= 0) errors.push(`ราคาผิด: ${row.model} ${row.storage}`);
  }
  return errors;
}

function thaiDate(iso) {
  return new Date(iso).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' });
}

function compare(previous, next) {
  const before = new Map(previous.rows.map(row => [key(row), row]));
  const after = new Map(next.rows.map(row => [key(row), row]));
  const changed = [], added = [], unchanged = [];
  for (const row of next.rows) {
    const old = before.get(key(row));
    if (!old) added.push(row);
    else if (old.basePrice !== row.basePrice) changed.push({ row, old });
    else unchanged.push(row);
  }
  const removed = previous.rows.filter(row => !after.has(key(row)));
  return { changed, added, removed, unchanged };
}

function render(previous, next, diff) {
  const { changed, added, removed, unchanged } = diff;
  const up = changed.filter(c => c.row.basePrice > c.old.basePrice).length;
  const down = changed.length - up;
  const lines = [];
  lines.push(`ราคากลางรับซื้อ iPhone เกรด A จาก AppleHouse ดึงเมื่อ **${thaiDate(next.fetchedAt)}** เทียบกับชุดที่ใช้อยู่ (ดึงเมื่อ ${thaiDate(previous.fetchedAt)})`);
  lines.push('');
  if (removed.length / previous.rows.length >= MAX_DROP) {
    lines.push(`> [!CAUTION]`);
    lines.push(`> รุ่นหายไป ${removed.length} จาก ${previous.rows.length} รุ่น — เว็บต้นทางอาจเปลี่ยนรูปแบบ ตรวจก่อนกด Merge`);
    lines.push('');
  }
  lines.push(`**สรุป:** ราคาเปลี่ยน ${changed.length} รุ่น (ขึ้น ${up} · ลง ${down}) · รุ่นใหม่ ${added.length} · รุ่นที่หายไป ${removed.length} · เท่าเดิม ${unchanged.length}`);
  lines.push('');
  if (changed.length) {
    lines.push('### ราคาที่เปลี่ยน');
    lines.push('');
    lines.push('| รุ่น | ความจุ | ราคาเดิม | ราคาใหม่ | ต่าง | โปรที่รวมอยู่ |');
    lines.push('|---|---|---:|---:|---:|---:|');
    for (const { row, old } of changed) {
      const delta = row.basePrice - old.basePrice;
      const flag = Math.abs(delta) / old.basePrice >= BIG_MOVE ? ' ⚠️' : '';
      lines.push(`| ${row.model} | ${row.storage} | ${baht(old.basePrice)} | ${baht(row.basePrice)} | ${signed(delta)}${flag} | ${baht(row.promotion || 0)} |`);
    }
    lines.push('');
    if (changed.some(({ row, old }) => Math.abs(row.basePrice - old.basePrice) / old.basePrice >= BIG_MOVE)) {
      lines.push(`⚠️ = ราคาขยับ ${BIG_MOVE * 100}% ขึ้นไปในรอบเดียว`);
      lines.push('');
    }
  }
  if (added.length) {
    lines.push('### รุ่นใหม่ (จะเปิดรับซื้อเมื่อ Merge)');
    lines.push('');
    lines.push('| รุ่น | ความจุ | ราคา | โปรที่รวมอยู่ |');
    lines.push('|---|---|---:|---:|');
    for (const row of added) lines.push(`| ${row.model} | ${row.storage} | ${baht(row.basePrice)} | ${baht(row.promotion || 0)} |`);
    lines.push('');
  }
  if (removed.length) {
    lines.push('### รุ่นที่ AppleHouse ไม่มีราคาแล้ว (จะปิดรับซื้อบนเว็บเมื่อ Merge)');
    lines.push('');
    lines.push('| รุ่น | ความจุ | ราคาเดิม |');
    lines.push('|---|---|---:|');
    for (const row of removed) lines.push(`| ${row.model} | ${row.storage} | ${baht(row.basePrice)} |`);
    lines.push('');
    lines.push('รุ่นเหล่านี้จะเปิดรับซื้อกลับเองเมื่อ AppleHouse มีราคาอีกในรอบถัดไป');
    lines.push('');
  }
  lines.push('### ทำอย่างไรต่อ');
  lines.push('');
  lines.push('- **เห็นด้วย** → กด Merge · ระบบ deploy ตามปกติ แล้วนำราคาเข้าระบบจริงเองหลัง deploy ผ่าน');
  lines.push('- **ไม่เห็นด้วย** → ปิด PR นี้ได้เลย ระบบใช้ราคาเดิมต่อ · รอบถัดไป (อีก 2 สัปดาห์) จะเทียบกับราคาเดิมอีกครั้ง');
  lines.push('- ราคาที่ร้านปรับเองในแท็บ "ตารางราคากลาง" จะ**ไม่ถูกทับ**');
  lines.push('- ราคาของ AppleHouse รวมโปรโมชันของเขา ณ วันที่ดึงแล้ว (คอลัมน์ "โปรที่รวมอยู่")');
  lines.push('');
  lines.push('<sub>สร้างอัตโนมัติโดย workflow "ราคากลางรับซื้อ AppleHouse — ดึงทุก 2 สัปดาห์"</sub>');
  return lines.join('\n') + '\n';
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--check') {
    const snapshot = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    const errors = validate(snapshot);
    if (errors.length) {
      console.error(`ข้อมูลราคาที่ดึงมาใช้ไม่ได้:\n- ${errors.join('\n- ')}`);
      process.exit(2);
    }
    console.log(`ข้อมูลราคาใช้ได้: ${snapshot.rows.length} รุ่น ดึงเมื่อ ${snapshot.fetchedAt}`);
    return;
  }
  const bodyAt = args.indexOf('--body');
  const bodyPath = bodyAt >= 0 ? args[bodyAt + 1] : null;
  const [previousPath, nextPath] = args.filter((arg, i) => arg !== '--body' && i !== bodyAt + 1);
  if (!previousPath || !nextPath) {
    console.error('usage: node scripts/applehouse-price-diff.cjs <previous.json> <new.json> [--body <out.md>]');
    process.exit(1);
  }
  const previous = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
  const next = JSON.parse(fs.readFileSync(nextPath, 'utf8'));
  const errors = validate(next);
  if (errors.length) {
    console.error(`ข้อมูลราคาที่ดึงมาใช้ไม่ได้:\n- ${errors.join('\n- ')}`);
    process.exit(2);
  }
  const diff = compare(previous, next);
  const changed = diff.changed.length + diff.added.length + diff.removed.length > 0;
  const body = changed
    ? render(previous, next, diff)
    : `ราคากลางรับซื้อ AppleHouse ดึงเมื่อ ${thaiDate(next.fetchedAt)} **เท่าเดิมทุกรุ่น** (${next.rows.length} รุ่น) — ไม่ต้องทำอะไร\n`;
  if (bodyPath) fs.writeFileSync(bodyPath, body);
  else process.stdout.write(body);
  const date = next.fetchedAt.slice(0, 10);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT,
      `changed=${changed}\ndate=${date}\ntitle=อัปเดตราคากลางรับซื้อ AppleHouse ${thaiDate(next.fetchedAt)} (เปลี่ยน ${diff.changed.length} · ใหม่ ${diff.added.length} · หาย ${diff.removed.length})\n`);
  }
  console.error(`changed=${changed} (เปลี่ยน ${diff.changed.length} · ใหม่ ${diff.added.length} · หาย ${diff.removed.length} · เท่าเดิม ${diff.unchanged.length})`);
}

main();
