import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { inspectFiles } from './tooltify-cutover/inspect';
import type { InspectionReport } from './tooltify-cutover/types';

const USAGE =
  'npm run import:tooltify-cutover --workspace=@installment/api -- inspect --out-dir <dir> <file.xlsx> [<file.xlsx> ...]';

function csvField(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  const escaped = /^[\s]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + escaped.replace(/"/g, '""') + '"';
}

function inspectionCsv(report: InspectionReport): string {
  const rows: (string | number | null | undefined)[][] = [
    [
      'sha256',
      'file_names',
      'bytes',
      'kind',
      'declared_from',
      'declared_to',
      'actual_from_bangkok',
      'actual_to_bangkok',
      'file_detail_rows',
      'bill_count',
      'section',
      'header_row',
      'columns',
      'section_declared_rows',
      'section_observed_rows',
    ],
  ];
  for (const file of report.files) {
    const summary = [
      file.sha256,
      file.fileNames.join(' | '),
      file.byteSize,
      file.kind,
      file.declaredRange?.start,
      file.declaredRange?.end,
      file.actualRange?.start,
      file.actualRange?.end,
      file.sourceRowCount,
      file.billCount,
    ];
    if (!file.sections.length) rows.push(summary);
    for (const section of file.sections) {
      rows.push([
        ...summary,
        section.label,
        section.headerRow,
        section.columns.join(' | '),
        section.declaredRowCount,
        section.sourceRowCount,
      ]);
    }
  }
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { 'out-dir': { type: 'string' }, help: { type: 'boolean' } },
  });
  if (values.help) {
    console.log(USAGE);
    return;
  }
  const [mode, ...paths] = positionals;
  if (mode !== 'inspect' || !paths.length || !values['out-dir']) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const report = await inspectFiles(paths);
  const outDir = values['out-dir'];
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const stage = await mkdtemp(join(outDir, '.tooltify-inspection-'));
  const reports = [
    { name: 'inspection.json', content: JSON.stringify(report, null, 2) + '\n' },
    { name: 'inspection.csv', content: inspectionCsv(report) },
  ];
  try {
    await Promise.all(
      reports.map(({ name, content }) => writeFile(join(stage, name), content, { mode: 0o600 })),
    );
    for (const { name } of reports) await rename(join(stage, name), join(outDir, name));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  console.log(
    `ตรวจ ${report.files.length} ไฟล์ที่ checksum ต่างกัน เขียน inspection.json และ inspection.csv แล้ว`,
  );
  if (report.issues.length || report.files.some(({ kind }) => kind === 'UNKNOWN')) {
    process.exitCode = 1;
  }
}

void main().catch(() => {
  console.error('ตรวจไฟล์หรือบันทึกรายงานไม่ได้ กรุณาตรวจอาร์กิวเมนต์และสิทธิ์ไฟล์');
  process.exitCode = 1;
});
