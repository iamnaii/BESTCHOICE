import { getCompanyScopeRevision } from './company-scope';

/** Expected, user-actionable export failures; do not render arbitrary transport errors. */
export class ExportError extends Error {}

export function createExportGuard(): () => void {
  const revision = getCompanyScopeRevision();
  return () => {
    if (revision !== getCompanyScopeRevision()) throw new ExportError('เปลี่ยนบริษัทระหว่างส่งออก กรุณาส่งออกใหม่จากบริษัทที่ต้องการ');
  };
}

export interface ExportSnapshot<T> { data: T[]; total: number; asOf: string }

export async function fetchExportSnapshot<T extends { id: string }>(
  request: () => Promise<ExportSnapshot<T>>,
  assertCurrent: () => void = createExportGuard(),
): Promise<ExportSnapshot<T>> {
  assertCurrent();
  const result = await request();
  assertCurrent();
  if (!Number.isSafeInteger(result.total) || result.total < 0 || result.total > 10_000 ||
    !Array.isArray(result.data) || result.data.length !== result.total ||
    !result.asOf || !Number.isFinite(Date.parse(result.asOf)) ||
    new Set(result.data.map(row => row.id)).size !== result.total || result.data.some(row => !row.id)) {
    throw new ExportError('ข้อมูลส่งออกไม่ครบหรือไม่ถูกต้อง กรุณาลองใหม่');
  }
  return result;
}
