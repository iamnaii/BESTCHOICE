import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { TEST_DOC_PREFIX, TEST_NAME_PREFIX } from '../../../src/utils/test-data-markers';

/**
 * DOC-09 (issue #1568) fixtures — overdue FINANCE contracts that the real
 * LetterAutoGenerateCron turns into RETURN_DEVICE_45D / CONTRACT_TERMINATION_60D
 * letters, the figures an independent reader expects on the printed letter, and a
 * stand-in for the public object storage that holds legacy letter files.
 */
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export async function setSystemConfig(prisma: PrismaService, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await prisma.systemConfig.updateMany({ where: { key }, data: { deletedAt: new Date() } });
    return;
  }
  await prisma.systemConfig.upsert({ where: { key }, update: { value, deletedAt: null }, create: { key, value } });
}

export interface OverdueContractInput {
  prefix: string;
  label: string;
  branchId: string;
  customerId: string;
  salespersonId: string;
  /** Days since the oldest unpaid installment fell due (drives 45-day / 60-day eligibility). */
  oldestOverdueDays: number;
  months?: number;
  monthly?: string;
  /** Late fee already booked on every overdue installment (flat bracket, not subject to VAT). */
  lateFee?: string;
  status?: 'ACTIVE' | 'OVERDUE' | 'DEFAULT';
  productModel?: string;
}

export interface OverduePaymentRow { id: string; installmentNo: number; dueDate: Date; amountDue: string; amountPaid: string; lateFee: string; status: string }
export interface OverdueContract {
  id: string;
  contractNumber: string;
  productId: string;
  branchId: string;
  customerId: string;
  months: number;
  monthly: string;
  product: { brand: string; model: string; storage: string; color: string; imei: string };
  payments: OverduePaymentRow[];
}

function monthsAfter(base: Date, months: number): Date {
  const date = new Date(base);
  date.setMonth(date.getMonth() + months);
  return date;
}

/**
 * OVERDUE contract with `months` installment rows spaced one month apart, the
 * oldest due `oldestOverdueDays` ago; every row that fell due before now is
 * OVERDUE and carries `lateFee`, the rest are PENDING. Nothing has been paid.
 */
export async function createOverdueContract(prisma: PrismaService, input: OverdueContractInput): Promise<OverdueContract> {
  const months = input.months ?? 12;
  const monthly = input.monthly ?? '1515.83';
  const lateFee = input.lateFee ?? '100.00';
  const product = { brand: 'Apple', model: input.productModel ?? `iPhone ${TEST_NAME_PREFIX} ${input.label}`, storage: '128GB', color: 'ดำ', imei: `${TEST_DOC_PREFIX}${input.prefix}-LT-${input.label}` };
  const productRow = await prisma.product.create({ data: {
    name: `${TEST_NAME_PREFIX} ${product.model}`, brand: product.brand, model: product.model, storage: product.storage, color: product.color, category: 'PHONE_NEW',
    branchId: input.branchId, costPrice: '8000', cashPrice: '12000', installmentPrice: '12000', imeiSerial: product.imei, status: 'SOLD_INSTALLMENT',
  } });
  const contract = await prisma.contract.create({ data: {
    contractNumber: `${TEST_DOC_PREFIX}${input.prefix}-LT-${input.label}`, customerId: input.customerId, productId: productRow.id, branchId: input.branchId,
    salespersonId: input.salespersonId, planType: 'STORE_WITH_INTEREST', sellingPrice: '12000.00', downPayment: '2000.00', financedAmount: '10000.00',
    interestRate: '0.6000', totalMonths: months, interestTotal: '6000.00', storeCommission: '1000.00', vatAmount: '1190.00', vatPct: '0.0700',
    monthlyPayment: monthly, paymentDueDay: 5, status: input.status ?? 'OVERDUE',
  } });
  const oldest = new Date();
  oldest.setHours(0, 0, 0, 0);
  oldest.setDate(oldest.getDate() - input.oldestOverdueDays);
  const now = Date.now();
  const payments: OverduePaymentRow[] = [];
  for (let installmentNo = 1; installmentNo <= months; installmentNo += 1) {
    const dueDate = monthsAfter(oldest, installmentNo - 1);
    const overdue = dueDate.getTime() < now;
    const row = await prisma.payment.create({ data: {
      contractId: contract.id, installmentNo, dueDate, amountDue: monthly, amountPaid: '0', status: overdue ? 'OVERDUE' : 'PENDING', lateFee: overdue ? lateFee : '0',
    } });
    payments.push({ id: row.id, installmentNo, dueDate, amountDue: row.amountDue.toFixed(2), amountPaid: row.amountPaid.toFixed(2), lateFee: row.lateFee.toFixed(2), status: row.status });
  }
  return { id: contract.id, contractNumber: contract.contractNumber, productId: productRow.id, branchId: input.branchId, customerId: input.customerId, months, monthly, product, payments };
}

