import { PdfReportService } from '../../src/modules/reporting/pdf-report.service';
import { StuckContractRow } from '../../src/modules/overdue/stuck-contracts.service';
import { TEST_NAME_PREFIX } from '../../src/utils/test-data-markers';
import { parseReport } from './support/collections-report-pdf';
import { foldThai, parsePdf } from './support/pdf';

/**
 * DOC-10 parser regression (CI run 41222372998 attempt 1, 2026-10-31): the follow-up table
 * printed by PdfReportService is re-assembled into cells from text positions. pdf.js joins two
 * text runs of the same font on one baseline into ONE text item (with a space) whenever the gap
 * between them is at most 0.6 em — 9.6 pt at the 16 pt body size. jspdf-autotable lets a cell's
 * text run up to 1 pt past its content box before wrapping, so two left-aligned neighbours can be
 * only 2 × 5.25 − 1 = 9.5 pt apart. With these exact rows (three documents worlds sharing one
 * database) the customer column is shrunk so "… DOCS-EB6D7A1D" ends 9.58 pt before "OVERDUE":
 * pdf.js returned "ทดสอบระบบ ลูกค้าเอกสาร DOCS-EB6D7A1D OVERDUE" as one item and the parser put
 * the status into the Customer cell. The printed PDF itself is correct (status in its own column).
 *
 * No database or app: the real report service renders stubbed analytics, so this runs in seconds.
 */
const name = (prefix: string) => `${TEST_NAME_PREFIX} ลูกค้าเอกสาร ${prefix}`;
const row = (contractNumber: string, customerName: string, status: string): StuckContractRow => ({
  contractId: contractNumber,
  contractNumber,
  customerName,
  customerPhone: null,
  branchName: 'A',
  assignedToId: null,
  assignedToName: null,
  daysIdle: 20757,
  outstanding: 0,
  status,
});
/** The 20 follow-up rows of the failing CI report, in printed order. */
const CI_ROWS: StuckContractRow[] = [
  row('TEST-DOCS-C953A4E7-LT-P21', name('DOCS-C953A4E7'), 'OVERDUE'),
  row('TEST-DOCS-EB6D7A1D-LT-LONG', name('DOCS-EB6D7A1D'), 'OVERDUE'),
  row('TEST-DOCS-EB6D7A1D-LT-B1', name('DOCS-EB6D7A1D'), 'OVERDUE'),
  row('TEST-DOCS-EB6D7A1D-LT-FRESH', name('DOCS-EB6D7A1D'), 'OVERDUE'),
  row('TEST-DOCS-EB6D7A1D-LT-A60', name('DOCS-EB6D7A1D'), 'TERMINATED'),
  row('TEST-DOCS-FD229337-RC-LEGAL', `${TEST_NAME_PREFIX} DOCS-FD229337 LEGAL`, 'TERMINATED'),
  ...Array.from({ length: 14 }, (_, i) =>
    row(
      `TEST-DOCS-C953A4E7-LT-P${String(i + 1).padStart(2, '0')}`,
      name('DOCS-C953A4E7'),
      'OVERDUE',
    ),
  ),
];

async function renderFollowUp(rows: StuckContractRow[]): Promise<Buffer> {
  const service = new PdfReportService(
    {} as never,
    {
      getAnalytics: async () => ({
        weeklyCollectionRate: [],
        promiseKeptTrend: [],
        dunningActionVolume: [],
        letterDispatchByType: [],
      }),
    } as never,
    { getAgingBuckets: async () => [] } as never,
    { getLeaderboard: async () => [] } as never,
    { getRecoveryByChannel: async () => [] } as never,
    { getStuckContracts: async () => rows } as never,
  );
  return service.generate({
    from: new Date('2026-10-21T17:00:00Z'),
    to: new Date('2026-10-28T16:59:59.999Z'),
  });
}

describe('DOC-10 collections report parser — one cell per drawn text run', () => {
  it('the follow-up rows of CI run 41222372998 read back cell by cell although pdf.js merges "customer + status" into one text item', async () => {
    const pdf = await parsePdf(await renderFollowUp(CI_ROWS));
    // Precondition: these rows still reproduce the merge (if a layout change removes it, the
    // assertion below no longer guards anything — rebuild the rows instead of deleting this).
    const merged = pdf.pages
      .flatMap((page) => page.items)
      .filter((item) => item.str.includes('DOCS-EB6D7A1D') && /OVERDUE|TERMINATED/.test(item.str));
    expect(merged.length).toBeGreaterThan(0);

    const followUp = parseReport(pdf).sections.followUp;
    expect(followUp?.head).toEqual(['Contract #', 'Days stuck', 'Customer', 'Status']);
    expect(
      followUp?.rows.map((r) => [r.cells[0], r.cells[1], foldThai(r.cells[2]), r.cells[3]]),
    ).toEqual(
      CI_ROWS.map((r) => [
        r.contractNumber,
        String(r.daysIdle),
        foldThai(r.customerName),
        r.status,
      ]),
    );
  });
});

/** One-page PDF around a hand-written content stream, Helvetica as /F1 (A = B = 667/1000 em). */
function handWrittenPdf(content: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = Buffer.byteLength(body, 'latin1');
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(body, 'latin1');
  const entries = offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join('')}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

describe('parsePdf runs — gives up instead of guessing', () => {
  it('Tj runs are placed from the text state: A at 100, B after its 8 pt advance', async () => {
    const pdf = await parsePdf(handWrittenPdf('BT /F1 12 Tf 100 700 Td (A) Tj (B) Tj ET'));
    const runs = pdf.pages[0].runs;
    expect(runs?.map((r) => r.str)).toEqual(['A', 'B']);
    expect(runs?.[0].x).toBeCloseTo(100, 2);
    expect(runs?.[1].x).toBeCloseTo(108, 2);
  });

  it('a TJ array (pdf.js 3.x passes its kerning numbers inside showText) makes the page runs null', async () => {
    const pdf = await parsePdf(
      handWrittenPdf('BT /F1 12 Tf 100 700 Td [(A) -5000 (B)] TJ (C) Tj ET'),
    );
    // pdf.js itself moves B by the kerning (8 + 60 pt): the run reader would have put it at 108.
    expect(pdf.pages[0].items.find((item) => item.str.startsWith('B'))?.x).toBeCloseTo(168, 2);
    expect(pdf.pages[0].runs).toBeNull();
  });
});
