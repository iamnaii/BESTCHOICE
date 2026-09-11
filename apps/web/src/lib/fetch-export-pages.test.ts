import { setRequestCompany } from './company-scope';
import { describe, expect, it, vi } from 'vitest';
import { fetchExportSnapshot } from './fetch-export-pages';
const asOf = '2026-09-11T00:00:00.000Z';

describe('server export snapshots', () => {
  it('requests all 10,000 rows once and preserves the server timestamp', async () => {
    const result = { data: Array.from({ length: 10_000 }, (_, id) => ({ id: String(id) })), total: 10_000, asOf };
    const request = vi.fn(async () => result);
    expect(await fetchExportSnapshot(request)).toEqual(result);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each([
    { data: [], total: 1, asOf }, { data: [{ id: '1' }, { id: '1' }], total: 2, asOf },
    { data: [], total: 0, asOf: '' }, { data: [], total: -1, asOf },
    { data: [], total: 10_001, asOf }, { data: [{ id: '' }], total: 1, asOf },
  ])('rejects malformed or partial snapshots', async result => {
    await expect(fetchExportSnapshot(async () => result)).rejects.toThrow('ข้อมูลส่งออกไม่ครบ');
  });
  it.each([false, true])('rejects a company switch even after returning to SHOP: %s', async returnToShop => {
    setRequestCompany('SHOP');
    await expect(fetchExportSnapshot(async () => {
      setRequestCompany('FINANCE'); if (returnToShop) setRequestCompany('SHOP');
      return { data: [], total: 0, asOf };
    })).rejects.toThrow('เปลี่ยนบริษัทระหว่างส่งออก');
    setRequestCompany(undefined);
  });
  it('propagates failures and supports empty reports', async () => {
    await expect(fetchExportSnapshot(async () => { throw new Error('network'); })).rejects.toThrow('network');
    await expect(fetchExportSnapshot(async () => ({ data: [], total: 0, asOf }))).resolves.toEqual({ data: [], total: 0, asOf });
  });
});
