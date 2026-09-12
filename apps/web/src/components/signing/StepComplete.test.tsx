import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import api from '@/lib/api';
import StepComplete from './StepComplete';
import { toast } from 'sonner';

vi.mock('@/lib/api', () => ({ default: { post: vi.fn() }, getErrorMessage: () => 'ระบบขัดข้อง' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => vi.clearAllMocks());
function show() {
  return render(<StrictMode><QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <MemoryRouter><StepComplete contractId="c1" contractNumber="TEST-1" /></MemoryRouter>
  </QueryClientProvider></StrictMode>);
}
it('keeps a partial HTML response recoverable instead of reporting PDF success', async () => {
  vi.mocked(api.post).mockResolvedValueOnce({ data: { contract: { pdfGenerated: false }, errors: ['PDPA failed'] } });
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF ยังไม่ครบ');
  expect(screen.queryByText('สร้างเอกสาร PDF เรียบร้อย')).not.toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
  vi.mocked(api.post).mockResolvedValueOnce({ data: { contract: { pdfGenerated: true }, pdpa: { pdfGenerated: true } } });
  await userEvent.click(screen.getByRole('button', { name: 'ลองใหม่' }));
  expect(await screen.findByText('สร้างเอกสาร PDF เรียบร้อย')).toBeInTheDocument();
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
});

it('does not announce success when both PDFs exist but attachment finalization failed', async () => {
  vi.mocked(api.post).mockResolvedValueOnce({ data: { contract: { pdfGenerated: true }, pdpa: { pdfGenerated: true }, errors: ['ข้อมูลหรือลายเซ็นเปลี่ยน'] } });
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('PDF ยังไม่ครบ');
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});
