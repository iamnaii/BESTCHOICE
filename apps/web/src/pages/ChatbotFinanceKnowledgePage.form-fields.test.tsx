import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ChatbotFinanceKnowledgePage from './ChatbotFinanceKnowledgePage';

describe('ChatbotFinanceKnowledgePage — S1-05 ทั้งฟอร์มใช้ formControlClass + formLabelClass', () => {
  it('ทุกช่องหน้าตาเดียวกัน ป้ายแบบ A', async () => {
    apiGet.mockResolvedValue({ data: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ChatbotFinanceKnowledgePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /เพิ่ม คำถามที่พบบ่อย/ }));

    const single = [
      'รหัสความต้องการลูกค้า (ภาษาอังกฤษ)',
      'หมวดหมู่',
      'คำค้นที่ใช้จับคู่ (คั่นด้วยจุลภาค)',
      'ช่องทางที่ใช้ คำถามที่พบบ่อย นี้',
      'รูปแบบคำตอบ',
      'ลำดับความสำคัญ',
    ];
    for (const name of single) {
      const control = screen.getByLabelText(name);
      expect(control).toHaveClass('h-11', 'rounded-lg', 'border-input', 'bg-background');
      expect(document.querySelector(`label[for="${control.id}"]`)).toHaveClass('text-sm', 'font-medium', 'text-foreground', 'mb-3');
    }
    for (const name of ['ตัวอย่างคำถาม (บรรทัดละ 1 คำถาม)', 'แม่แบบคำตอบ']) {
      const area = screen.getByLabelText(name);
      expect(area).toHaveClass('min-h-24', 'rounded-lg', 'border-input', 'font-mono');
      expect(document.querySelector(`label[for="${area.id}"]`)).toHaveClass('mb-3');
    }
  });
});
