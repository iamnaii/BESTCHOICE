import { CreditCheckController, CustomerCreditCheckController } from './credit-check.controller';
import type { CreditCheckService } from './credit-check.service';
import type { CreateCreditCheckDto } from './dto/credit-check.dto';
import type { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { sanitizeJourneyData } from '../customer-journey/journey-data-schemas';

const DTO: CreateCreditCheckDto = { bankName: 'KBank', statementFiles: ['data:image/png;base64,QUJD'], statementMonths: 3 };
const USER = { id: 'sales-1' };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cc-1',
    customerId: 'customer-1',
    contractId: null,
    status: 'PENDING',
    createdAt: new Date(),
    customer: { id: 'customer-1', name: 'สมชาย ใจดี', phone: '0812345678', salary: 30000, occupation: 'พนักงาน' },
    ...overrides,
  };
}

function build() {
  const service = { create: jest.fn(), createForCustomer: jest.fn() };
  const journeyEntries = { recordAfterCommit: jest.fn().mockResolvedValue(undefined), recordInTx: jest.fn() };
  const svc = service as unknown as CreditCheckService;
  const writer = journeyEntries as unknown as JourneyEntryWriter;
  return {
    service,
    journeyEntries,
    contractController: new CreditCheckController(svc, writer),
    customerController: new CustomerCreditCheckController(svc, writer),
  };
}

describe('CREDIT_CHECK_OPENED_BY — ผู้เปิดตรวจเครดิต (service ทิ้ง _userId)', () => {
  it('POST /customers/:id/credit-check → entry ผูกพนักงานที่เปิด เวลา = createdAt ของใบ', async () => {
    const { service, journeyEntries, customerController } = build();
    const created = row();
    service.createForCustomer.mockResolvedValue(created);

    const res = await customerController.create('customer-1', DTO, USER);

    expect(res).toBe(created);
    expect(service.createForCustomer).toHaveBeenCalledWith('customer-1', DTO, 'sales-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledTimes(1);
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith({
      customerId: 'customer-1',
      kind: 'CREDIT_CHECK_OPENED_BY',
      occurredAt: created.createdAt,
      actorType: 'STAFF',
      actorUserId: 'sales-1',
      refType: 'credit_check',
      refId: 'cc-1',
      data: { via: 'CUSTOMER' },
      dedupeKey: 'CREDIT_CHECK_OPENED_BY:cc-1',
    });
    const opened = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(sanitizeJourneyData(opened.kind, opened.data)).toEqual({ ok: true, data: opened.data });
  });

  it('POST /contracts/:id/credit-check สร้างใบใหม่ → via CONTRACT และ customerId มาจากใบที่สร้าง', async () => {
    const { service, journeyEntries, contractController } = build();
    const created = row({ id: 'cc-2', customerId: 'customer-9', contractId: 'contract-1' });
    service.create.mockResolvedValue(created);

    await expect(contractController.create('contract-1', DTO, USER)).resolves.toBe(created);

    expect(service.create).toHaveBeenCalledWith('contract-1', DTO, 'sales-1');
    expect(journeyEntries.recordAfterCommit).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'customer-9',
        kind: 'CREDIT_CHECK_OPENED_BY',
        actorUserId: 'sales-1',
        refId: 'cc-2',
        data: { via: 'CONTRACT' },
        dedupeKey: 'CREDIT_CHECK_OPENED_BY:cc-2',
      }),
    );
  });

  it('อัปโหลดสเตทเม้นใหม่ให้ใบเดิมของสัญญา (createdAt เก่า) → ไม่ใช่การเปิดตรวจ ไม่เขียน entry', async () => {
    const { service, journeyEntries, contractController } = build();
    const existing = row({ contractId: 'contract-1', createdAt: new Date(Date.now() - 10 * 60_000) });
    service.create.mockResolvedValue(existing);

    await expect(contractController.create('contract-1', DTO, USER)).resolves.toBe(existing);
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('service ล้ม (ไม่พบลูกค้า) → โยน error เดิม ไม่เขียน entry', async () => {
    const { service, journeyEntries, customerController } = build();
    service.createForCustomer.mockRejectedValue(new Error('ไม่พบลูกค้า'));
    await expect(customerController.create('nope', DTO, USER)).rejects.toThrow('ไม่พบลูกค้า');
    expect(journeyEntries.recordAfterCommit).not.toHaveBeenCalled();
  });

  it('PDPA — entry ไม่มีชื่อ เบอร์ หรือเงินเดือนของลูกค้า', async () => {
    const { service, journeyEntries, customerController } = build();
    service.createForCustomer.mockResolvedValue(row());
    await customerController.create('customer-1', DTO, USER);
    const entry = journeyEntries.recordAfterCommit.mock.calls[0][0];
    expect(Object.keys(entry.data)).toEqual(['via']);
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('0812345678');
    expect(serialized).not.toContain('สมชาย');
    expect(serialized).not.toContain('salary');
  });
});
