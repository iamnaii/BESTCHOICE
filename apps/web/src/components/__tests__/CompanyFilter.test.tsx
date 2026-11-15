import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-1', role: 'OWNER' } }),
}));
vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: [{ id: 'c-1', nameTh: 'บริษัท เบสท์ช้อยส์ ไฟแนนซ์', companyCode: 'FINANCE' }],
    }),
  },
}));

import CompanyFilter from '../CompanyFilter';

describe('CompanyFilter — ความกว้างขั้นต่ำอยู่ที่กล่องห่อของ NativeSelect', () => {
  it('กล่องห่อมี min-w-[150px] (ตัว select ถูกบังคับ w-full min-w-0 จึงตั้งความกว้างที่ตัว select ไม่ได้)', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CompanyFilter value="" onChange={() => {}} />
      </QueryClientProvider>,
    );
    const select = screen.getByLabelText('นิติบุคคล');
    expect(select.closest('[data-slot="native-select-wrapper"]')).toHaveClass('min-w-[150px]');
    // the skin stays the primitive's (Task 9): no caller radius/border/padding on the select
    expect(select).toHaveClass('rounded-lg', 'border-input', 'h-11');
  });
});
