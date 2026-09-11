import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import api from './api';
import { downloadGeneratedDocument } from './document-download';
import { setRequestCompany } from './company-scope';
vi.mock('./api', () => ({ default: { get: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); setRequestCompany('SHOP'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('uses authenticated binary transport and downloads only after it succeeds', async () => {
  const create = vi.fn(() => 'blob:test');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const blob = new Blob(['pdf'], { type: 'application/pdf' });
  vi.mocked(api.get).mockResolvedValue({ data: blob });
  await downloadGeneratedDocument('d1', 'สัญญา.pdf');
  expect(api.get).toHaveBeenCalledWith('/documents/d1/download', { responseType: 'blob', timeout: 120000 });
  expect(create).toHaveBeenCalledWith(blob);
  expect(click).toHaveBeenCalledOnce();
});
it('rejects a company switch away and back before any file is saved', async () => {
  vi.mocked(api.get).mockImplementation(async () => { setRequestCompany('FINANCE'); setRequestCompany('SHOP'); return { data: new Blob() }; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await expect(downloadGeneratedDocument('d1', 'สัญญา.pdf')).rejects.toThrow('เปลี่ยนบริษัท');
  expect(click).not.toHaveBeenCalled();
});
