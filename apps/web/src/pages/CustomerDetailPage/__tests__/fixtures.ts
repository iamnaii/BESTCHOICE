import type { ContractProgress, CustomerDetail } from '../types';

export const emptyPurchase = { installmentTotal: 0, installmentByState: { ACTIVE: 0, OVERDUE: 0, CLOSED: 0, BAD_DEBT: 0, OTHER: 0 }, cashCount: 0, externalFinanceCount: 0 };

export function detail(over: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'c1', nationalId: '', prefix: null, name: 'สมชาย ใจดี', nickname: null, isForeigner: false, birthDate: null,
    phone: '0812345678', chatPlaceholder: false, phoneSecondary: null, email: null, lineIdFinance: null, lineIdShop: null,
    facebookLink: null, facebookName: null, facebookFriends: null, googleMapLink: null, addressIdCard: null, addressCurrent: null,
    occupation: null, occupationDetail: null, salary: null, workplace: null, addressWork: null, references: null, documents: null,
    createdAt: '2024-04-05T03:00:00.000Z',
    contracts: [{
      id: 'k1', contractNumber: 'CT-2569-0042', status: 'ACTIVE', sellingPrice: '30000.00', monthlyPayment: '4200.00',
      totalMonths: 12, createdAt: '2026-03-05T03:00:00.000Z',
      product: { id: 'p1', name: 'iPhone 15', brand: 'Apple', model: 'iPhone 15' },
      branch: { id: 'b1', name: 'สำนักงานใหญ่' },
    }],
    sales: [],
    acquisitionSource: null, creditCheckStatus: 'NONE', tags: [], source: 'WALK_IN', purchase: emptyPurchase,
    latestPurchase: null, warranty: null, installmentBalance: null, chatRooms: [], lastContactAt: null, assignedTo: null, openContracts: [],
    ...over,
  };
}

export function progress(over: Partial<ContractProgress> = {}): ContractProgress {
  return {
    id: 'k1', contractNumber: 'CT-2569-0042', status: 'OVERDUE', productLabel: 'Apple iPhone 15 128GB', imeiSerial: null, branchName: 'สำนักงานใหญ่',
    startedAt: '2026-03-05T03:00:00.000Z', monthlyPayment: 4200, totalInstallments: 12, paidInstallments: 6, remainingInstallments: 6,
    overdueInstallments: 1, overdueAmount: 4200, outstanding: 25200, nextDueDate: '2026-10-05T00:00:00.000Z', nextAmountDue: 4200,
    firstOverdueInstallmentNo: 7, firstOverdueDueDate: '2026-09-05T00:00:00.000Z', mdmLocked: false,
    shopWarrantyEndDate: null, centerWarrantyEndDate: null, lastCall: null, ...over,
  };
}