/** Thai Buddhist long date the letter prints, e.g. "11 กันยายน 2569" (server-local time, TZ=Asia/Bangkok). */
export function thaiLongDate(date: Date): string {
  return `${date.getDate()} ${THAI_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
}

export interface ExpectedLetterFigures {
  /** Everything still owed on unpaid installments (the letter demands the whole remaining balance). */
  principal: string;
  lateFee: string;
  total: string;
  overdueMonths: string[];
  overdueInstallments: number;
  firstMonth: string;
}

/**
 * Independent restatement of what the demand letter must say for this contract:
 * unpaid = every PENDING/OVERDUE/PARTIALLY_PAID row (due or not), overdue = rows due
 * before `at`, months = distinct Thai month names of the overdue rows in due order.
 */
export function expectedLetterFigures(contract: OverdueContract, at = new Date()): ExpectedLetterFigures {
  const unpaid = contract.payments.filter((row) => ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'].includes(row.status));
  const principal = unpaid.reduce((sum, row) => sum.plus(row.amountDue).minus(row.amountPaid), new Prisma.Decimal(0));
  const lateFee = unpaid.reduce((sum, row) => sum.plus(row.lateFee), new Prisma.Decimal(0));
  const overdue = unpaid.filter((row) => row.dueDate.getTime() < at.getTime()).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const overdueMonths = [...new Set(overdue.map((row) => `${THAI_MONTHS[row.dueDate.getMonth()]} ${row.dueDate.getFullYear() + 543}`))];
  return { principal: principal.toFixed(2), lateFee: lateFee.toFixed(2), total: principal.plus(lateFee).toFixed(2), overdueMonths, overdueInstallments: overdue.length, firstMonth: overdueMonths[0] ?? '' };
}

/** Money exactly as the letter renderer prints it (en-US grouping, 2 decimals). */
export const letterMoney = (value: string | number) => Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface StoredFileServer {
  origin: string;
  /** Public URL a legacy `ContractLetter.pdfUrl` would carry. */
  url(key: string): string;
  put(key: string, bytes: Buffer): void;
  /** Make every GET answer 500 (storage outage) until cleared. */
  setFailing(failing: boolean): void;
  requests: Array<{ method: string; key: string; status: number; at: string }>;
  close(): Promise<void>;
}

/**
 * Stand-in for the public object storage that holds legacy letter files
 * (`ContractLetter.pdfUrl`): the browser fetches those URLs directly with no
 * credentials, so a plain HTTP file server with CORS is the faithful shape.
 * Never reachable from outside this machine.
 */
export async function startStoredFileServer(): Promise<StoredFileServer> {
  const files = new Map<string, Buffer>();
  const requests: StoredFileServer['requests'] = [];
  let failing = false;
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const key = decodeURIComponent((req.url ?? '/').replace(/^\/files\//, '').split('?')[0]);
    const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS', 'Access-Control-Allow-Headers': '*' };
    const finish = (status: number, body?: Buffer, extra: Record<string, string> = {}) => {
      requests.push({ method: req.method ?? '', key, status, at: new Date().toISOString() });
      res.writeHead(status, { ...headers, ...extra });
      res.end(body);
    };
    if (req.method === 'OPTIONS') return finish(204);
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => { files.set(key, Buffer.concat(chunks)); finish(200); });
      return;
    }
    if (failing) return finish(500, Buffer.from('synthetic storage outage'), { 'Content-Type': 'text/plain' });
    const file = files.get(key);
    if (!file) return finish(404, Buffer.from('not found'), { 'Content-Type': 'text/plain' });
    return finish(200, file, { 'Content-Type': 'application/pdf', 'Content-Length': String(file.length) });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    url: (key) => `${origin}/files/${encodeURIComponent(key)}`,
    put: (key, bytes) => { files.set(key, bytes); },
    setFailing: (value) => { failing = value; },
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
