import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import TestModeBanner from '../TestModeBanner';
import { testModeApi } from '@/lib/api/test-mode';

vi.mock('@/lib/api/test-mode', async (orig) => {
  const a = await orig<typeof import('@/lib/api/test-mode')>();
  return { ...a, testModeApi: { ...a.testModeApi, get: vi.fn() } };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

it('shows banner when enabled', async () => {
  (testModeApi.get as any).mockResolvedValue({ enabled: true });
  wrap(<TestModeBanner />);
  await waitFor(() => expect(screen.getByText(/โหมดทดสอบ/)).toBeInTheDocument());
});

it('renders nothing when disabled', async () => {
  (testModeApi.get as any).mockResolvedValue({ enabled: false });
  const { container } = wrap(<TestModeBanner />);
  await waitFor(() => expect(testModeApi.get).toHaveBeenCalled());
  expect(container.querySelector('[data-testid="test-mode-banner"]')).toBeNull();
});
