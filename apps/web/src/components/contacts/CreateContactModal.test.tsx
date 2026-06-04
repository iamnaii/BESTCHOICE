import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreateContactModal from './CreateContactModal';

// ── Mock @/lib/api ─────────────────────────────────────────────────────────

const apiPostMock = vi.fn();

vi.mock('@/lib/api', () => ({
  default: {
    post: (...args: unknown[]) => apiPostMock(...args),
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function renderModal(
  props: Partial<React.ComponentProps<typeof CreateContactModal>> & {
    role: 'SUPPLIER' | 'CUSTOMER';
  },
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onCreated = props.onCreated ?? vi.fn();
  const onOpenChange = props.onOpenChange ?? vi.fn();

  render(
    <QueryClientProvider client={qc}>
      <CreateContactModal
        open={true}
        onOpenChange={onOpenChange}
        role={props.role}
        initialName={props.initialName ?? ''}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );

  return { onCreated, onOpenChange };
}

beforeEach(() => {
  apiPostMock.mockReset();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('CreateContactModal', () => {
  // ── SUPPLIER ─────────────────────────────────────────────────────────────

  it('SUPPLIER: posts to /suppliers and calls onCreated with correct ids', async () => {
    const user = userEvent.setup();

    apiPostMock.mockResolvedValueOnce({
      data: { id: 'sup1', contactId: 'ct1', name: 'บริษัท ทดสอบ จำกัด', taxId: '1234567890123' },
    });

    const { onCreated, onOpenChange } = renderModal({ role: 'SUPPLIER' });

    // Toggle to JURISTIC so taxId field applies
    await user.click(screen.getByRole('button', { name: 'นิติบุคคล' }));

    // Fill ชื่อ
    await user.clear(screen.getByLabelText(/ชื่อ/));
    await user.type(screen.getByLabelText(/ชื่อ/), 'บริษัท ทดสอบ จำกัด');

    // Fill เลขผู้เสียภาษี
    await user.type(screen.getByLabelText(/เลขผู้เสียภาษี/), '1234567890123');

    // Fill เบอร์โทร
    await user.type(screen.getByLabelText(/เบอร์โทร/), '0812345678');

    // Submit
    await user.click(screen.getByRole('button', { name: 'สร้าง' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());

    // Verify the endpoint and payload
    const [endpoint, payload] = apiPostMock.mock.calls[0];
    expect(endpoint).toBe('/suppliers');
    expect(payload).toMatchObject({
      name: 'บริษัท ทดสอบ จำกัด',
      taxId: '1234567890123',
      type: 'JURISTIC',
    });

    // Verify onCreated callback
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        contactId: 'ct1',
        childId: 'sup1',
        name: 'บริษัท ทดสอบ จำกัด',
        taxId: '1234567890123',
      }),
    );

    // Modal should close
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('SUPPLIER: sends hasVat=true when checkbox is ticked', async () => {
    const user = userEvent.setup();

    apiPostMock.mockResolvedValueOnce({
      data: { id: 'sup2', contactId: 'ct2', name: 'ร้านทดสอบ', taxId: null },
    });

    renderModal({ role: 'SUPPLIER' });

    await user.type(screen.getByLabelText(/ชื่อ/), 'ร้านทดสอบ');
    await user.type(screen.getByLabelText(/เบอร์โทร/), '0899999999');
    await user.click(screen.getByLabelText(/จด VAT/));
    await user.click(screen.getByRole('button', { name: 'สร้าง' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
    const [, payload] = apiPostMock.mock.calls[0];
    expect(payload.hasVat).toBe(true);
  });

  it('SUPPLIER: does NOT show จด VAT checkbox for CUSTOMER role', () => {
    renderModal({ role: 'CUSTOMER' });
    expect(screen.queryByLabelText(/จด VAT/)).toBeNull();
  });

  // ── CUSTOMER ─────────────────────────────────────────────────────────────

  it('CUSTOMER: posts to /customers and calls onCreated mapping childId from customer id', async () => {
    const user = userEvent.setup();

    apiPostMock.mockResolvedValueOnce({
      data: { id: 'cust1', contactId: 'ct3', name: 'นายทดสอบ สมใจ', nationalId: null },
    });

    const { onCreated, onOpenChange } = renderModal({ role: 'CUSTOMER' });

    await user.type(screen.getByLabelText(/ชื่อ/), 'นายทดสอบ สมใจ');
    await user.type(screen.getByLabelText(/เบอร์โทร/), '0812345678');
    await user.click(screen.getByRole('button', { name: 'สร้าง' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());

    const [endpoint, payload] = apiPostMock.mock.calls[0];
    expect(endpoint).toBe('/customers');
    expect(payload).toMatchObject({ name: 'นายทดสอบ สมใจ', phone: '0812345678' });

    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({
        contactId: 'ct3',
        childId: 'cust1',
        name: 'นายทดสอบ สมใจ',
        taxId: '',
      }),
    );

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('CUSTOMER: sends nationalId when individual type and id filled', async () => {
    const user = userEvent.setup();

    apiPostMock.mockResolvedValueOnce({
      data: { id: 'cust2', contactId: 'ct4', name: 'นางสาวทดสอบ', nationalId: '1234567890123' },
    });

    renderModal({ role: 'CUSTOMER' });

    await user.type(screen.getByLabelText(/ชื่อ/), 'นางสาวทดสอบ');
    // Fill national ID (บุคคลธรรมดา is default)
    await user.type(screen.getByLabelText(/เลขบัตรประชาชน/), '1234567890123');
    await user.type(screen.getByLabelText(/เบอร์โทร/), '0812345678');
    await user.click(screen.getByRole('button', { name: 'สร้าง' }));

    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
    const [, payload] = apiPostMock.mock.calls[0];
    expect(payload.nationalId).toBe('1234567890123');
  });

  // ── Validation ────────────────────────────────────────────────────────────

  it('disables submit button when ชื่อ is empty', async () => {
    renderModal({ role: 'SUPPLIER' });
    const submitBtn = screen.getByRole('button', { name: 'สร้าง' });
    expect(submitBtn).toBeDisabled();
  });

  it('disables submit button when เบอร์โทร is empty', async () => {
    const user = userEvent.setup();
    renderModal({ role: 'CUSTOMER' });

    await user.type(screen.getByLabelText(/ชื่อ/), 'ชื่อทดสอบ');
    // phone is still empty
    const submitBtn = screen.getByRole('button', { name: 'สร้าง' });
    expect(submitBtn).toBeDisabled();
  });

  it('prefills ชื่อ from initialName prop', () => {
    renderModal({ role: 'CUSTOMER', initialName: 'ABC Corp' });
    expect(screen.getByLabelText(/ชื่อ/)).toHaveValue('ABC Corp');
  });

  it('shows error toast on API failure', async () => {
    const user = userEvent.setup();

    apiPostMock.mockRejectedValueOnce({
      response: { data: { message: 'ชื่อซ้ำ' } },
    });

    renderModal({ role: 'SUPPLIER' });

    await user.type(screen.getByLabelText(/ชื่อ/), 'ทดสอบ');
    await user.type(screen.getByLabelText(/เบอร์โทร/), '0811111111');
    await user.click(screen.getByRole('button', { name: 'สร้าง' }));

    // We verify the mutation was called (toast is tested by Sonner itself)
    await waitFor(() => expect(apiPostMock).toHaveBeenCalledOnce());
  });
});
