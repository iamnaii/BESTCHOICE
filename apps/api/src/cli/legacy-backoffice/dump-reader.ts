import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * อ่าน dump MariaDB 11 (mysqldump) ของระบบหลังบ้านเดิม แบบ stream ทีละบรรทัด — ไฟล์จริง ~16 MB ห้ามอ่านทั้งก้อน
 *
 * รูปแบบที่รองรับ (ตรวจกับไฟล์จริงแล้ว):
 * - ชื่อคอลัมน์มาจากบล็อก `CREATE TABLE \`t\` (` — บรรทัดละ `` `col` `` จบที่บรรทัดที่ขึ้นต้นด้วย `)`
 *   (ชื่อคอลัมน์เก็บตามจริงทุกตัวอักษร รวมคำที่สะกดผิด เช่น `ref_installmemnt`)
 * - `INSERT INTO \`t\` VALUES` แล้วแถวละบรรทัด และ INSERT บรรทัดเดียวหลายแถว · ตารางหนึ่งมีหลายคำสั่งได้
 * - ข้อความในเครื่องหมาย `'` พร้อม backslash escape · `NULL` ไม่มีเครื่องหมายคำพูด = null · ตัวเลขเก็บเป็นข้อความ
 *
 * อะไรที่ไม่ตรงรูปแบบ (ไฟล์ขาด, จำนวนค่าไม่เท่าคอลัมน์, INSERT แบบอื่น) = throw ทั้งไฟล์ — ไม่คืนข้อมูลครึ่ง ๆ
 * ข้อความ error บอกแค่ชื่อตาราง + เลขบรรทัด ไม่มีค่าในแถว (dump มีข้อมูลส่วนบุคคลของลูกค้า)
 */

/** หนึ่งแถว: ชื่อคอลัมน์ → ค่าตามที่ dump เขียน (`NULL` ที่ไม่มีเครื่องหมายคำพูด = null) */
export type DumpRow = Record<string, string | null>;
/** แถวของตารางที่ขอ แยกตามชื่อตาราง — ตารางที่มีแต่ไม่มีแถว = [] */
export type DumpTables = Record<string, DumpRow[]>;

const CREATE_TABLE = /^CREATE TABLE `([^`]+)` \($/;
const COLUMN_LINE = /^\s+`([^`]+)`\s/;
const INSERT_STATEMENT = /^(INSERT|REPLACE)\b/;
const INSERT_VALUES = /^INSERT INTO `([^`]+)` VALUES/;

/** escape ของ string literal MySQL — `\x` ตัวอื่นอ่านเป็น `x` (ครอบ `\\` `\'` `\"`) */
const ESCAPES = new Map([
  ['0', '\0'],
  ['b', '\b'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
  ['Z', '\x1a'],
]);

const WHITESPACE = new Set([' ', '\n', '\r', '\t']);

function dumpError(table: string, lineNo: number, what: string): Error {
  return new Error(`อ่าน dump ไม่ได้: ตาราง \`${table}\` บรรทัด ${lineNo} — ${what}`);
}

type ParseState =
  | 'beforeTuple'
  | 'beforeValue'
  | 'quoted'
  | 'escape'
  | 'bare'
  | 'afterValue'
  | 'afterTuple';

/**
 * แยกค่าของคำสั่ง INSERT หนึ่งคำสั่ง — สถานะ (รวม "อยู่ในเครื่องหมายคำพูด") ข้ามบรรทัดได้
 * คำสั่งจบที่ `;` ที่อยู่นอกเครื่องหมายคำพูดและนอกวงเล็บ
 */
class InsertParser {
  private state: ParseState = 'beforeTuple';
  private values: (string | null)[] = [];
  private token = '';
  private tupleCount = 0;

  constructor(
    readonly table: string,
    private readonly columns: readonly string[],
    /** null = ตารางที่ไม่ได้ขอ — แยกค่าเพื่อหาจุดจบของคำสั่งเท่านั้น ไม่เก็บแถว */
    private readonly rows: DumpRow[] | null,
  ) {}

  /** อ่าน `text` ต่อจากที่ค้างไว้ — คืนตำแหน่งถัดจาก `;` ที่ปิดคำสั่ง หรือ -1 ถ้าคำสั่งยังไม่จบ */
  feed(text: string, lineNo: number): number {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      switch (this.state) {
        case 'quoted':
          if (ch === '\\') this.state = 'escape';
          else if (ch === "'") this.endValue(this.token, 'afterValue');
          else this.token += ch;
          break;
        case 'escape':
          this.token += ESCAPES.get(ch) ?? ch;
          this.state = 'quoted';
          break;
        case 'bare':
          if (ch === ',' || ch === ')') {
            this.endBareValue(lineNo);
            this.afterValue(ch, lineNo);
          } else if (ch === "'" || ch === '(') {
            throw dumpError(this.table, lineNo, 'ค่าที่ไม่มีเครื่องหมายคำพูดมีรูปแบบที่ไม่รองรับ');
          } else this.token += ch;
          break;
        case 'beforeValue':
          if (WHITESPACE.has(ch)) break;
          if (ch === ',' || ch === ')') throw dumpError(this.table, lineNo, 'พบค่าว่างในแถว');
          this.token = ch === "'" ? '' : ch;
          this.state = ch === "'" ? 'quoted' : 'bare';
          break;
        case 'afterValue':
          if (!WHITESPACE.has(ch)) this.afterValue(ch, lineNo);
          break;
        case 'beforeTuple':
          if (WHITESPACE.has(ch)) break;
          if (ch !== '(') throw dumpError(this.table, lineNo, 'คาดว่าจะเจอ ( เปิดแถว');
          this.values = [];
          this.state = 'beforeValue';
          break;
        case 'afterTuple':
          if (WHITESPACE.has(ch)) break;
          if (ch === ';') return i + 1;
          if (ch !== ',') throw dumpError(this.table, lineNo, 'คาดว่าจะเจอ , หรือ ; หลังปิดแถว');
          this.state = 'beforeTuple';
          break;
      }
    }
    return -1;
  }

  private endValue(value: string | null, next: ParseState): void {
    this.values.push(value);
    this.state = next;
  }

  private endBareValue(lineNo: number): void {
    const raw = this.token.trim();
    if (raw === '') throw dumpError(this.table, lineNo, 'พบค่าว่างในแถว');
    this.endValue(raw === 'NULL' ? null : raw, 'afterValue');
  }

  private afterValue(ch: string, lineNo: number): void {
    if (ch === ',') this.state = 'beforeValue';
    else if (ch === ')') this.endTuple(lineNo);
    else throw dumpError(this.table, lineNo, 'คาดว่าจะเจอ , หรือ ) หลังค่า');
  }

  private endTuple(lineNo: number): void {
    this.tupleCount += 1;
    if (this.values.length !== this.columns.length) {
      throw dumpError(
        this.table,
        lineNo,
        `แถวที่ ${this.tupleCount} ของคำสั่งนี้มี ${this.values.length} ค่า แต่ CREATE TABLE มี ${this.columns.length} คอลัมน์`,
      );
    }
    if (this.rows) {
      const row: DumpRow = {};
      this.columns.forEach((column, index) => {
        row[column] = this.values[index];
      });
      this.rows.push(row);
    }
    this.state = 'afterTuple';
  }
}

