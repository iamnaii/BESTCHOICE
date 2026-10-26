import * as Sentry from '@sentry/nestjs';
import { RecurringBillsController } from '../recurring-bills.controller';
import { ExpenseTemplatesController } from '../../expense-templates.controller';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

const user = { id: 'u-acc', branchId: 'br-1', role: 'ACCOUNTANT' };

describe('RecurringBillsController', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let service: any;
  let controller: RecurringBillsController;
  beforeEach(() => {
    service = {
      listMonth: jest.fn().mockResolvedValue({ month: '2026-10', summary: {}, rows: [] }),
      markPaid: jest.fn().mockResolvedValue({ id: 'occ-1' }),
      skip: jest.fn().mockResolvedValue({ id: 'occ-1' }),
      reopen: jest.fn().mockResolvedValue({ id: 'occ-1' }),
      createDraft: jest.fn().mockResolvedValue({ occurrenceId: 'occ-1' }),
    };
    controller = new RecurringBillsController(service);
  });
  it('passes the whole user plus query/dto to the service', async () => {
    await controller.list({ month: '2026-10', branchId: 'br-2' }, user);
    expect(service.listMonth).toHaveBeenCalledWith(user, '2026-10', 'br-2');
    await controller.markPaid('occ-1', { note: 'x' }, user);
    expect(service.markPaid).toHaveBeenCalledWith('occ-1', user, { note: 'x' });
    await controller.skip('occ-1', { reason: 'จ่ายล่วงหน้าแล้ว' }, user);
    expect(service.skip).toHaveBeenCalledWith('occ-1', user, { reason: 'จ่ายล่วงหน้าแล้ว' });
    await controller.reopen('occ-1', user);
    expect(service.reopen).toHaveBeenCalledWith('occ-1', user);
    await controller.createDraft('occ-1', user);
    expect(service.createDraft).toHaveBeenCalledWith('occ-1', user);
  });
});

describe('ExpenseTemplatesController — recurring bill hooks', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let templates: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let bills: any;
  let controller: ExpenseTemplatesController;
  beforeEach(() => {
    jest.clearAllMocks();
    templates = {
      create: jest.fn().mockResolvedValue({ id: 'tpl-1', isRecurring: true }),
      update: jest.fn().mockResolvedValue({ id: 'tpl-1', isRecurring: true, ruleChanged: true }),
    };
    bills = {
      generateForTemplate: jest.fn().mockResolvedValue({ created: ['2026-10'], revived: [], skippedMissed: [], skippedExisting: 0 }),
      retireOpenOccurrences: jest.fn().mockResolvedValue({ retired: 1 }),
    };
    controller = new ExpenseTemplatesController(templates, bills);
  });
  it('create of a recurring bill runs step A immediately as the saver (not the system user)', async () => {
    const res = await controller.create({ name: 'x' } as never, user);
    expect(res).toEqual({ id: 'tpl-1', isRecurring: true });
    expect(bills.generateForTemplate).toHaveBeenCalledWith('tpl-1', expect.any(Date), { id: 'u-acc', branchId: 'br-1', role: 'ACCOUNTANT' });
    expect(bills.retireOpenOccurrences).not.toHaveBeenCalled();
  });
  it('create of a plain template does nothing extra', async () => {
    templates.create.mockResolvedValue({ id: 'tpl-2', isRecurring: false });
    await controller.create({ name: 'x' } as never, user);
    expect(bills.generateForTemplate).not.toHaveBeenCalled();
  });
  it('update with ruleChanged retires open occurrences before regenerating; without ruleChanged only regenerates', async () => {
    await controller.update('tpl-1', { recurringDay: 10 } as never, user);
    expect(bills.retireOpenOccurrences).toHaveBeenCalledWith('tpl-1', 'แม่แบบเปลี่ยนรอบ', expect.objectContaining({ id: 'u-acc' }));
    expect(bills.generateForTemplate).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();
    templates.update.mockResolvedValue({ id: 'tpl-1', isRecurring: true, ruleChanged: false });
    await controller.update('tpl-1', { name: 'y' } as never, user);
    expect(bills.retireOpenOccurrences).not.toHaveBeenCalled();
    expect(bills.generateForTemplate).toHaveBeenCalledTimes(1);
  });
  it('a failure in step A never fails the save — it is reported to Sentry', async () => {
    bills.generateForTemplate.mockRejectedValue(new Error('no draft'));
    await expect(controller.create({ name: 'x' } as never, user)).resolves.toEqual({ id: 'tpl-1', isRecurring: true });
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
