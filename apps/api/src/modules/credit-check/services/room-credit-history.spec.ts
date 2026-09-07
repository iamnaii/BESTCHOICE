import { Prisma } from '@prisma/client';
import { linkRoomCreditHistory } from './room-credit-history';
import { RoomManagerService } from '../../chat-engine/services/room-manager.service';
import { ForbiddenException } from '@nestjs/common';

describe('room credit customer history', () => {
  it.each([
    { latestId: 'imported', latestStatus: 'MANUAL_REVIEW', hasImport: true, shouldSync: true },
    { latestId: 'newer-approved', latestStatus: 'APPROVED', hasImport: true, shouldSync: false },
    { latestId: 'imported', latestStatus: 'APPROVED', hasImport: false, shouldSync: false },
  ])(
    'syncs customer review status only for a newly imported latest FULL: %j',
    async ({ latestId, latestStatus, hasImport, shouldSync }) => {
      const tx = {
        $queryRaw: jest.fn(),
        roomCreditAnalysis: {
          findMany: jest
            .fn()
            .mockResolvedValue(
              hasImport ? [{ id: 'analysis', createdAt: new Date(), fileIds: [], result: {} }] : [],
            ),
          update: jest.fn(),
        },
        creditCheck: {
          create: jest.fn().mockResolvedValue({ id: 'imported' }),
          findFirst: jest.fn().mockResolvedValue({ id: latestId, status: latestStatus }),
        },
        customer: { update: jest.fn() },
      };
      await linkRoomCreditHistory(tx as unknown as Prisma.TransactionClient, 'room', 'customer');
      if (shouldSync)
        expect(tx.customer.update).toHaveBeenCalledWith({
          where: { id: 'customer' },
          data: { creditCheckStatus: 'UNDER_REVIEW' },
        });
      else expect(tx.customer.update).not.toHaveBeenCalled();
    },
  );
  it("prevents a salesperson linking another staff member's room and importing its credit history", async () => {
    const tx = {
      $queryRaw: jest.fn(),
      chatRoom: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'room',
          customerId: null,
          deletedAt: null,
          assignedToId: 'other',
        }),
        update: jest.fn(),
      },
      customer: { findUnique: jest.fn().mockResolvedValue({ id: 'customer', deletedAt: null }) },
      roomCreditAnalysis: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const manager = Object.assign(Object.create(RoomManagerService.prototype), {
      prisma: { $transaction: (fn: (db: typeof tx) => unknown) => fn(tx) },
    }) as RoomManagerService;
    await expect(
      (manager.linkCustomer as (...args: unknown[]) => Promise<unknown>)('room', 'customer', {
        id: 'sales',
        role: 'SALES',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(tx.chatRoom.update).not.toHaveBeenCalled();
  });
  it('imports completed results once for manual review, without treating period totals as monthly averages', async () => {
    const source = {
      id: 'analysis',
      fileIds: ['f1'],
      createdAt: new Date(),
      result: { totalIncome: 60000, totalExpense: 30000, balance: 1200, dateRange: 'three months' },
    };
    const tx = {
      $queryRaw: jest.fn(),
      roomCreditAnalysis: { findMany: jest.fn().mockResolvedValue([source]), update: jest.fn() },
      creditCheck: {
        create: jest.fn().mockResolvedValue({ id: 'check' }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    await linkRoomCreditHistory(tx as unknown as Prisma.TransactionClient, 'room', 'customer');
    expect(tx.roomCreditAnalysis.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId: 'room', status: 'COMPLETED', creditCheckId: null, deletedAt: null },
      }),
    );
    expect(tx.creditCheck.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'customer',
          status: 'MANUAL_REVIEW',
          aiScore: null,
          statementAvgIncome: null,
          statementAvgExpense: null,
          statementAvgBalance: null,
          aiAnalysis: expect.objectContaining({
            source: 'chat-statement',
            roomId: 'room',
            totalIncome: 60000,
          }),
        }),
      }),
    );
    expect(tx.roomCreditAnalysis.update).toHaveBeenCalledWith({
      where: { id: 'analysis' },
      data: { creditCheckId: 'check' },
    });
    expect(tx.creditCheck.create.mock.calls[0][0].data.createdAt).toEqual(source.createdAt);
    expect(tx.creditCheck.create.mock.calls[0][0].data.checkType).toBe('FULL');
  });
});
