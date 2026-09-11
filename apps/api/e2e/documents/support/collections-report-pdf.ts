import { DOCUMENT_STYLE } from '@installment/shared';
import { PrismaService } from '../../../src/prisma/prisma.service';
import {
  analyticsRangeFor, analyticsSince, bangkokDate, expectedAging, expectedCollectionRate, expectedCollectors, expectedDunningTotals, expectedLetters, expectedPromiseTrend, expectedRecovery, expectedStuck,
} from './collections-report-fixtures';
import { foldThai, ParsedPdf, PdfTextItem } from './pdf';

/**
 * DOC-10 (issue #1569) — re-assembling the jsPDF collections report from text
 * positions (page frame, KPI strip, titled tables with repeated heads) and the
 * assertion that every printed figure equals the independent restatement.
 * Shared by the API spec and the browser spec.
 */
export type SectionKey = 'aging' | 'collectors' | 'recovery' | 'letters' | 'promises' | 'followUp';
export const SECTION_TITLES: Record<SectionKey, string> = { aging: 'Aging /', collectors: 'Collectors /', recovery: 'Recovery /', letters: 'Letters /', promises: 'Promises /', followUp: 'Follow-up /' };
export interface Baseline { page: number; y: number; items: PdfTextItem[]; text: string; maxSize: number }
export interface ParsedRow { page: number; cells: string[] }
export interface ParsedSection { title: string; head: string[]; headPages: number[]; rows: ParsedRow[] }
export interface ParsedReport {
  period: { from: string; to: string } | null;
  kpi: { collectionRate: number; kept: number; broken: number; sent: number; failed: number; stuck: number } | null;
  sections: Partial<Record<SectionKey, ParsedSection>>;
  pages: Array<{ index: number; title: boolean; period: boolean; footer: string | null; pageLabel: string | null }>;
}

/** Baselines of every page, top first, each with its items left to right. */
export function baselinesOf(pdf: ParsedPdf): Baseline[] {
  const out: Baseline[] = [];
  for (const page of pdf.pages) {
    const rows = new Map<number, PdfTextItem[]>();
    for (const item of page.items) {
      if (!item.str.trim()) continue;
      const key = Math.round(item.y * 2) / 2;
      rows.set(key, [...(rows.get(key) ?? []), item]);
    }
    for (const [y, items] of [...rows.entries()].sort(([a], [b]) => b - a)) {
      const sorted = items.sort((a, b) => a.x - b.x);
      out.push({ page: page.index, y, items: sorted, text: sorted.map((i) => i.str).join('').replace(/\s+/g, ' ').trim(), maxSize: Math.max(...sorted.map((i) => Math.round(i.size * 10) / 10)) });
    }
  }
  return out;
}

/** Column spans from a table head baseline: items separated by more than a word space start a new column. */
export function columnsOf(head: Baseline): Array<{ start: number; end: number }> {
  const columns: Array<{ start: number; end: number }> = [];
  for (const item of head.items) {
    const last = columns[columns.length - 1];
    if (last && item.x - last.end < 7) last.end = Math.max(last.end, item.x + item.width);
    else columns.push({ start: item.x, end: item.x + item.width });
  }
  return columns;
}

export function cellsOf(baseline: Baseline, columns: Array<{ start: number; end: number }>): string[] {
  const cells = columns.map(() => '');
  for (const item of baseline.items) {
    let index = columns.length - 1;
    for (let i = 0; i < columns.length; i += 1) {
      const boundary = i + 1 < columns.length ? (columns[i].end + columns[i + 1].start) / 2 : Number.POSITIVE_INFINITY;
      if (item.x < boundary) { index = i; break; }
    }
    cells[index] += item.str;
  }
  return cells.map((c) => c.replace(/\s+/g, ' ').trim());
}

/**
 * Page header/footer, KPI strip, then each titled section with its head row (repeated on every
 * page it continues on) and rows. A baseline less than 24 pt below the previous one on the
 * same page continues the same row (a wrapped cell).
 */
