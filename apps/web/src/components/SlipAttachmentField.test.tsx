import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import { toast } from 'sonner';
import { useSlipAttachment } from '@/hooks/useSlipAttachment';
import { MAX_SLIP_BYTES } from '@/hooks/useSlipUpload';
import { SlipAttachmentField } from './SlipAttachmentField';

vi.mock('@/lib/api', () => ({ default: { post: vi.fn() } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const upload = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', upload);
  vi.mocked(api.post).mockResolvedValue({
    data: { uploadUrl: '/test-upload', method: 'PUT', publicUrl: '/saved-slip' },
  });
  upload.mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

function Harness() {
  const attachment = useSlipAttachment();
  return (
    <>
      <SlipAttachmentField attachment={attachment} />
      <output aria-label="saved URL">{attachment.slipUrl}</output>
      <button
        onClick={() => {
          attachment.setSlipUrl('/draft-slip');
          attachment.setSlipFileName('draft.pdf');
        }}
      >
        Restore draft
      </button>
    </>
  );
}
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  );
  return screen.getByLabelText('อัปโหลดสลิป');
}

it('uploads, disables while pending, clears and permits selecting the same file again', async () => {
  let finish!: (value: { ok: boolean }) => void;
  upload.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const input = mount();
  const file = new File(['slip'], 'slip.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  expect(await screen.findByRole('button', { name: 'กำลังอัปโหลด...' })).toBeDisabled();
  await waitFor(() => expect(upload).toHaveBeenCalled());
  await act(async () => finish({ ok: true }));
  await screen.findByText('slip.png');
  expect(screen.getByLabelText('saved URL')).toHaveTextContent('/saved-slip');
  expect(api.post).toHaveBeenCalledWith('/shop/upload/signed-url', {
    kind: 'BANK_SLIP',
    contentType: 'image/png',
  });
  expect(upload).toHaveBeenCalledWith('/test-upload', {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': 'image/png' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'ลบสลิป' }));
  expect(input).toHaveValue('');
  expect(screen.getByLabelText('saved URL')).toBeEmptyDOMElement();
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText('slip.png');
  expect(upload).toHaveBeenCalledTimes(2);
});

it('shows a restored draft and clears it', () => {
  mount();
  fireEvent.click(screen.getByText('Restore draft'));
  expect(screen.getByText('draft.pdf')).toBeInTheDocument();
  expect(screen.getByLabelText('saved URL')).toHaveTextContent('/draft-slip');
  fireEvent.click(screen.getByRole('button', { name: 'ลบสลิป' }));
  expect(screen.getByLabelText('saved URL')).toBeEmptyDOMElement();
});

it('resets after storage failure and allows retry', async () => {
  upload.mockResolvedValueOnce({ ok: false });
  const input = mount();
  const file = new File(['slip'], 'slip.pdf', { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('อัปโหลดสลิปไม่สำเร็จ'));
  expect(input).toHaveValue('');
  expect(screen.getByLabelText('saved URL')).toBeEmptyDOMElement();
  fireEvent.change(input, { target: { files: [file] } });
  await screen.findByText('slip.pdf');
});

it.each(['type', 'size'])(
  'rejects invalid file %s before requesting an upload URL',
  async (reason) => {
    const input = mount();
    const file = new File(['slip'], 'bad-file', {
      type: reason === 'type' ? 'text/plain' : 'image/png',
    });
    if (reason === 'size') Object.defineProperty(file, 'size', { value: MAX_SLIP_BYTES + 1 });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        reason === 'type' ? 'รองรับ JPG, PNG, WebP, PDF เท่านั้น' : 'ไฟล์ใหญ่เกิน 10MB',
      ),
    );
    expect(api.post).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  },
);