/** อ่านแถวของตาราง `tables` จาก dump — ตารางที่ขอแต่ไม่มี `CREATE TABLE` ใน dump = throw */
export async function readDumpTables(
  sqlPath: string,
  tables: readonly string[],
): Promise<DumpTables> {
  const wanted = new Set(tables);
  const rowsByTable = new Map<string, DumpRow[]>();
  const columnsByTable = new Map<string, string[]>();
  let creating: { table: string; columns: string[] } | null = null;
  let insert: InsertParser | null = null;
  let lineNo = 0;

  /** ป้อนข้อความให้คำสั่ง INSERT — คืน parser เดิมถ้าคำสั่งยังไม่จบ, null ถ้าจบแล้ว */
  const consume = (parser: InsertParser, text: string): InsertParser | null => {
    const end = parser.feed(text, lineNo);
    if (end < 0) return parser;
    if (text.slice(end).trim() !== '') {
      throw dumpError(parser.table, lineNo, 'มีข้อความต่อท้ายคำสั่ง INSERT');
    }
    return null;
  };

  const input = createReadStream(sqlPath, { encoding: 'utf8' });
  try {
    for await (const line of createInterface({ input, crlfDelay: Infinity })) {
      lineNo += 1;

      if (insert) {
        insert = consume(insert, '\n' + line); // ขึ้นบรรทัดใหม่ในเครื่องหมายคำพูด = ส่วนหนึ่งของค่า
        continue;
      }

      if (creating) {
        if (line.startsWith(')')) {
          columnsByTable.set(creating.table, creating.columns);
          if (wanted.has(creating.table) && !rowsByTable.has(creating.table)) {
            rowsByTable.set(creating.table, []);
          }
          creating = null;
        } else {
          const column = COLUMN_LINE.exec(line);
          if (column) creating.columns.push(column[1]);
        }
        continue;
      }

      const create = CREATE_TABLE.exec(line);
      if (create) {
        creating = { table: create[1], columns: [] };
        continue;
      }

      if (INSERT_STATEMENT.test(line)) {
        const head = INSERT_VALUES.exec(line);
        if (!head) {
          throw new Error(`อ่าน dump ไม่ได้: บรรทัด ${lineNo} — รูปแบบ INSERT ที่ไม่รองรับ`);
        }
        const table = head[1];
        const columns = columnsByTable.get(table);
        if (!columns) throw dumpError(table, lineNo, 'INSERT ก่อน CREATE TABLE');
        const rows = rowsByTable.get(table) ?? null; // มีเฉพาะตารางที่ขอ
        insert = consume(new InsertParser(table, columns, rows), line.slice(head[0].length));
      }
    }
  } finally {
    input.destroy(); // throw กลางไฟล์ต้องไม่ทิ้ง file descriptor ค้าง
  }

  if (insert) throw dumpError(insert.table, lineNo, 'ไฟล์จบกลางคำสั่ง INSERT (ไฟล์ไม่ครบ?)');
  if (creating) throw dumpError(creating.table, lineNo, 'ไฟล์จบกลาง CREATE TABLE (ไฟล์ไม่ครบ?)');

  const missing = tables.filter((table) => !rowsByTable.has(table));
  if (missing.length > 0) {
    throw new Error(
      `ไม่พบตารางใน dump ${sqlPath}: ${missing.map((table) => `\`${table}\``).join(', ')}`,
    );
  }

  const result: DumpTables = {};
  for (const table of tables) result[table] = rowsByTable.get(table) ?? [];
  return result;
}
