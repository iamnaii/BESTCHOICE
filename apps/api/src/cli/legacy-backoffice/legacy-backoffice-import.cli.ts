/**
 * ตัวนำเข้าข้อมูลระบบเก่า (backoffice) — คำสั่งย่อยหนึ่งคำสั่งต่อหนึ่งงาน
 *
 *   npm --prefix apps/api run import:legacy-backoffice -- <คำสั่ง> [--ตัวเลือก ค่า ...]
 *
 * | คำสั่ง | ทำอะไร |
 * |---|---|
 * | `peak-recon --dump <sql> --peak-ar <csv> --out <dir> [--peak-pairs <csv>]` | จับคู่ใบแจ้งหนี้ PEAK กับสัญญา → `peak-recon.csv` + `peak-recon-unmatched.csv` (ไม่แตะฐานข้อมูล) · `--peak-pairs` = คู่ที่เจ้าของกำหนดเอง หัวคอลัมน์ `invoice_code,legacy_code` |
 * | `match-statement --dump <sql> --statement <csv> --cols date=<หัว>,amount=<หัว>[,description=<หัว>] --out <dir>` | จับคู่เงินเข้าใน statement ธนาคารกับรายการรับเงินของระบบเก่า (ยอดเท่ากัน ±3 วัน) → `unmatched.csv` + `ambiguous.csv` (ไม่แตะฐานข้อมูล) · `--cols` = ชื่อหัวคอลัมน์ในไฟล์ statement |
 *
 * dump / CSV / โฟลเดอร์ผลลัพธ์ อยู่นอก repo เสมอ (มีข้อมูลลูกค้าจริง) — ส่งเข้ามาด้วย path เท่านั้น ·
 * `--out` ที่อยู่ในโฟลเดอร์ของ repo ถูกปฏิเสธก่อนอ่านไฟล์ใด (`repo-guard.ts`) ·
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
  activeOutstandingMismatches,
  parsePeakArCsv,
  parsePeakPairsCsv,
  peakReconCsv,
  peakReconUnmatchedCsv,
  reconcileWithPeak,
} from './peak-recon';
import { assertOutsideRepo } from './repo-guard';
import {
  matchStatement,
  parseStatementCols,
  parseStatementCsv,
  statementCreditsCsv,
} from './statement-matcher';

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

/** เขียนไฟล์ผลลัพธ์ลง `outDir` (สร้างโฟลเดอร์ให้) — คืนชื่อไฟล์ที่เขียน */
async function writeOutputs(outDir: string, files: Record<string, string>): Promise<string[]> {
  await mkdir(outDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(outDir, name), content, 'utf8');
  }
  return Object.keys(files);
}

async function peakRecon(values: Values): Promise<void> {
  const [dumpPath, peakArPath, outDir] = ['dump', 'peak-ar', 'out'].map((n) => required(values, n));
  assertOutsideRepo(outDir);
  const book = buildLegacyBook(await readDumpTables(dumpPath, LEGACY_TABLES));
  const invoices = parsePeakArCsv(await readFile(peakArPath, 'utf8'));
  const pairsPath = values['peak-pairs'];
  const pairs = pairsPath ? parsePeakPairsCsv(await readFile(pairsPath, 'utf8')) : [];
  const recon = reconcileWithPeak(book, invoices, pairs);

  const written = await writeOutputs(outDir, {
    'peak-recon.csv': peakReconCsv(book, recon),
    'peak-recon-unmatched.csv': peakReconUnmatchedCsv(book, recon),
  });

  const mismatched = [...recon.matched.values()].filter((m) => m.note === 'imei-mismatch').length;
  console.log(`${LOG} peak-recon`);
  console.log(`  สัญญาในระบบเก่า            : ${book.contracts.length}`);
  console.log(`  ใบแจ้งหนี้ PEAK            : ${invoices.length}`);
  console.log(
    `  จับคู่ได้                   : ${recon.matched.size} ` +
      `(ผ่อนอยู่ที่ยอดค้างไม่ตรง ${activeOutstandingMismatches(book, recon)})`,
  );
  console.log(`  คู่ที่กำหนดเอง              : ${pairs.length} (IMEI ไม่ตรง ${mismatched})`);
  console.log(`  สัญญาผ่อนอยู่ที่ไม่มีคู่       : ${recon.unmatchedContracts.length}`);
  console.log(`  ใบแจ้งหนี้กำกวม             : ${recon.ambiguous.length}`);
  console.log(`  ใบแจ้งหนี้ที่ไม่พบสัญญา       : ${recon.unmatchedInvoices.length}`);
  console.log(`  เขียนไฟล์                  : ${written.join(', ')} → ${outDir}`);
}

async function matchStatementCommand(values: Values): Promise<void> {
  const [dumpPath, statementPath, colsSpec, outDir] = ['dump', 'statement', 'cols', 'out'].map(
    (n) => required(values, n),
  );
  assertOutsideRepo(outDir);
  const cols = parseStatementCols(colsSpec);
  const book = buildLegacyBook(await readDumpTables(dumpPath, LEGACY_TABLES));
  const credits = parseStatementCsv(await readFile(statementPath, 'utf8'), cols);
  const receipts = book.contracts.flatMap((c) => c.receipts);
  const result = matchStatement(credits, receipts);

  const written = await writeOutputs(outDir, {
    'unmatched.csv': statementCreditsCsv(result.unmatched),
    'ambiguous.csv': statementCreditsCsv(result.ambiguous),
  });

  console.log(`${LOG} match-statement`);
  console.log(`  เงินเข้าใน statement          : ${credits.length}`);
  console.log(`  รายการรับเงินในระบบเก่า        : ${receipts.length}`);
  console.log(`  จับคู่ได้                      : ${result.matched.length}`);
  console.log(`  ไม่พบในระบบเก่า               : ${result.unmatched.length}`);
  console.log(`  กำกวม (ยอดและวันเดียวกัน)      : ${result.ambiguous.length}`);
  console.log(`  เขียนไฟล์                     : ${written.join(', ')} → ${outDir}`);
}

const COMMANDS = new Map<string, Command>([
  [
    'peak-recon',
    {
      usage: 'peak-recon --dump <sql> --peak-ar <csv> --out <dir> [--peak-pairs <csv>]',
      options: ['dump', 'peak-ar', 'out', 'peak-pairs'],
      run: peakRecon,
    },
  ],
  [
    'match-statement',
    {
      usage:
        'match-statement --dump <sql> --statement <csv> ' +
        '--cols date=<หัว>,amount=<หัว>[,description=<หัว>] --out <dir>',
      options: ['dump', 'statement', 'cols', 'out'],
      run: matchStatementCommand,
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
