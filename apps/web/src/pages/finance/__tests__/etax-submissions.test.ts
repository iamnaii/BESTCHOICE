import { describe, expect, it, vi } from 'vitest';
import { fetchAllETaxSubmissions } from '../etax-submissions';

describe('fetchAllETaxSubmissions', () => {
  it('never asks for more than the API maximum per page and walks every page', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ id: `s-${i + 1}` }));
    const getPage = vi.fn(async (url: string) => {
      const params = new URL(url, 'http://x').searchParams;
      const page = Number(params.get('page'));
      const limit = Number(params.get('limit'));
      expect(limit).toBeLessThanOrEqual(200);
      const data = rows.slice((page - 1) * limit, page * limit);
      return { data, total: rows.length, page, limit };
    });
    const result = await fetchAllETaxSubmissions(getPage);
    expect(result.data).toHaveLength(450);
    expect(result.data[449].id).toBe('s-450');
    expect(getPage).toHaveBeenCalledTimes(3);
    expect(getPage.mock.calls.map(([url]) => url)).toEqual(['/e-tax-xml?page=1&limit=200', '/e-tax-xml?page=2&limit=200', '/e-tax-xml?page=3&limit=200']);
  });

  it('stops after a single short page', async () => {
    const getPage = vi.fn(async () => ({ data: [{ id: 'only' }], total: 1, page: 1, limit: 200 }));
    expect((await fetchAllETaxSubmissions(getPage)).data).toEqual([{ id: 'only' }]);
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  it('returns an empty list without looping when there are no submissions', async () => {
    const getPage = vi.fn(async () => ({ data: [], total: 0, page: 1, limit: 200 }));
    expect((await fetchAllETaxSubmissions(getPage)).data).toEqual([]);
    expect(getPage).toHaveBeenCalledTimes(1);
  });
});
