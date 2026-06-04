// P1a — AssetEntrySection3Vendor: bespoke vendor picker replaced with
// shared <ContactCombobox roleNeeded="SUPPLIER">.
//
// Coverage:
//  - ContactCombobox is rendered with role=combobox (forwarded from the shared component)
//  - "จำนวนเงินที่จ่าย" partial-payment input is rendered
//  - Existing fields (เลขใบกำกับภาษี, อ้างอิง PR, เลขประจำตัวผู้เสียภาษี) are preserved
//
// Strategy: mock ContactCombobox so we avoid Popover/cmdk portal rendering issues
// in JSDOM and keep this test focused on the section's own wiring.

import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AssetEntrySection3Vendor } from '../components/AssetEntrySection3Vendor';

// Mock the shared ContactCombobox so the section can be rendered in JSDOM
// without Radix portal issues. The mock renders a plain combobox button that
// exposes the same role/aria-label as the real component.
vi.mock('@/components/contacts/ContactCombobox', () => ({
  ContactCombobox: ({
    value,
    placeholder,
    invalid,
  }: {
    value: string;
    placeholder?: string;
    invalid?: boolean;
    onSelect: (r: unknown) => void;
    roleNeeded: string;
  }) => (
    <button
      type="button"
      role="combobox"
      aria-label="ผู้ขาย"
      aria-invalid={invalid}
      aria-expanded={false}
    >
      {value || placeholder || 'เลือกผู้ขาย / บริษัท'}
    </button>
  ),
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

describe('AssetEntrySection3Vendor — P1a ContactCombobox integration', () => {
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
