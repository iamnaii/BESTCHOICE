import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ContractWorkflowService } from './contract-workflow.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { ProductsService } from '../products/products.service';
import { ContractActivation1ATemplate } from '../journal/cpa-templates/contract-activation-1a.template';
import { ContractExchangeService } from '../contract-exchange/contract-exchange.service';

/**
 * T5-C20 — extended contract integrity hash.
 *
 * We exercise the private computeContractHash + verifyContractHash via the
 * service instance. The public path (submitForReview → approveContract) is
 * covered in contract-signing-workflow.spec.ts; these tests focus on the
 * extra coverage for notes, signatures, documents, and customer nationalId.
 */
describe('ContractWorkflowService — hash integrity (T5-C20)', () => {
  let service: ContractWorkflowService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContractWorkflowService,
        { provide: PrismaService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: JournalAutoService, useValue: {} },
        { provide: ProductsService, useValue: {} },
        { provide: ContractActivation1ATemplate, useValue: { execute: jest.fn().mockResolvedValue({ entryNo: 'JE-MOCK' }) } },
        { provide: ContractExchangeService, useValue: { finalizeAfterActivation: jest.fn() } },
      ],
    }).compile();
    service = module.get(ContractWorkflowService);
  });

  // ────────────────────────────────────────────────────────────
  // Access the private methods. Keeping these cast in one place.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const compute = (c: any) => (service as any).computeContractHash(c);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const verify = (c: any, t: string) => (service as any).verifyContractHash(c, t);

  const baseContract = () => ({
    contractNumber: 'BC-2026-001',
    customerId: 'customer-1',
    productId: 'product-1',
    sellingPrice: '20000',
    downPayment: '2000',
    totalMonths: 12,
    monthlyPayment: '1817',
    notes: 'original notes',
    customer: { nationalId: '1234567890123' },
    signatures: [
      {
        id: 'sig-1',
        signerType: 'CUSTOMER',
        signedAt: new Date('2026-04-01T10:00:00Z'),
        staffUserId: null,
      },
      {
        id: 'sig-2',
        signerType: 'COMPANY',
        signedAt: new Date('2026-04-01T10:05:00Z'),
        staffUserId: 'user-1',
      },
    ],
    contractDocuments: [
      { id: 'doc-1', fileHash: 'abc123' },
      { id: 'doc-2', fileHash: 'def456' },
    ],
  });

  it('hash covers notes, customer.nationalId, signatures (id/type/timestamp/staff), and document fileHashes', async () => {
    const contract = baseContract();
    const h0 = compute(contract);

    // Notes change — must flip hash
    const hNotes = compute({ ...baseContract(), notes: 'edited notes' });
    expect(hNotes).not.toBe(h0);

    // customer.nationalId change — must flip hash
    const hNid = compute({
      ...baseContract(),
      customer: { nationalId: '9999999999999' },
    });
    expect(hNid).not.toBe(h0);

    // Signature timestamp change — must flip hash
    const sigsChanged = baseContract();
    sigsChanged.signatures[0].signedAt = new Date('2026-04-02T10:00:00Z');
    const hSig = compute(sigsChanged);
    expect(hSig).not.toBe(h0);

    // Signature staffUserId change — must flip hash
    const sigsStaff = baseContract();
    sigsStaff.signatures[1].staffUserId = 'user-99';
    expect(compute(sigsStaff)).not.toBe(h0);

    // Document fileHash change (swapped PDF content) — must flip hash
    const docsChanged = baseContract();
    docsChanged.contractDocuments[0].fileHash = 'tampered';
    expect(compute(docsChanged)).not.toBe(h0);

    // Sanity: identical input → identical hash
    expect(compute(baseContract())).toBe(h0);
  });

  it('verifyContractHash throws BadRequestException when any extended field was tampered post-submit', async () => {
    const original = baseContract();
    const storedHash = compute(original);

    // A document fileHash was quietly replaced (PDF swap). Core money fields
    // unchanged — core-only hash would still match, but extended hash catches it.
    const tampered = {
      ...baseContract(),
      contractHash: storedHash,
    };
    tampered.contractDocuments[1].fileHash = 'tampered-swap';

    expect(() => verify(tampered, 'APPROVED')).toThrow(BadRequestException);
    expect(() => verify(tampered, 'APPROVED')).toThrow(/contractHash ไม่ตรงกัน/);
  });

  it('verifyContractHash passes when unchanged contract is re-hashed at later state transitions', async () => {
    const original = baseContract();
    const storedHash = compute(original);

    // Same contract — nothing edited. Both APPROVED + ACTIVE transitions pass.
    const unchanged = { ...baseContract(), contractHash: storedHash };
    expect(() => verify(unchanged, 'APPROVED')).not.toThrow();
    expect(() => verify(unchanged, 'ACTIVE')).not.toThrow();

    // Legacy contract with null contractHash is a no-op (skipped).
    expect(() =>
      verify({ ...baseContract(), contractHash: null }, 'APPROVED'),
    ).not.toThrow();
  });

  it('signature / document ordering does not affect the hash (sorted by id)', async () => {
    const a = baseContract();
    const b = baseContract();
    // Reverse both collections — compute() sorts internally
    b.signatures.reverse();
    b.contractDocuments.reverse();
    expect(compute(a)).toBe(compute(b));
  });
});
