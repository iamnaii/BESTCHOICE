import { setRequestCompany } from './company-scope';
import { describe, expect, it, vi } from 'vitest';
import { fetchExportPages } from './fetch-export-pages';

describe('fetchExportPages', () => {
  it('starts at page 1 and exports all 201 rows in bounded requests', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({ id: String(index) }));
    const fetchPage = vi.fn(async (page: number, limit: number) => ({
      data: rows.slice((page - 1) * limit, page * limit), total: rows.length,
    }));
    expect(await fetchExportPages(fetchPage)).toEqual(rows);
    expect(fetchPage.mock.calls).toEqual([[1, 200], [2, 200]]);
  });
  it.each([
    [{ data: [{ id: '1' }], total: 2 }, { data: [{ id: '2' }], total: 3 }],
    [{ data: [{ id: '1' }], total: 2 }, { data: [{ id: '1' }], total: 2 }],
    [{ data: [{ id: '1' }], total: 2 }, { data: [], total: 2 }],
    [{ data: [{ id: '1' }, { id: '2' }], total: 1 }],
    [{ data: [{ id: '1' }, { id: '1' }], total: 2 }],
    [{ data: [], total: -1 }],
  ])('refuses inconsistent data without returning a partial file', async (...pages) => {
    let index = 0;
    await expect(fetchExportPages(async () => pages[index++])).rejects.toThrow('ข้อมูลเปลี่ยนระหว่างส่งออก');
  });
  it('rejects a company switch during an awaited page even when totals are unchanged', async () => {
    setRequestCompany('SHOP');
    const fetch = vi.fn(async () => {
      setRequestCompany('FINANCE');
      return { data: [{ id: 'other-company' }], total: 1 };
    });
    await expect(fetchExportPages(fetch)).rejects.toThrow('เปลี่ยนบริษัทระหว่างส่งออก');
    expect(fetch).toHaveBeenCalledTimes(1);
    setRequestCompany(undefined);
  });
  it('rejects a switch away and back, not merely a different current company', async () => {
    setRequestCompany('SHOP');
    await expect(fetchExportPages(async () => {
      setRequestCompany('FINANCE'); setRequestCompany('SHOP');
      return { data: [], total: 0 };
    })).rejects.toThrow('เปลี่ยนบริษัทระหว่างส่งออก');
    setRequestCompany(undefined);
  });
  it('propagates request failure and handles empty datasets', async () => {
    await expect(fetchExportPages(async () => { throw new Error('network'); })).rejects.toThrow('network');
    await expect(fetchExportPages(async () => ({ data: [], total: 0 }))).resolves.toEqual([]);
  });
});
