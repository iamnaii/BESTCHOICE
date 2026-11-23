import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import ContractDocuments from './ContractDocuments';

it('conveys a signed company and unsigned witness alongside their existing signer labels', () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContractDocuments
        signatureRequirements={{
          complete: false,
          checklist: [
            { type: 'COMPANY', label: 'ผู้ขาย (ผู้ให้เช่าซื้อ)', signed: true },
            { type: 'WITNESS_1', label: 'พยาน 1', signed: false },
          ],
        }}
        signatures={[{ id: 'staff-signature', signerType: 'STAFF', signedAt: '2026-11-23T09:00:00Z' }]}
        eDocuments={[]}
        pdpaConsentId="consent"
        isLoading={false}
        isError={false}
        error={null}
        onRetry={() => {}}
        page={1}
        total={0}
        onPageChange={() => {}}
      />
    </QueryClientProvider>,
  );

  const signed = screen.getByRole('img', { name: 'ลงนามแล้ว' });
  expect(signed).toHaveAttribute('data-icon-style', 'duotone');
  expect(signed.parentElement).toHaveTextContent('ผู้ขาย (ผู้ให้เช่าซื้อ)');
  const unsigned = screen.getByRole('img', { name: 'ยังไม่ได้ลงนาม' });
  expect(unsigned).toHaveAttribute('data-icon-style', 'duotone');
  expect(unsigned.parentElement).toHaveTextContent('พยาน 1');
  expect(screen.getByText('ยินยอม PDPA แล้ว').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
});
