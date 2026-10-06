import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ChatLibraryPicker from './ChatLibraryPicker';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api', () => ({ default: api, getErrorMessage: () => 'เครือข่ายขัดข้อง' }));
vi.mock('../hooks/useChatWork', () => ({
  useChatWorkSettings: () => ({ company: 'SHOP', key: ['chat-work', 'owner', 'SHOP'] }),
}));
const file = {
  id: 'file',
  name: 'คู่มือ.pdf',
  mimeType: 'application/pdf',
  size: 123,
  company: 'SHOP',
  folderId: null,
  branchId: null,
  createdAt: '2026-10-06T00:00:00Z',
};
const page = (data: unknown[]) => ({ data: { data, total: data.length, page: 1, limit: 12 } });
const mount = (onAdd = vi.fn()) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ChatLibraryPicker open onOpenChange={vi.fn()} onAdd={onAdd} />
    </QueryClientProvider>,
  );
beforeEach(() => {
  api.get
    .mockReset()
    .mockImplementation((url: string) =>
      Promise.resolve(page(url.endsWith('folders') ? [] : [file])),
    );
  api.post.mockReset();
});
it('select and cancel are local only; add passes selected references, without a send request', async () => {
  const add = vi.fn();
  mount(add);
  const tile = await screen.findByRole('checkbox', { name: 'เลือก คู่มือ.pdf' });
  fireEvent.click(tile);
  expect(tile).toHaveAttribute('aria-checked', 'true');
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'เพิ่มไฟล์ที่เลือก' }));
  expect(add).toHaveBeenCalledWith([file]);
  expect(api.post).not.toHaveBeenCalled();
});
it('read failure is visible with retry instead of an empty successful library', async () => {
  api.get.mockImplementation((url: string) =>
    url.endsWith('files') ? Promise.reject(new Error('offline')) : Promise.resolve(page([])),
  );
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('โหลดไฟล์ไม่ได้');
  api.get.mockResolvedValue(page([]));
  fireEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
  expect(await screen.findByText(/ไม่พบไฟล์ ลองเปลี่ยน/)).toBeVisible();
});
it('upload retry keeps the request token after a lost response', async () => {
  api.post
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce({ data: file });
  mount();
  fireEvent.change(screen.getByLabelText('อัปโหลดเข้าคลังไฟล์'), {
    target: { files: [new File(['%PDF-1.4'], 'คู่มือ.pdf', { type: 'application/pdf' })] },
  });
  await screen.findByRole('button', { name: 'ลองอัปโหลดอีกครั้ง' });
  const token = (api.post.mock.calls[0][1] as FormData).get('requestKey');
  fireEvent.click(screen.getByRole('button', { name: 'ลองอัปโหลดอีกครั้ง' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect((api.post.mock.calls[1][1] as FormData).get('requestKey')).toBe(token);
});