export function parseReport(pdf: ParsedPdf): ParsedReport {
  const report: ParsedReport = { period: null, kpi: null, sections: {}, pages: pdf.pages.map((p) => ({ index: p.index, title: false, period: false, footer: null, pageLabel: null })) };
  let current: { section: ParsedSection; columns: Array<{ start: number; end: number }> | null; lastY: number | null; page: number; headFirstLine: string[]; headOpen: boolean } | null = null;
  let kpiColumns: Array<{ start: number; end: number }> | null = null;
  for (const baseline of baselinesOf(pdf)) {
    const page = report.pages[baseline.page - 1];
    if (baseline.text.startsWith('BESTCHOICE Collections Report')) { page.title = true; continue; }
    if (baseline.text.startsWith('Period:')) {
      page.period = true;
      const match = baseline.text.match(/^Period: (\d{4}-\d{2}-\d{2}) — (\d{4}-\d{2}-\d{2})$/);
      if (match && !report.period) report.period = { from: match[1], to: match[2] };
      continue;
    }
    if (baseline.text.startsWith('Generated:')) {
      page.footer = baseline.text;
      page.pageLabel = (baseline.text.match(/(\d+ \/ \d+)$/) ?? [null, null])[1];
      continue;
    }
    if (baseline.text.startsWith('Collection rate')) { kpiColumns = columnsOf(baseline); continue; }
    if (kpiColumns && !report.kpi && /%/.test(baseline.text)) {
      const [rate, promises, dunning, stuck] = cellsOf(baseline, kpiColumns);
      const pair = (text: string) => text.split('/').map((n) => Number(n.trim()));
      report.kpi = { collectionRate: Number(rate.replace('%', '')), kept: pair(promises)[0], broken: pair(promises)[1], sent: pair(dunning)[0], failed: pair(dunning)[1], stuck: Number(stuck) };
      kpiColumns = null;
      continue;
    }
    const titleKey = (Object.keys(SECTION_TITLES) as SectionKey[]).find((key) => baseline.text.startsWith(SECTION_TITLES[key]));
    if (titleKey && baseline.maxSize >= DOCUMENT_STYLE.headingPt - 0.5) {
      current = { section: { title: baseline.text, head: [], headPages: [], rows: [] }, columns: null, lastY: null, page: baseline.page, headFirstLine: [], headOpen: false };
      report.sections[titleKey] = current.section;
      continue;
    }
    if (!current) continue;
    // The first baseline after a title is the head; on a later page the same first head line (cells
    // assembled with the columns already known) announces the table continuing there.
    const isHead = current.columns === null || (baseline.page !== current.page && current.headFirstLine.length > 0 && cellsOf(baseline, current.columns).join('|') === current.headFirstLine.join('|'));
    if (isHead) {
      const firstHead = current.columns === null;
      current.columns = columnsOf(baseline);
      const cells = cellsOf(baseline, current.columns);
      if (firstHead) { current.headFirstLine = cells; current.section.head = cells; }
      current.section.headPages.push(baseline.page);
      current.headOpen = true;
      current.page = baseline.page;
      current.lastY = baseline.y;
      continue;
    }
    const cells = cellsOf(baseline, current.columns!);
    const closeBelow = baseline.page === current.page && current.lastY !== null && current.lastY - baseline.y < 24;
    if (closeBelow && current.headOpen) {
      // A head cell wrapped onto a second line ("Days" / "stuck") — merged once, skipped on repeats.
      if (current.section.headPages.length === 1) current.section.head = current.section.head.map((cell, i) => (cells[i] ? `${cell} ${cells[i]}`.trim() : cell));
      current.lastY = baseline.y;
      continue;
    }
    current.headOpen = false;
    const continuation = closeBelow && current.section.rows.length > 0;
    if (continuation) {
      const row = current.section.rows[current.section.rows.length - 1];
      row.cells = row.cells.map((cell, i) => (cells[i] ? `${cell} ${cells[i]}`.trim() : cell));
    } else {
      current.section.rows.push({ page: baseline.page, cells });
    }
    current.page = baseline.page;
    current.lastY = baseline.y;
  }
  return report;
}

/** Compare a top-N list against an ordered expectation whose ties (equal sort keys) may come in any order. */
export function expectTopWithTies(actual: string[], expected: Array<{ key: string; tie: string }>, limit: number): void {
  const top = expected.slice(0, limit);
  expect(actual.length).toBe(top.length);
  if (expected.length > limit && expected[limit - 1].tie === expected[limit].tie) {
    const boundaryTie = expected[limit - 1].tie;
    const required = top.filter((row) => row.tie !== boundaryTie).map((row) => row.key);
    const optional = expected.filter((row) => row.tie === boundaryTie).map((row) => row.key);
    for (const key of required) expect(actual).toContain(key);
    for (const key of actual) expect([...required, ...optional]).toContain(key);
  } else {
    expect([...actual].sort()).toEqual(top.map((row) => row.key).sort());
  }
  // Groups of equal sort keys must appear in the expected order.
  const rank = new Map(expected.map((row) => [row.key, row.tie]));
  const ties = actual.map((key) => rank.get(key));
  const order = [...new Set(expected.map((row) => row.tie))];
  for (let i = 1; i < ties.length; i += 1) expect(order.indexOf(ties[i]!)).toBeGreaterThanOrEqual(order.indexOf(ties[i - 1]!));
}

export type ReportSource = Awaited<ReturnType<typeof expectReportMatchesSource>>;

