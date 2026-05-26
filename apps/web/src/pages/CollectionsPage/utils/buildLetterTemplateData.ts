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
  const coordinatorName = findConfig('letter_coordinator_name');
  const coordinatorPhone = findConfig('letter_coordinator_phone');

  const payments: Array<{
    status: string;
    installmentNo?: number;
    amountDue: string;
    amountPaid: string;
    lateFee: string | null;
    dueDate: string;
  }> = (contractRes.payments ?? []).filter((p: { status: string }) =>
    ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(p.status),
  );

  const principalDec = payments.reduce(
    (sum, p) =>
      sum.plus(new Decimal(p.amountDue ?? '0')).minus(new Decimal(p.amountPaid ?? '0')),
    new Decimal(0),
  );
  const lateFeeDec = payments.reduce(
    (sum, p) => sum.plus(new Decimal(p.lateFee ?? '0')),
    new Decimal(0),
  );
  const outstanding = principalDec.plus(lateFeeDec).toNumber();
  const principalAmount = principalDec.toNumber();
  const lateFeeAmount = lateFeeDec.toNumber();

  const now = new Date();
  const oldest = payments
    .map((p) => new Date(p.dueDate))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const daysOverdue = oldest
    ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 86400000))
    : 0;

  // Distinct overdue months in Thai (BE year), oldest first
  const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  const overdueMonths = Array.from(
    new Set(
      payments
        .map((p) => new Date(p.dueDate))
        .filter((d) => d.getTime() < now.getTime())
        .sort((a, b) => a.getTime() - b.getTime())
        .map((d) => `${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`),
    ),
  );
  const overdueInstallments = payments.filter(
    (p) => new Date(p.dueDate).getTime() < now.getTime(),
  ).length;

  // First-due date = installmentNo=1 dueDate, else earliest payment overall
  const allPayments: Array<{ installmentNo?: number; dueDate: string }> =
    contractRes.payments ?? [];
  const firstInstallment = allPayments.find((p) => p.installmentNo === 1) ?? allPayments[0];
  const firstDueDate = firstInstallment?.dueDate ? new Date(firstInstallment.dueDate) : null;

  // Product info — guard against legacy contracts where product was deleted
  const productRaw = contractRes.product ?? null;
  const product = productRaw
    ? {
        brand: productRaw.brand ?? '',
        model: productRaw.model ?? '',
        storage: productRaw.storage ?? null,
        color: productRaw.color ?? null,
        imei: productRaw.imeiSerial ?? null,
      }
    : undefined;

  const totalMonths = Number(contractRes.totalMonths ?? 0);
  const monthlyPayment = Number(contractRes.monthlyPayment ?? 0);
  const paymentDueDay = contractRes.paymentDueDay ?? null;
  const paymentSchedule =
    totalMonths > 0
      ? {
          totalMonths,
          monthlyPayment,
          paymentDueDay,
          firstDueDate,
        }
      : undefined;

  const coordinator =
    coordinatorName && coordinatorPhone
      ? { name: coordinatorName, phone: coordinatorPhone }
      : undefined;

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
    product,
    paymentSchedule,
    overdueDetail: {
      overdueMonths,
      overdueInstallments,
      principalAmount,
      lateFeeAmount,
    },
    coordinator,
  };
}
