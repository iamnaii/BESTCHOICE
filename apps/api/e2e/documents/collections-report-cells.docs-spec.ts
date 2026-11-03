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
