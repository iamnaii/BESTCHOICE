import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import api from './api';
import { downloadGeneratedDocument, getProtectedDocument, getDocumentErrorMessage } from './document-download';
import { setRequestCompany } from './company-scope';
vi.mock('./api', async (original) => ({ ...await original<typeof import('./api')>(), default: { get: vi.fn() } }));
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

it('decodes a binary JSON error into the Thai server message', async () => {
  vi.mocked(api.get).mockRejectedValue({ response: { status: 403, data: jsonBlob(JSON.stringify({ message: 'ไม่มีสิทธิ์เปิดเอกสารสาขานี้' })) } });
  try { await getProtectedDocument('/test.pdf'); throw new Error('Expected failure'); }
  catch (error) { expect(getDocumentErrorMessage(error)).toBe('ไม่มีสิทธิ์เปิดเอกสารสาขานี้'); }
});
it('uses the status fallback for invalid JSON without exposing an HTML error body', async () => {
  vi.mocked(api.get).mockRejectedValue({ response: { status: 429, data: jsonBlob('<html>internal</html>') } });
  try { await getProtectedDocument('/test.pdf'); throw new Error('Expected failure'); }
  catch (error) { expect(getDocumentErrorMessage(error)).toContain('คำขอถี่เกินไป'); }
});

function jsonBlob(text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  Object.defineProperty(blob, 'text', { value: async () => text });
  return blob;
}
