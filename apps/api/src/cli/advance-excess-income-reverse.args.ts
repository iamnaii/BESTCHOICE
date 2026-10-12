/**
 * อาร์กิวเมนต์ของ CLI `advance-excess:reverse` (PR4 final review I2) — แยกเป็นฟังก์ชันบริสุทธิ์ให้ทดสอบได้
 * โดยไม่รันตัว CLI. รูปแบบที่รับ: `--contract <เลขสัญญา|id>` และ `--reason "<ข้อความ>"` (ทั้ง `--k v` และ `--k=v`).
 */
export const REVERSE_REASON_MIN = 10;

export interface ReverseArgs {
  contract: string;
  reason: string;
}

const USAGE =
  'วิธีใช้: EXPECTED_DB_NAME=<ชื่อฐานข้อมูล> [CONFIRM_REVERSE=YES_I_AM_SURE] npm --prefix apps/api run advance-excess:reverse -- ' +
  '--contract <เลขสัญญา|contractId> --reason "<เหตุผล ≥ ' +
  REVERSE_REASON_MIN +
  ' ตัวอักษร>"';

export function parseReverseArgs(argv: string[]): ReverseArgs {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) {
      values[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        values[a.slice(2)] = next;
        i += 1;
      } else {
        values[a.slice(2)] = '';
      }
    }
  }
  const contract = (values.contract ?? '').trim();
  const reason = (values.reason ?? '').trim();
  if (!contract) throw new Error(`ต้องระบุ --contract <เลขสัญญา|contractId>\n${USAGE}`);
  if (!reason) throw new Error(`ต้องระบุ --reason "<เหตุผล>"\n${USAGE}`);
  if (reason.length < REVERSE_REASON_MIN) {
    throw new Error(
      `เหตุผลต้องยาวอย่างน้อย ${REVERSE_REASON_MIN} ตัวอักษร (ได้ ${reason.length})\n${USAGE}`,
    );
  }
  return { contract, reason };
}
