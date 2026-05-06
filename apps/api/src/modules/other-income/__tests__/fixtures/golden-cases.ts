import { Prisma } from '@prisma/client';

const D = (n: number | string) => new Prisma.Decimal(n);

/** Reusable doc factories used by validation + auto-journal tests. */
export const goldenCases = {
  /** ดอกเบี้ยฝาก KBank — ไม่มี VAT, มี WHT 15%. amountReceived = net (no adjustment) */
  bankInterest: {
    issueDate: new Date('2026-05-06'),
    paymentAccountCode: '11-1201',
    priceType: 'EXCLUSIVE' as const,
    counterpartyName: 'ธนาคารกสิกรไทย',
    items: [
      {
        lineNo: 1,
        accountCode: '42-1102',
        accountName: 'ดอกเบี้ยเงินฝาก',
        quantity: D(1),
        unitAmount: D(1000),
        discountAmount: D(0),
        vatPct: D(0),
        whtPct: D(15),
        amountBeforeVat: D(1000),
        vatAmount: D(0),
        whtAmount: D(150),
      },
    ],
    adjustments: [],
    amountReceived: D(850),
    incomeGross: D(1000),
    vatAmount: D(0),
    whtAmount: D(150),
    netReceived: D(850),
    totalAmount: D(1000),
  },

  /** กำไรขายโต๊ะให้ลูกค้านิติบุคคล — มี VAT 7%, WHT 1% */
  gainOnDisposal: {
    issueDate: new Date('2026-05-06'),
    paymentAccountCode: '11-1201',
    priceType: 'EXCLUSIVE' as const,
    customerId: 'cust-corp-1',
    items: [
      {
        lineNo: 1,
        accountCode: '42-1105',
        accountName: 'กำไรจากการจำหน่ายสินทรัพย์',
        quantity: D(1),
        unitAmount: D(10000),
        discountAmount: D(0),
        vatPct: D(7),
        whtPct: D(1),
        amountBeforeVat: D(10000),
        vatAmount: D(700),
        whtAmount: D(100),
      },
    ],
    adjustments: [],
    amountReceived: D(10600),
    incomeGross: D(10000),
    vatAmount: D(700),
    whtAmount: D(100),
    netReceived: D(10600),
    totalAmount: D(10700),
  },

  /** ลูกค้าจ่ายขาด 10 บาท (bank fee) — adjustment 10 บาท ลง 53-1503 */
  bankInterestWithFee: {
    issueDate: new Date('2026-05-06'),
    paymentAccountCode: '11-1201',
    priceType: 'EXCLUSIVE' as const,
    counterpartyName: 'ธนาคารกสิกรไทย',
    items: [
      {
        lineNo: 1,
        accountCode: '42-1102',
        accountName: 'ดอกเบี้ยเงินฝาก',
        quantity: D(1),
        unitAmount: D(1000),
        discountAmount: D(0),
        vatPct: D(0),
        whtPct: D(15),
        amountBeforeVat: D(1000),
        vatAmount: D(0),
        whtAmount: D(150),
      },
    ],
    adjustments: [
      { lineNo: 1, accountCode: '53-1503', amount: D(10), note: 'ค่าธรรมเนียมแบงก์' },
    ],
    amountReceived: D(840),
    incomeGross: D(1000),
    vatAmount: D(0),
    whtAmount: D(150),
    netReceived: D(850),
    totalAmount: D(1000),
  },
};
