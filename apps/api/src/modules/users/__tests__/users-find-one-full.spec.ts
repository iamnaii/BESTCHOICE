import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { EmployeesService } from '../../employees/employees.service';

/** ก้อน 7 A16 §13.1 — หน้าผู้ใช้ต้องเห็นสถานะผูก LINE พนักงาน (lineStaffUserId) + รหัสผูกที่ยังไม่หมดอายุ */
describe('UsersService.findOneFull — staff LINE link columns', () => {
  let service: UsersService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  beforeEach(async () => {
    prisma = { user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', name: 'สมหญิง', lineStaffUserId: 'Uabc', lineLinkCode: null, lineLinkCodeExpiresAt: null }) } };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmployeesService, useValue: { upsertProfileTx: jest.fn() } },
      ],
    }).compile();
    service = mod.get(UsersService);
  });

  it('selects lineStaffUserId + lineLinkCode + lineLinkCodeExpiresAt for the detail page', async () => {
    const row = await service.findOneFull('u1');
    expect(row.lineStaffUserId).toBe('Uabc');
    const select = prisma.user.findFirst.mock.calls[0][0].select;
    expect(select).toEqual(expect.objectContaining({ lineStaffUserId: true, lineLinkCode: true, lineLinkCodeExpiresAt: true, lineId: true }));
  });
  it('U4 exposes hasAttendancePin as a boolean and never returns the PIN hash (ก้อน 10 D3)', async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'u1', name: 'สมหญิง', attendancePinHash: 'deadbeef' });
    const row = (await service.findOneFull('u1')) as Record<string, unknown>;
    expect(row.hasAttendancePin).toBe(true);
    expect(row).not.toHaveProperty('attendancePinHash');
    prisma.user.findFirst.mockResolvedValueOnce({ id: 'u2', name: 'ต้น', attendancePinHash: null });
    const none = (await service.findOneFull('u2')) as Record<string, unknown>;
    expect(none.hasAttendancePin).toBe(false);
  });
});