/** Every figure of a rendered report against the independent restatement for the same period. */
export async function expectReportMatchesSource(prisma: PrismaService, report: ParsedReport, from: Date, to: Date, generatedAt: Date) {
  const range = analyticsRangeFor(from, to);
  const since = analyticsSince(range, generatedAt);
  const [aging, collectors, recovery, stuck, letters, promises, dunning, collection] = await Promise.all([
    expectedAging(prisma, generatedAt), expectedCollectors(prisma), expectedRecovery(prisma, from, to), expectedStuck(prisma, generatedAt), expectedLetters(prisma, since), expectedPromiseTrend(prisma, since), expectedDunningTotals(prisma, since), expectedCollectionRate(prisma, since),
  ]);
  expect(report.period).toEqual({ from: bangkokDate(from), to: bangkokDate(to) });
  expect(report.kpi).toEqual({ collectionRate: collection.rate, kept: promises.reduce((s, r) => s + r.kept, 0), broken: promises.reduce((s, r) => s + r.broken, 0), sent: dunning.sent, failed: dunning.failed, stuck: stuck.length });
  // Aging — one row per bucket, in order, count and outstanding as printed.
  expect(report.sections.aging?.head).toEqual(['Aging bucket', 'Contracts', 'Outstanding']);
  expect(report.sections.aging?.rows.map((r) => r.cells)).toEqual(aging.map((r) => [r.bucket, String(r.count), r.outstanding]));
  // Collectors — top 10 by recovery this month, then assigned. The PDF prints names only, and every
  // documents world names its users alike ("ทดสอบระบบ SALES sales-a"), so rows are compared as the
  // whole printed triple (name folded for Thai marks) and the order is read off the printed figures.
  const collectorRows = report.sections.collectors?.rows ?? [];
  expect(collectorRows.length).toBe(Math.min(10, collectors.length));
  const collectorKey = (name: string, assigned: string | number, recovery: string) => `${foldThai(name)}|${assigned}|${recovery}`;
  expectTopWithTies(collectorRows.map((r) => collectorKey(r.cells[0], r.cells[1], r.cells[2])), collectors.map((r) => ({ key: collectorKey(r.name, r.assigned, r.recovery), tie: `${r.recovery}|${r.assigned}` })), 10);
  for (let i = 1; i < collectorRows.length; i += 1) {
    const [, prevAssigned, prevRecovery] = collectorRows[i - 1].cells;
    const [, assigned, recovery] = collectorRows[i].cells;
    expect(Number(recovery) < Number(prevRecovery) || (Number(recovery) === Number(prevRecovery) && Number(assigned) <= Number(prevAssigned))).toBe(true);
  }
  // Recovery — always the 4 channels.
  expect(report.sections.recovery?.head).toEqual(['Channel', 'Sent', 'Recovered', 'Rate']);
  expect(report.sections.recovery?.rows.map((r) => r.cells)).toEqual(recovery.map((r) => [r.channel, String(r.sent), String(r.recovered), r.rate]));
  // Letters / promises — sections exist only when the window has rows.
  if (letters.length) expect(report.sections.letters?.rows.map((r) => r.cells)).toEqual(letters.map((r) => [r.type, r.month, String(r.count)]));
  else expect(report.sections.letters).toBeUndefined();
  if (promises.length) expect(report.sections.promises?.rows.map((r) => r.cells)).toEqual(promises.map((r) => [r.weekStart, String(r.kept), String(r.broken)]));
  else expect(report.sections.promises).toBeUndefined();
  // Follow-up — first 20 of the stuck list (oldest activity first; never-contacted contracts tie at the epoch).
  const followUp = report.sections.followUp?.rows ?? [];
  if (stuck.length) {
    expect(report.sections.followUp?.head).toEqual(['Contract #', 'Days stuck', 'Customer', 'Status']);
    expectTopWithTies(followUp.map((r) => r.cells[0]), stuck.map((r) => ({ key: r.contractNumber, tie: String(r.lastActivity) })), 20);
    for (const row of followUp) {
      const source = stuck.find((r) => r.contractNumber === row.cells[0])!;
      expect(Math.abs(Number(row.cells[1]) - source.daysIdle)).toBeLessThanOrEqual(1);
      expect(foldThai(row.cells[2])).toBe(foldThai(source.customerName));
      expect(row.cells[3]).toBe(source.status);
    }
  } else expect(report.sections.followUp).toBeUndefined();
  return { aging, collectors, recovery, stuck, letters, promises, dunning, collection, range, since };
}

/** Document-level baseline shared by both specs: A4, THSarabunPSK only, 16 pt body, 18 pt title, 12 pt footer on every page. */
export function expectReportBaseline(pdf: ParsedPdf, report: ParsedReport): void {
  expect(pdf.pages.every((page) => Math.abs(page.widthPt - 595.28) <= 1 && Math.abs(page.heightPt - 841.89) <= 1)).toBe(true);
  expect(pdf.fonts.length).toBeGreaterThan(0);
  expect(pdf.fonts.every((font) => font.startsWith(DOCUMENT_STYLE.pdfFontFamily))).toBe(true);
  for (const page of pdf.pages) {
    expect(page.items.filter((i) => i.str.startsWith('BESTCHOICE Collections Report')).map((i) => Math.round(i.size * 10) / 10)).toEqual([DOCUMENT_STYLE.headingPt]);
    expect(page.items.filter((i) => i.str.startsWith('Generated:')).map((i) => Math.round(i.size * 10) / 10)).toEqual([DOCUMENT_STYLE.footerPt]);
  }
  for (const page of report.pages) {
    expect({ page: page.index, title: page.title, period: page.period, label: page.pageLabel }).toEqual({ page: page.index, title: true, period: true, label: `${page.index} / ${pdf.pageCount}` });
  }
}
