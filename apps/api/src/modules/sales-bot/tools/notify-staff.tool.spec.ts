import { NotifyStaffTool } from './notify-staff.tool';
import type { HandoffToHumanTool } from './handoff-to-human.tool';

describe('NotifyStaffTool.run', () => {
  it('ปักธงห้องผ่านตัวปักธงเดียวกับ handoff พร้อมเหตุผลที่พนักงานอ่านรู้เรื่อง', async () => {
    const handoff = { run: jest.fn().mockResolvedValue({ handoffAccepted: true }) };
    const tool = new NotifyStaffTool(handoff as unknown as HandoffToHumanTool);
    const r = await tool.run({ reason: 'iPhone 15 128GB ขอดูรูปเครื่องจริง', roomId: 'room-1' });
    expect(r).toEqual({ staffNotified: true });
    expect(handoff.run).toHaveBeenCalledWith({
      reason: '[บอทขอให้พนักงานตามต่อ] iPhone 15 128GB ขอดูรูปเครื่องจริง',
      roomId: 'room-1',
    });
  });

  it('เหตุผลว่าง → ใส่ข้อความตั้งต้น · เหตุผลยาวถูกตัดที่ 300 ตัวอักษร', async () => {
    const handoff = { run: jest.fn().mockResolvedValue({ handoffAccepted: true }) };
    const tool = new NotifyStaffTool(handoff as unknown as HandoffToHumanTool);
    await tool.run({ reason: '   ', roomId: 'r' });
    expect(handoff.run.mock.calls[0][0].reason).toBe('[บอทขอให้พนักงานตามต่อ] ลูกค้าขอข้อมูลเครื่องจริง');
    await tool.run({ reason: 'ก'.repeat(500), roomId: 'r' });
    expect(handoff.run.mock.calls[1][0].reason).toHaveLength('[บอทขอให้พนักงานตามต่อ] '.length + 300);
  });
});
