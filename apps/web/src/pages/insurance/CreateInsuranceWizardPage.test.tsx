import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CreateInsuranceWizardPage from './CreateInsuranceWizardPage';

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockRole = 'SALES';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u-1', role: mockRole, branchId: 'b-1' },
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/lib/api', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: { id: 'new-cust-1' } }),
  },
  getErrorMessage: (e: unknown) => String(e),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Stub out the heavy step components so we can test wizard routing without
// the full step internals (which have their own useQuery calls).
vi.mock('./WizardSteps/CustomerPickerStep', () => ({
  CustomerPickerStep: ({ onNext }: { onNext: () => void }) => (
    <div data-testid="step-customer">
      <span>Step 1 — ลูกค้า</span>
      <button onClick={onNext}>ต่อไป</button>
    </div>
  ),
}));

vi.mock('./WizardSteps/DevicePickerStep', () => ({
  DevicePickerStep: ({ onNext, onBack }: { onNext: () => void; onBack: () => void }) => (
    <div data-testid="step-device">
      <span>Step 2 — เครื่อง</span>
      <button onClick={onBack}>ย้อนกลับ</button>
      <button onClick={onNext}>ต่อไป</button>
    </div>
  ),
}));

vi.mock('./WizardSteps/WarrantyPreviewStep', () => ({
  WarrantyPreviewStep: ({ onNext, onBack }: { onNext: () => void; onBack: () => void }) => (
    <div data-testid="step-warranty">
      <span>Step 3 — ตรวจประกัน</span>
      <button onClick={onBack}>ย้อนกลับ</button>
      <button onClick={onNext}>ต่อไป</button>
    </div>
  ),
}));

vi.mock('./WizardSteps/DefectDescriptionStep', () => ({
  DefectDescriptionStep: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="step-defect">
      <span>Step 4 — อาการเสีย (repair)</span>
      <button onClick={onBack}>ย้อนกลับ</button>
    </div>
  ),
}));

vi.mock('./WizardSteps/ExchangeProductPickerStep', () => ({
  ExchangeProductPickerStep: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="step-exchange">
      <span>Step 4 — เลือกเครื่องแลก (exchange)</span>
      <button onClick={onBack}>ย้อนกลับ</button>
    </div>
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderWith(search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/insurance/new${search}`]}>
        <Routes>
          <Route path="/insurance/new" element={<CreateInsuranceWizardPage />} />
          <Route path="/insurance" element={<div>Insurance List</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockRole = 'SALES';
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('CreateInsuranceWizardPage', () => {
  it('renders page heading "รับเครื่องใหม่" on initial load', () => {
    renderWith();
    expect(screen.getByText('รับเครื่องใหม่')).toBeInTheDocument();
  });

  it('shows Step 1 (Customer) by default when no search params', () => {
    renderWith();
    expect(screen.getByTestId('step-customer')).toBeInTheDocument();
    expect(screen.queryByTestId('step-device')).not.toBeInTheDocument();
  });

  it('shows "เริ่มใหม่" reset button', () => {
    renderWith();
    expect(screen.getByRole('button', { name: 'เริ่มใหม่' })).toBeInTheDocument();
  });

  it('progress indicator shows 4 steps by default (ลูกค้า / เครื่อง / ตรวจประกัน / ยืนยัน)', () => {
    renderWith();
    expect(screen.getByText('1. ลูกค้า')).toBeInTheDocument();
    expect(screen.getByText('2. เครื่อง')).toBeInTheDocument();
    expect(screen.getByText('3. ตรวจประกัน')).toBeInTheDocument();
    expect(screen.getByText(/ยืนยัน/)).toBeInTheDocument();
  });

  it('skips Step 1 and shows Step 2 when ?customerId is provided', () => {
    renderWith('?customerId=cust-123');
    expect(screen.getByTestId('step-device')).toBeInTheDocument();
    expect(screen.queryByTestId('step-customer')).not.toBeInTheDocument();
  });

  it('bypass ignored for SALES role — normal flow starts at Step 1', () => {
    mockRole = 'SALES';
    renderWith('?bypassWindow=true&intent=exchange&originRepairTicketId=rt-1');
    // No customerId → still Step 1
    expect(screen.getByTestId('step-customer')).toBeInTheDocument();
    // Full 4-step progress including warranty step
    expect(screen.getByText('3. ตรวจประกัน')).toBeInTheDocument();
  });

  it('OWNER with bypassWindow+intent=exchange+presetContract starts at Step 4 (exchange), skips warranty', async () => {
    mockRole = 'OWNER';
    renderWith(
      '?bypassWindow=true&intent=exchange&customerId=cust-1&contractId=contract-1&originRepairTicketId=rt-1',
    );
    // Should skip to step 4 — exchange branch visible
    await waitFor(() => {
      expect(screen.getByTestId('step-exchange')).toBeInTheDocument();
    });
    // Warranty step should NOT appear in progress indicator
    expect(screen.queryByText('3. ตรวจประกัน')).not.toBeInTheDocument();
  });

  it('BRANCH_MANAGER with bypassWindow+intent=exchange behaves same as OWNER', async () => {
    mockRole = 'BRANCH_MANAGER';
    renderWith(
      '?bypassWindow=true&intent=exchange&customerId=cust-1&contractId=contract-1',
    );
    await waitFor(() => {
      expect(screen.getByTestId('step-exchange')).toBeInTheDocument();
    });
  });
});
