/**
 * รัน: DATABASE_URL=<ฐานทดสอบ> npx jest src/modules/late-fee-waiver/late-fee-waiver.approve.db.spec.ts --runInBand
 * (TZ=Asia/Bangkok และ TZ=UTC)
 *
 * Request-approval waiver (collector → approver, `POST /late-fee-waivers/:id/approve`) on
 * real rows: an installment whose base is already paid and only owed the late fee becomes
 * PAID with paidDate once the fee is waived — the same rule as the payments-side waiver
 * (`lateFeeWaiverSettlement`) — and the contract-completion check runs in the same tx.
 * Before the fix the row stayed PARTIALLY_PAID with nothing owed.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { LateFeeWaiverService } from './late-fee-waiver.service';
import {
  FinanceFixtureBase,
  InstallmentFixture,
  assertTestDatabase,
  createFinanceFixtureBase,
  createInstallmentFixture,
  dec,
  realBangkokDate,
  dueDateBkk,
  retireFixtures,
} from '../notifications/__tests__/finance-line-fixtures';

const prisma = new PrismaClient();
const stamp = `lfw-${Date.now()}`;
const day = realBangkokDate();
const fixtures: InstallmentFixture[] = [];
const products = { transferOwnership: jest.fn() };
let base: FinanceFixtureBase;
let approverId: string;
let service: LateFeeWaiverService;

/** One contract, installment 1 = `amountPaid` of 1,515.83 paid + 100 late fee, PARTIALLY_PAID, 10 days late. */
async function feeContract(label: string, amountPaid: string, extraInstallmentDue?: number) {
  const f = await createInstallmentFixture(prisma, base, {
    label,
    dueDate: dueDateBkk(day, -10),
    paymentStatus: 'PARTIALLY_PAID',
    contractStatus: 'OVERDUE',
    lateFee: '100.00',
  });
  await prisma.payment.update({
    where: { id: f.paymentId },
    data: { amountPaid: dec(amountPaid) },
  });
  fixtures.push(f);
  if (extraInstallmentDue !== undefined) {
    const next = await prisma.payment.create({
      data: {
        contractId: f.contractId,
        installmentNo: 2,
        dueDate: dueDateBkk(day, extraInstallmentDue),
        amountDue: dec('1515.83'),
        status: 'PENDING',
      },
    });
    fixtures.push({ ...f, paymentId: next.id });
  }
  return f;
}

async function approveWaiverFor(f: InstallmentFixture) {
  const req = await service.create(
    { contractId: f.contractId, paymentIds: [f.paymentId], reason: 'ลูกค้าป่วย' },
    base.salespersonId,
  );
  return service.approve(req.id, approverId);
}

const paymentOf = (id: string) =>
  prisma.payment.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      paidDate: true,
      lateFee: true,
      lateFeeWaived: true,
      waivedAmount: true,
    },
  });
const contractStatusOf = async (id: string) =>
  (await prisma.contract.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

beforeAll(async () => {
  assertTestDatabase();
  base = await createFinanceFixtureBase(prisma, stamp);
  approverId = (
    await prisma.user.create({
      data: {
        email: `${stamp}-approver@bestchoice.test`,
        password: 'x',
        name: 'approver',
        role: 'OWNER',
      },
    })
  ).id;
  service = new LateFeeWaiverService(
    prisma as unknown as PrismaService,
    products as unknown as ProductsService,
  );
});

afterAll(async () => {
  await retireFixtures(prisma, fixtures);
  // FK late_fee_waiver_requests → contracts is RESTRICT: leave no request rows behind,
  // or a later suite that wipes contracts on the same DB fails on this spec's leftovers.
  await prisma.lateFeeWaiverRequest.deleteMany({
    where: { contractId: { in: [...new Set(fixtures.map((f) => f.contractId))] } },
  });
  await prisma.$disconnect();
});

it('base already paid, only the fee owed → PAID with paidDate; last installment ⇒ contract COMPLETED + ownership released', async () => {
  const f = await feeContract('feeOnly', '1515.83');
  const product = await prisma.contract.findUniqueOrThrow({
    where: { id: f.contractId },
    select: { productId: true },
  });

  await approveWaiverFor(f);

  const p = await paymentOf(f.paymentId);
  expect(p.status).toBe('PAID');
  expect(p.paidDate).toBeInstanceOf(Date);
  expect(p.lateFee.toFixed(2)).toBe('0.00');
  expect(p.lateFeeWaived).toBe(true);
  expect(p.waivedAmount?.toFixed(2)).toBe('100.00');
  expect(await contractStatusOf(f.contractId)).toBe('COMPLETED');
  expect(products.transferOwnership).toHaveBeenCalledWith(
    product.productId,
    null,
    expect.anything(),
  );
});

it('base fully paid but a later installment still open → PAID, contract NOT completed', async () => {
  const f = await feeContract('feeOnlyNotLast', '1515.83', 20);

  await approveWaiverFor(f);

  expect((await paymentOf(f.paymentId)).status).toBe('PAID');
  expect(await contractStatusOf(f.contractId)).toBe('OVERDUE');
});

it('base still owing (500 of 1,515.83) → fee waived, row stays PARTIALLY_PAID without paidDate', async () => {
  const f = await feeContract('stillOwing', '500.00');

  await approveWaiverFor(f);

  const p = await paymentOf(f.paymentId);
  expect(p.status).toBe('PARTIALLY_PAID');
  expect(p.paidDate).toBeNull();
  expect(p.lateFee.toFixed(2)).toBe('0.00');
  expect(p.lateFeeWaived).toBe(true);
  expect(await contractStatusOf(f.contractId)).toBe('OVERDUE');
});
