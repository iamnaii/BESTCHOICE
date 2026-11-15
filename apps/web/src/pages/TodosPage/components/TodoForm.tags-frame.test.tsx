import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (e: unknown) => String(e),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { TodoForm } from './TodoForm';

describe('TodoForm — S2-05 ช่องแท็กสูงเท่าช่องอื่น (44px)', () => {
  it('กรอบแท็กเป็น data-field-frame min-h-11 py-1 และช่องพิมพ์ข้างในเป็น data-field-embedded', () => {
    apiGet.mockResolvedValue({ data: [] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TodoForm open onOpenChange={() => {}} editing={null} staffUsers={[]} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const input = screen.getByLabelText('แท็ก');
    expect(input).toHaveAttribute('data-field-embedded');
    const frame = input.closest('[data-field-frame]');
    expect(frame).not.toBeNull();
    expect(frame).toHaveClass('min-h-11', 'py-1');
    expect(frame).not.toHaveClass('py-2');
  });
});
