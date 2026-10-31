import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liffApi } from './api';
import { liffDownloadPath, openLiffDownload } from './liff-download';

/**
 * Task 22 M-3 — ลิงก์ดาวน์โหลดของหน้า LIFF ไม่พก id_token ใน URL: แลก id_token (header ของ liffApi) เป็นตั๋วครั้งเดียว
 * แล้วเปิด `…?dl=<ตั๋ว>` ในแท็บที่เปิดไว้ตั้งแต่จังหวะคลิก (ตัวบล็อกป๊อปอัปยอมเฉพาะในจังหวะนั้น)
 */
describe('liff-download', () => {
  let post: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    post = vi.spyOn(liffApi, 'post');
  });
  afterEach(() => vi.restoreAllMocks());

  const fakeWindow = (
    tab: { location: { href: string }; closed: boolean; opener: unknown; close: () => void } | null,
  ) => {
    const assign = vi.fn();
    const win = { open: vi.fn(() => tab), location: { assign } } as unknown as Window;
    return { win, assign };
  };
  const newTab = () => ({
    location: { href: '' },
    closed: false,
    opener: {} as unknown,
    close: vi.fn(),
  });

  it('href ของลิงก์ไม่มีข้อมูลยืนยันตัวตน', () => {
    expect(liffDownloadPath('receipt', 'r1')).toBe('/api/line-oa/liff/receipts/r1/download');
    expect(liffDownloadPath('contract-document', 'k1')).toBe(
      '/api/line-oa/liff/contracts/k1/document',
    );
  });

  it('ขอตั๋วด้วย liffApi (header) แล้วเปิด ?dl=<ตั๋ว> ในแท็บใหม่ — ไม่มี idToken ใน URL', async () => {
    post.mockResolvedValue({ data: { ticket: 'T/k+n=' } });
    const tab = newTab();
    const { win } = fakeWindow(tab);
    await openLiffDownload('receipt', 'r1', win);
    expect(win.open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    expect(post).toHaveBeenCalledWith('/line-oa/liff/download-ticket', {
      kind: 'receipt',
      resourceId: 'r1',
    });
    expect(tab.location.href).toBe('/api/line-oa/liff/receipts/r1/download?dl=T%2Fk%2Bn%3D');
    expect(tab.location.href).not.toMatch(/idToken|id_token/);
  });

  it('เปิดแท็บใหม่ไม่ได้ (ถูกบล็อก/แอป LINE) → เปิดในหน้าเดิม', async () => {
    post.mockResolvedValue({ data: { ticket: 'T1' } });
    const { win, assign } = fakeWindow(null);
    await openLiffDownload('contract-document', 'k1', win);
    expect(assign).toHaveBeenCalledWith('/api/line-oa/liff/contracts/k1/document?dl=T1');
  });

  it('ขอตั๋วไม่สำเร็จ (เช่น 404 ไม่พบใบเสร็จ) → ปิดแท็บเปล่าที่เปิดไว้แล้วโยน error ให้หน้าแสดง', async () => {
    const failure = { response: { status: 404, data: { message: 'ไม่พบใบเสร็จ' } } };
    post.mockRejectedValue(failure);
    const tab = newTab();
    const { win, assign } = fakeWindow(tab);
    await expect(openLiffDownload('receipt', 'r9', win)).rejects.toBe(failure);
    expect(tab.close).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});
