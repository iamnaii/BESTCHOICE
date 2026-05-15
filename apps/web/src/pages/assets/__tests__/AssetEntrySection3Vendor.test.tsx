// PR 2a Task 5 (P6) — AssetEntrySection3Vendor: vendor combobox + partial-payment.
//
// Coverage:
//  - Combobox role is exposed (a11y) and labeled "ผู้ขาย"
//  - "จำนวนเงินที่จ่าย" partial-payment input is rendered
//  - Existing fields (เลขใบกำกับภาษี, อ้างอิง PR) are preserved
//
// Deferred (combobox / dialog interaction): the Popover + cmdk combination uses
// Radix portals which JSDOM cannot fully render in a way that exposes a stable
// listbox to RTL queries. Auto-fill on select and dialog-create flows are
// validated manually for this PR; future work can use Playwright for full e2e.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AssetEntrySection3Vendor } from '../components/AssetEntrySection3Vendor';

vi.mock('../api', () => ({
  assetsApi: {
    suppliersList: vi.fn().mockResolvedValue([
      { id: 'sup-1', name: 'ABC Trading', taxId: '0105561234567' },
      { id: 'sup-2', name: 'XYZ Co.,Ltd.', taxId: '0105567654321' },
    ]),
    suppliersCreate: vi
      .fn()
      .mockResolvedValue({ id: 'sup-new', name: 'New Vendor', taxId: null }),
  },
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  const methods = useForm({
    defaultValues: {
      vendorId: '',
      supplierName: '',
      supplierTaxId: '',
      vendorAmountPaid: undefined,
      paymentMethod: 'CASH' as const,
      paymentAccount: '11-1101',
      purchaseDate: '2026-05-15',
      invoiceDate: '',
      invoiceNo: '',
      taxInvoiceNo: '',
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <FormProvider {...(methods as any)}>{children}</FormProvider>;
}

const renderSection = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Wrapper>
        <AssetEntrySection3Vendor />
      </Wrapper>
    </QueryClientProvider>,
  );
};

describe('AssetEntrySection3Vendor — P6 supplier integration', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exposes a vendor combobox with role=combobox and an accessible name', async () => {
    renderSection();
    const combobox = await screen.findByRole('combobox', { name: /ผู้ขาย/ });
    expect(combobox).toBeInTheDocument();
  });

  it('renders the "จำนวนเงินที่จ่าย" partial-payment input', async () => {
    renderSection();
    expect(await screen.findByLabelText(/จำนวนเงินที่จ่าย/)).toBeInTheDocument();
  });

  it('uses the placeholder "ว่างไว้ = ชำระเต็มจำนวน" on the partial-payment field', async () => {
    renderSection();
    // Placeholder copy explains optional partial payment behavior to the user.
    expect(await screen.findByPlaceholderText(/ว่างไว้ = ชำระเต็มจำนวน/)).toBeInTheDocument();
  });

  it('preserves existing fields: เลขใบกำกับภาษี and อ้างอิง PR', async () => {
    renderSection();
    expect(await screen.findByLabelText(/เลขใบกำกับภาษี/)).toBeInTheDocument();
    expect(await screen.findByLabelText(/อ้างอิง PR/)).toBeInTheDocument();
  });

  it('preserves the เลขประจำตัวผู้เสียภาษี (auto-fill target) field', async () => {
    renderSection();
    expect(
      await screen.findByLabelText(/เลขประจำตัวผู้เสียภาษี/),
    ).toBeInTheDocument();
  });
});
