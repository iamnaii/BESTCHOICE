import { createHash, createHmac, randomBytes, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import type { DocumentsHarness } from '../documents/support/harness';
import { assertDisposableRuntime } from '../documents/support/runtime';
import { createFinancedContract } from '../documents/support/receipts-fixtures';
import { SIGNATURE_PNG, syntheticNationalId } from '../documents/support/fixtures';
import { seedStatementReview } from '../../src/modules/contracts/__tests__/credit-approval.fixture';
import { CreditCheckOverrideService } from '../../src/modules/credit-check/services/credit-check-override.service';
import { ContractWorkflowService } from '../../src/modules/contracts/contract-workflow.service';
import { IntegrationConfigService } from '../../src/modules/integrations/integration-config.service';
import { PromiseService } from '../../src/modules/overdue/promise.service';

/** Dedicated fixtures for formerly skipped tests. No provider calls or shared business rows. */
export async function seedBacklogFixtures(h: DocumentsHarness) {
  assertDisposableRuntime();
  const p = h.prisma;
  const prefix = `QA-${randomUUID().slice(0, 8)}`;
  const owner = await p.user.findUniqueOrThrow({ where: { email: 'admin@bestchoice.com' } });
  const manager = await p.user.findUniqueOrThrow({
    where: { email: 'manager.ladprao@bestchoice.com' },
  });
  if (!manager.branchId) throw new Error('The branch manager fixture needs a branch');
  const branchId = manager.branchId;
  const shop = await p.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const finance = await p.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await p.branch.update({
    where: { id: branchId },
    data: { companyId: shop.id, shopCashAccountCode: 'S11-1101' },
  });
  const customer = (label: string) =>
    p.customer.create({
      data: {
        name: `ทดสอบระบบ ${prefix} ${label}`,
        nationalId: syntheticNationalId(),
        phone: '0800000000',
        birthDate: new Date('1990-01-01'),
        addressIdCard: 'ที่อยู่จำลองสำหรับทดสอบ',
        addressCurrent: 'ที่อยู่จำลองสำหรับทดสอบ',
      },
    });
  const contract = async (label: string, overdue = false) => {
    const c = await customer(label);
    return createFinancedContract(p, {
      prefix,
      label,
      branchId,
      customerId: c.id,
      salespersonId: owner.id,
      ...(overdue ? { firstDueDate: new Date(Date.now() - 86400000) } : {}),
    });
  };
  const draft = async (label: string) => {
    const c = await contract(label);
    const consent = await p.pDPAConsent.create({
      data: {
        customerId: c.customerId,
        consentVersion: 'synthetic-qa',
        privacyNoticeText: 'ทดสอบระบบ ข้อมูลจำลอง',
        status: 'GRANTED',
        grantedAt: new Date(),
        signatureImage: SIGNATURE_PNG,
      },
    });
    // An approved, fully signed legacy-format draft. Activation, credit gate,
    // downpayment and SHOP/FINANCE posting all run in the real workflow.
    await p.contract.update({
      where: { id: c.id },
      data: {
        status: 'DRAFT',
        workflowStatus: 'APPROVED',
        pdpaConsentId: consent.id,
        paymentDueDay: c.dueDates[0].getDate(),
        downPaymentMethod: 'CASH',
        downPaymentReceivedAt: new Date(),
        signatures: {
          create: (['CUSTOMER', 'COMPANY', 'WITNESS_1', 'WITNESS_2'] as const).map(
            (signerType) => ({ signerType, signatureImage: SIGNATURE_PNG }),
          ),
        },
      },
    });
    await p.product.update({ where: { id: c.productId }, data: { ownedByCompanyId: shop.id } });
    const check = await seedStatementReview(p, c.customerId, c.id);
    const service = new CreditCheckOverrideService(p);
    const basis = {
      verifiedMonthlyIncome: 50000,
      livingExpenses: 10000,
      externalMonthlyDebt: 0,
      salaryPayDay: c.dueDates[0].getDate(),
      evidenceNotes:
        'Synthetic verified income, expenses, debt and payday for isolated browser regression.',
    };
    const preview = await service.approval.preview(check.id, basis, {
      id: owner.id,
      role: 'OWNER',
    });
    await service.overrideById(
      check.id,
      {
        status: 'APPROVED',
        overrideReason: 'Verified synthetic affordability for isolated browser regression',
        affordability: {
          ...basis,
          contextToken: preview.contextToken,
          approvedMonthlyPayment: 3000,
          confirmed: true,
        },
      },
      owner.id,
      'OWNER',
    );
    return c;
  };
  const activation = await draft('ACTIVATION');
  const verification = await contract('VERIFY');
  const verificationHash = randomBytes(32).toString('hex');
  await p.contract.update({
    where: { id: verification.id },
    data: { contractHash: verificationHash },
  });
  const profilePassword = randomBytes(20).toString('hex');
  const profileUser = await p.user.create({
    data: {
      email: `${prefix.toLowerCase()}-profile@example.invalid`,
      name: 'ทดสอบระบบ โปรไฟล์',
      password: await bcrypt.hash(profilePassword, 10),
      role: 'OWNER',
      branchId,
      accessibleCompanies: ['SHOP', 'FINANCE'],
      primaryCompany: 'FINANCE',
      yeastarExtension: '101',
      defaultCashAccountCode: '11-1101',
    },
  });
  const gateway = await draft('GATEWAY');
  await h.app.get(ContractWorkflowService).activate(gateway.id);
  const payment = await p.payment.findFirstOrThrow({
    where: { contractId: gateway.id, installmentNo: 1 },
  });
  const link = await p.paymentLink.create({
    data: {
      token: `qa-${randomUUID()}`,
      contractId: gateway.id,
      paymentId: payment.id,
      amount: payment.amountDue,
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const merchantId = `synthetic-${prefix}`;
  await h.app.get(IntegrationConfigService).saveConfig('paysolutions', { merchantId });
  const secret = randomBytes(32).toString('hex');
  process.env.PAYSOLUTIONS_WEBHOOK_SECRET = secret;
  const rawPayload = JSON.stringify({
    merchantid: merchantId,
    refno: link.token,
    result_code: '00',
    total: payment.amountDue.toFixed(2),
    order_no: `qa-${randomUUID()}`,
    transaction_id: `qa-${randomUUID()}`,
  });
  const signature = createHmac('sha256', secret).update(rawPayload).digest('hex');
  const period = await p.accountingPeriod.create({
    data: {
      companyId: finance.id,
      year: 2020,
      month: 2,
      status: 'REVIEW',
      auditIssues: {
        hasIssues: true,
        unbalancedJournals: 1,
        totalJournals: 1,
        paymentsWithoutBreakdown: 0,
      },
    },
  });
  const usedInvite = await p.inviteToken.create({
    data: {
      token: createHash('sha256').update(randomBytes(32)).digest('hex'),
      email: `${prefix.toLowerCase()}-used@example.invalid`,
      role: 'SALES',
      branchId,
      invitedBy: owner.id,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  const external = await p.externalFinanceCompany.create({
    data: { name: `ทดสอบระบบ ${prefix} ไฟแนนซ์` },
  });
  const receivable = async (label: string, broken = false) => {
    const c = await contract(label);
    const sale = await p.sale.create({
      data: {
        saleNumber: `${prefix}-${label}`,
        saleType: 'EXTERNAL_FINANCE',
        customerId: c.customerId,
        productId: c.productId,
        branchId,
        salespersonId: owner.id,
        sellingPrice: '12000',
        netAmount: '12000',
      },
    });
    const row = await p.financeReceivable.create({
      data: {
        saleId: sale.id,
        branchId,
        financeCompany: external.name,
        externalFinanceCompanyId: external.id,
        expectedAmount: '10000',
        netExpectedAmount: '10000',
        expectedDate: new Date(Date.now() - 86400000),
      },
    });
    if (broken)
      await p.financeReceivableContactLog.create({
        data: {
          financeReceivableId: row.id,
          externalFinanceCompanyId: external.id,
          contactedById: owner.id,
          result: 'PROMISED',
          promisedDate: new Date(Date.now() - 86400000),
          promisedBrokenAt: new Date(),
          promisedAmount: '10000',
        },
      });
    return { id: row.id, saleNumber: sale.saleNumber };
  };
  const clean = await receivable('CONTACT');
  const broken = await receivable('BROKEN', true);
  const promiseHappy = await contract('PROMISE-HAPPY', true);
  const promiseSupersede = await contract('PROMISE-SUPERSEDE', true);
  const firstPayment = await p.payment.findFirstOrThrow({
    where: { contractId: promiseHappy.id, installmentNo: 1 },
  });
  await h.app
    .get(PromiseService)
    .createPromise({
      contractId: promiseHappy.id,
      userId: manager.id,
      slots: [{ settlementDate: new Date(Date.now() + 2 * 86400000), settlementAmount: 1000 }],
      targetInstallmentIds: [firstPayment.id],
    });
  return {
    prefix,
    activation,
    verification: {
      id: verification.id,
      contractNumber: verification.contractNumber,
      hash: verificationHash,
    },
    profile: { email: profileUser.email, password: profilePassword },
    template: gateway,
    gateway: { ...gateway, paymentId: payment.id, rawPayload, signature },
    financeCompanyId: finance.id,
    period: { id: period.id, companyId: period.companyId, year: period.year, month: period.month },
    usedInvite: { id: usedInvite.id, email: usedInvite.email },
    receivables: { clean, broken },
    promiseHappy,
    promiseSupersede,
  };
}
