import { Prisma } from '@prisma/client';

/** PostgreSQL SQLSTATEs a Serializable writer must retry: serialization failure, deadlock. */
const RETRYABLE_SQLSTATES = ['40001', '40P01'];
const SQLSTATE_IN_MESSAGE = /\bcode:\s*"(40001|40P01)"|\b(deadlock detected|could not serialize access)\b/;

/** Retry the entire transaction, including all eligibility reads and credit claims. */
export function isRetryablePrismaWriteError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' || error.code === 'P2034') return true;
    // Advisory/row locks use raw SQL, whose PostgreSQL serialization/deadlock
    // errors are wrapped as P2010 instead of Prisma's ordinary P2034.
    if (error.code === 'P2010' && RETRYABLE_SQLSTATES.includes(String(error.meta?.code))) return true;
    return SQLSTATE_IN_MESSAGE.test(error.message);
  }
  // A deadlock the engine could not map ("Error occurred during query execution:
  // ConnectorError(... PostgresError { code: "40P01" ... })") arrives as an
  // UnknownRequestError with no code — the loser of a concurrent claim then escaped
  // both retry loops as a raw error instead of a 409 (credit-payment-flow race).
  if (error instanceof Prisma.PrismaClientUnknownRequestError) return SQLSTATE_IN_MESSAGE.test(error.message);
  return false;
}

/**
 * ลองทั้งทรานแซกชันใหม่เมื่อ Postgres ตัดสิน deadlock/serialization (`isRetryablePrismaWriteError`) — สูงสุด `maxAttempts` ครั้ง
 * (Task 29 fix round 1 — ตัวเดียวของปุ่มยกเลิกผูก LINE การเงิน, `VerificationService.bind` และผลวิเคราะห์สเตทเม้นจากแชท) ·
 * `run` ต้องเปิดทรานแซกชันใหม่และอ่านทุกอย่างใหม่ทุกรอบ (ห้ามพกผลอ่านจากรอบก่อน) · ห้ามใช้เมื่ออยู่ในทรานแซกชันของผู้อื่น
 * (managed/join — ให้ชั้นนอกลองทั้งก้อน) · `isRetryable` เพิ่มเงื่อนไขของผู้เรียกได้ · ครบรอบแล้ว = ส่ง error ล่าสุดต่อ
 */
export async function runWithTransactionRetry<T>(
  run: () => Promise<T>,
  maxAttempts: number,
  isRetryable: (error: unknown) => boolean = isRetryablePrismaWriteError,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
    }
  }
}
