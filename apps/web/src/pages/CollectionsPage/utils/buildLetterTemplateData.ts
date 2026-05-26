import Decimal from 'decimal.js';
import api from '@/lib/api'; // ← DEFAULT import
import type { LetterTemplateData } from './letterPdfRenderer';

interface LetterInput {
  letterType: 'RETURN_DEVICE_45D' | 'CONTRACT_TERMINATION_60D';
  letterNumber: string;
  contract: {
    id: string;
    contractNumber: string;
    customer: { name: string; addressCurrent?: string | null };
  };
}

/**
 * Fetches contract + company info and assembles LetterTemplateData
 * ready for renderLetterPdf / renderLetterPdfDoc.
 *
 * Shared by LetterDispatchDialog (single) and BulkPrintDialog (loop).
 */
export async function buildLetterTemplateData(letter: LetterInput): Promise<LetterTemplateData> {
  const [contractRes, companiesRes, settingsRes] = await Promise.all([
    api.get(`/contracts/${letter.contract.id}`).then((r) => r.data),
    api.get('/companies').then((r) => r.data as Array<{
      id: string;
      companyCode: string | null;
      nameTh: string;
      taxId: string;
      address: string;
      phone: string | null;
      directorName: string;
      directorPosition: string | null;
      logoUrl: string | null;
    }>),
    api.get('/settings').then((r) => r.data as Array<{ key: string; value: string | null }>),
  ]);

  // Pick FINANCE company (the HP financer signing the letter)
  const companies = companiesRes ?? [];
  const company = companies.find((c) => c.companyCode === 'FINANCE') ?? companies[0] ?? null;

  if (!company) {
    throw new Error('ไม่พบข้อมูลบริษัท (FINANCE) — โปรดตั้งค่า CompanyInfo ก่อน');
  }

  const settings = settingsRes ?? [];
  const findConfig = (key: string): string | null =>
    settings.find((s) => s.key === key)?.value ?? null;
  const signatureUrl = findConfig('letter_signature_url');
  const letterheadUrl = findConfig('letter_letterhead_url');

  const payments: Array<{
    status: string;
    amountDue: string;
    amountPaid: string;
    lateFee: string | null;
    dueDate: string;
  }> = (contractRes.payments ?? []).filter((p: { status: string }) =>
    ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status),
  );

  const outstandingDec = payments.reduce(
    (sum, p) =>
      sum
        .plus(new Decimal(p.amountDue ?? '0'))
        .minus(new Decimal(p.amountPaid ?? '0'))
        .plus(new Decimal(p.lateFee ?? '0')),
    new Decimal(0),
  );
  const outstanding = outstandingDec.toNumber();

  const now = new Date();
  const oldest = payments
    .map((p) => new Date(p.dueDate))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const daysOverdue = oldest
    ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86400000))
    : 0;

  return {
    letterType: letter.letterType,
    letterNumber: letter.letterNumber,
    letterDate: new Date(),
    company: {
      nameTh: company.nameTh,
      taxId: company.taxId,
      address: company.address,
      phone: company.phone ?? undefined,
      directorName: company.directorName,
      directorPosition: company.directorPosition ?? undefined,
      logoUrl: letterheadUrl ?? company.logoUrl ?? undefined,
      signatureUrl: signatureUrl ?? undefined,
    },
    customer: {
      name: letter.contract.customer.name,
      address: letter.contract.customer.addressCurrent ?? null,
    },
    contract: {
      contractNumber: letter.contract.contractNumber,
      contractDate: contractRes.createdAt ? new Date(contractRes.createdAt) : null,
      outstanding,
      daysOverdue,
    },
  };
}
