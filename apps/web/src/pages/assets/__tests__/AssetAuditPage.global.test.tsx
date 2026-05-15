import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import AssetAuditPage from '../AssetAuditPage';

vi.mock('../api', () => ({
  assetsApi: {
    getAudit: vi.fn().mockResolvedValue([]),
    getGlobalAudit: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }),
  },
}));

const renderAt = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/assets/audit" element={<AssetAuditPage />} />
          <Route path="/assets/:id/audit" element={<AssetAuditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('AssetAuditPage — global vs per-asset mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('global mode: calls getGlobalAudit when route has no :id', async () => {
    const { assetsApi } = await import('../api');
    renderAt('/assets/audit');
    await waitFor(() => expect(assetsApi.getGlobalAudit).toHaveBeenCalled());
    expect(assetsApi.getAudit).not.toHaveBeenCalled();
  });

  it('per-asset mode: calls getAudit when route has :id', async () => {
    const { assetsApi } = await import('../api');
    renderAt('/assets/asset-123/audit');
    await waitFor(() => expect(assetsApi.getAudit).toHaveBeenCalledWith('asset-123'));
    expect(assetsApi.getGlobalAudit).not.toHaveBeenCalled();
  });

  it('global mode: header text shows "ทั้งหมด"', async () => {
    renderAt('/assets/audit');
    await waitFor(() => expect(screen.getByText(/Audit Log.*สินทรัพย์.*ทั้งหมด/)).toBeInTheDocument());
  });
});
