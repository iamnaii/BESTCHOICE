import { getCompanyScopeRevision } from './company-scope';

/** Expected, user-actionable export failures; do not render arbitrary transport errors. */
export class ExportError extends Error {}

export function createExportGuard(): () => void {
  const revision = getCompanyScopeRevision();
  return () => {
    if (revision !== getCompanyScopeRevision()) throw new ExportError('เปลี่ยนบริษัทระหว่างส่งออก กรุณาส่งออกใหม่จากบริษัทที่ต้องการ');
  };
}

export interface ExportPage<T> { data: T[]; total: number }

/** Bounded, filtered export. Requests are not a database snapshot. */
export async function fetchExportPages<T extends { id: string }>(
  fetchPage: (page: number, limit: number) => Promise<ExportPage<T>>,
  assertCurrent: () => void = createExportGuard(),
): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>();
  let expectedTotal: number | undefined;
  for (let page = 1; ; page++) {
    assertCurrent();
    const response = await fetchPage(page, 200);
    assertCurrent();
    expectedTotal ??= response.total;
    const changed = () => new ExportError('ข้อมูลเปลี่ยนระหว่างส่งออก กรุณาลองใหม่');
    if (!Number.isSafeInteger(response.total) || response.total < 0 || response.total !== expectedTotal ||
      response.data.length > 200 || rows.length + response.data.length > expectedTotal) throw changed();
    for (const row of response.data) {
      if (!row.id || seen.has(row.id)) throw changed();
      seen.add(row.id); rows.push(row);
    }
    if (rows.length === expectedTotal) return rows;
    if (response.data.length === 0) throw changed();
  }
}
