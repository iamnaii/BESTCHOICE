import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const authState = vi.hoisted(() => ({ role: 'OWNER' as string }));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: authState.role } }),
}));

const apiGet = vi.fn();
const apiPatch = vi.fn();
vi.mock('@/lib/api', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    patch: (...args: unknown[]) => apiPatch(...args),
  },
}));

import { GfinSettingsPanel } from '../GfinSettingsPanel';

const settings = {
  minDownPct: 25,
  maxDownPct: 80,
  downStepPct: 5,
  contractFee: 100,
  commissionPctByCategory: { PHONE: 15, TABLET: 5 },
};

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('GfinSettingsPanel', () => {
  beforeEach(() => {
    authState.role = 'OWNER';
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue({ data: settings });
    apiPatch.mockResolvedValue({ data: settings });
  });

  it('โชว์ค่าจาก API และบันทึกทั้ง 4 ค่าเมื่อเจ้าของแก้ดาวน์ขั้นต่ำ', async () => {
    render(
      <Wrapper>
        <GfinSettingsPanel />
      </Wrapper>,
    );

    const minDown = await screen.findByLabelText('ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน (%)');
    expect(minDown).toHaveValue(25);
    expect(screen.getByLabelText('คอมมิชชั่นตั้งต้น มือถือ (%)')).toHaveValue(15);
    expect(screen.getByLabelText('คอมมิชชั่นตั้งต้น iPad (%)')).toHaveValue(5);
    expect(screen.getByLabelText('ค่าทำสัญญา (฿)')).toHaveValue(100);

    await userEvent.clear(minDown);
    await userEvent.type(minDown, '30');
    await userEvent.click(screen.getByRole('button', { name: 'บันทึกค่าตั้งต้น' }));

    await waitFor(() =>
      expect(apiPatch).toHaveBeenCalledWith('/gfin-config/settings', {
        minDownPct: 30,
        commissionPhone: 15,
        commissionTablet: 5,
        contractFee: 100,
      }),
    );
  });

  it('role อื่นเห็นค่าแต่ไม่มีปุ่มบันทึก และช่องกรอกอ่านอย่างเดียว', async () => {
    authState.role = 'BRANCH_MANAGER';
    render(
      <Wrapper>
        <GfinSettingsPanel />
      </Wrapper>,
    );

    const minDown = await screen.findByLabelText('ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน (%)');
    expect(minDown).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'บันทึกค่าตั้งต้น' })).toBeNull();
  });
});
