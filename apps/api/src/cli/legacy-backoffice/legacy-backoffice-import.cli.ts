/**
 * ตัวนำเข้าข้อมูลระบบเก่า (backoffice) — คำสั่งย่อยหนึ่งคำสั่งต่อหนึ่งงาน
 *
 *   npm --prefix apps/api run import:legacy-backoffice -- <คำสั่ง> [--ตัวเลือก ค่า ...]
 *
 * | คำสั่ง | ทำอะไร |
 * |---|---|
 * | `peak-recon --dump <sql> --peak-ar <csv> --out <dir>` | จับคู่ใบแจ้งหนี้ PEAK กับสัญญา → `peak-recon.csv` + `peak-recon-unmatched.csv` (ไม่แตะฐานข้อมูล) |
 *
 * dump / CSV / โฟลเดอร์ผลลัพธ์ อยู่นอก repo เสมอ (มีข้อมูลลูกค้าจริง) — ส่งเข้ามาด้วย path เท่านั้น ·
 * ข้อความบนจอมีแต่จำนวน ไม่มีชื่อหรือยอดรายสัญญา
 *
 * เพิ่มคำสั่ง: เติมรายการใน `COMMANDS` (ตัวเลือกของคำสั่งนั้น + ฟังก์ชันที่รับค่าที่อ่านแล้ว)
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { readDumpTables } from './dump-reader';
import { buildLegacyBook, LEGACY_TABLES } from './legacy-book';
import {
  parsePeakArCsv,
  peakReconCsv,
  peakReconUnmatchedCsv,
  reconcileWithPeak,
} from './peak-recon';

const LOG = '[legacy-backoffice-import]';

type Values = Record<string, string | undefined>;

type Command = {
  usage: string;
  /** ตัวเลือกแบบมีค่าทั้งหมด (`--name value`) — ตัวเลือกที่ไม่รู้จัก = error */
  options: readonly string[];
  run(values: Values): Promise<void>;
};

function required(values: Values, name: string): string {
  const value = values[name];
  if (!value) throw new Error(`ต้องระบุ --${name}`);
  return value;
}

async function peakRecon(values: Values): Promise<void> {
  const [dumpPath, peakArPath, outDir] = ['dump', 'peak-ar', 'out'].map((n) => required(values, n));
  const book = buildLegacyBook(await readDumpTables(dumpPath, LEGACY_TABLES));
  const invoices = parsePeakArCsv(await readFile(peakArPath, 'utf8'));
  const recon = reconcileWithPeak(book, invoices);

  await mkdir(outDir, { recursive: true });
  const files = {
    'peak-recon.csv': peakReconCsv(book, recon),
    'peak-recon-unmatched.csv': peakReconUnmatchedCsv(book, recon),
  };
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outDir, name), content, 'utf8');
  }

  const withDiff = [...recon.matched.values()].filter((m) => !m.diff.isZero()).length;
  console.log(`${LOG} peak-recon`);
  console.log(`  สัญญาในระบบเก่า            : ${book.contracts.length}`);
  console.log(`  ใบแจ้งหนี้ PEAK            : ${invoices.length}`);
  console.log(`  จับคู่ได้                   : ${recon.matched.size} (ยอดค้างไม่ตรง ${withDiff})`);
  console.log(`  สัญญาผ่อนอยู่ที่ไม่มีคู่       : ${recon.unmatchedContracts.length}`);
  console.log(`  ใบแจ้งหนี้กำกวม             : ${recon.ambiguous.length}`);
  console.log(`  ใบแจ้งหนี้ที่ไม่พบสัญญา       : ${recon.unmatchedInvoices.length}`);
  console.log(`  เขียนไฟล์                  : ${Object.keys(files).join(', ')} → ${outDir}`);
}

const COMMANDS = new Map<string, Command>([
  [
    'peak-recon',
    {
      usage: 'peak-recon --dump <sql> --peak-ar <csv> --out <dir>',
      options: ['dump', 'peak-ar', 'out'],
      run: peakRecon,
    },
  ],
]);

function usage(): string {
  const lines = [...COMMANDS.values()].map((c) => `  ${c.usage}`);
  return ['ใช้: npm --prefix apps/api run import:legacy-backoffice -- <คำสั่ง>', ...lines].join(
    '\n',
  );
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const [name, ...rest] = argv;
  const command = name === undefined ? undefined : COMMANDS.get(name);
  if (!command) {
    throw new Error(
      `${name === undefined ? 'ไม่ได้ระบุคำสั่ง' : `ไม่รู้จักคำสั่ง ${name}`}\n${usage()}`,
    );
  }
  const { values } = parseArgs({
    args: [...rest],
    options: Object.fromEntries(command.options.map((o) => [o, { type: 'string' as const }])),
    strict: true,
    allowPositionals: false,
  });
  await command.run(values as Values);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`${LOG} ERROR:`, err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
