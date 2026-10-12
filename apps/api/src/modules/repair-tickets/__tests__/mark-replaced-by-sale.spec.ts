import { Test } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { RepairTicketsService } from '../repair-tickets.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ExpenseDocumentsService } from '../../expense-documents/expense-documents.service';
import { OtherIncomeService } from '../../other-income/other-income.service';
import { SettingsService } from '../../settings/settings.service';
import { RepairTicketDocNumberService } from '../services/doc-number.service';

const USER = { id: 'u-bm', role: 'BRANCH_MANAGER', branchId: 'b-1' };
const REF = { caseNumber: 'AS-20261012-0001', saleNumber: 'SL-0001' };

describe('RepairTicketsService.markReplacedBySale (PR 5 — ซ่อมไม่ได้ → เปลี่ยนรุ่นเดิมบนใบขายสด)', () => {
  let service: RepairTicketsService;
  let tx: any;
  let audit: any;

  beforeEach(async () => {
    tx = {
      repairTicket: {
        findUnique: jest.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      repairStatusLog: { create: jest.fn().mockResolvedValue({}) },
    };
    audit = { log: jest.fn() };
    const mod = await Test.createTestingModule({
      providers: [
        RepairTicketsService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: audit },
        { provide: ExpenseDocumentsService, useValue: {} },
        { provide: OtherIncomeService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: RepairTicketDocNumberService, useValue: {} },
      ],
    }).compile();
    service = mod.get(RepairTicketsService);
  });

  it('CAS OPEN/IN_PROGRESS/READY_FOR_PICKUP → REPLACED + replacedAt · replacementContractId คง null · log note อ้างเคส/ใบขาย · ไม่ audit ใน tx', async () => {
    const r = await service.markReplacedBySale('rt-1', REF, USER, tx);
    expect(r).toEqual({ fromStatus: 'IN_PROGRESS' });
    expect(tx.repairTicket.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'rt-1',
        status: { in: ['OPEN', 'IN_PROGRESS', 'READY_FOR_PICKUP'] },
        deletedAt: null,
      },
      data: { status: 'REPLACED', replacedAt: expect.any(Date) },
    });
    expect(tx.repairStatusLog.create).toHaveBeenCalledWith({
      data: {
        ticketId: 'rt-1',
        fromStatus: 'IN_PROGRESS',
        toStatus: 'REPLACED',
        changedById: 'u-bm',
        note: 'เปลี่ยนรุ่นเดิมบนใบขายสด SL-0001 · เคส AS-20261012-0001',
      },
    });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('ใบซ่อมปิดไปแล้ว (count 0) → 409 ไม่เขียน log', async () => {
    tx.repairTicket.findUnique.mockResolvedValue({ status: 'CLOSED' });
    tx.repairTicket.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markReplacedBySale('rt-1', REF, USER, tx)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.repairStatusLog.create).not.toHaveBeenCalled();
  });

  it('ไม่พบใบซ่อม → 404', async () => {
    tx.repairTicket.findUnique.mockResolvedValue(null);
    await expect(service.markReplacedBySale('rt-x', REF, USER, tx)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
