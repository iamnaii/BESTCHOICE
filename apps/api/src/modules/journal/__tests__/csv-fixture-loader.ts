import * as fs from 'fs';
import Decimal from 'decimal.js';

export interface CoaRow {
  code: string;
  name: string;
  type: string; // สินทรัพย์, หนี้สิน, ทุน, รายได้, ค่าใช้จ่าย, สินทรัพย์ (Contra)
  normalBalance: string; // Dr | Cr | Dr/Cr
  category: string;
  vatApplicable: boolean;
  notes: string;
  status: string;
}

export interface JeLine {
  code: string;
  name: string;
  dr: string; // keep as string to preserve precision; convert with Decimal()
  cr: string;
  note: string;
}

export interface JeBlock {
  tag: string; // "1" | "1A" | "2A" | "2B" | "2B1" | "2B2" | "3"
  date: string; // dd/mm/yy raw
  lines: JeLine[];
}

export interface CaseFixture {
  title: string;
  entries: JeBlock[];
}

const ACCOUNT_CODE_RE = /^\d{2}-\d{4}$/;

export function loadCoaFromCsv(csvPath: string): CoaRow[] {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n');
  const rows: CoaRow[] = [];
  for (const line of lines) {
    const cols = parseCsvLine(line);
    if (!cols[0] || !ACCOUNT_CODE_RE.test(cols[0].trim())) continue;
    rows.push({
      code: cols[0].trim(),
      name: (cols[1] ?? '').trim(),
      type: (cols[2] ?? '').trim(),
      normalBalance: (cols[3] ?? '').trim(),
      category: (cols[4] ?? '').trim(),
      vatApplicable: (cols[5] ?? '').trim() === 'ใช่',
      notes: (cols[6] ?? '').trim(),
      status: (cols[7] ?? '').trim(),
    });
  }
  return rows;
}

export function loadCaseFromCsv(csvPath: string): CaseFixture {
  const text = fs.readFileSync(csvPath, 'utf-8');
  const rawLines = text.split('\n');
  const title = parseCsvLine(rawLines[0] ?? '')[0] ?? '';

  const entries: JeBlock[] = [];
  let current: JeBlock | null = null;

  for (const rawLine of rawLines) {
    const cols = parseCsvLine(rawLine);
    const [a, b, c] = cols;

    // Skip header rows and totals rows
    if ((a ?? '').trim() === '#') continue;
    if ((a ?? '').trim().startsWith('รวม')) continue;

    const tag = (a ?? '').trim();
    const date = (b ?? '').trim();
    const code = (c ?? '').trim();

    if (!ACCOUNT_CODE_RE.test(code)) continue;

    // Column layout: 0=tag, 1=date, 2=code, 3=empty, 4=name, 5=empty, 6=Dr, 7=Cr, 8=empty, 9=note
    const name = (cols[4] ?? '').trim();
    const drStr = cols[6];
    const crStr = cols[7];
    const note = (cols[9] ?? '').trim();

    // Open a new block when a non-empty tag appears (and it differs from current)
    if (tag && (!current || current.tag !== tag)) {
      current = { tag, date, lines: [] };
      entries.push(current);
    }

    if (current) {
      current.lines.push({
        code,
        name,
        dr: parseAmount(drStr),
        cr: parseAmount(crStr),
        note,
      });
    }
  }

  return { title, entries };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseAmount(s: string | undefined): string {
  if (!s) return '0.00';
  const cleaned = s.replace(/[",฿\s]/g, '').trim();
  if (!cleaned) return '0.00';
  try {
    return new Decimal(cleaned).toFixed(2);
  } catch {
    return '0.00';
  }
}
