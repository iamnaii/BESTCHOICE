import { creditHistoryAccess, roomAssignmentScope } from './room-credit-access';

describe('roomAssignmentScope', () => {
  it('SALES เห็นเฉพาะห้องที่ยังไม่มีผู้ดูแลหรือตัวเองดูแล · creditHistoryAccess ได้ where เดิมทุกบทบาท', () => {
    expect(roomAssignmentScope({ id: 's1', role: 'SALES' })).toEqual({ OR: [{ assignedToId: null }, { assignedToId: 's1' }] });
    expect(roomAssignmentScope({ id: 'o1', role: 'OWNER' })).toEqual({});
    expect(creditHistoryAccess()).toEqual({});
    expect(creditHistoryAccess({ id: 'a1', role: 'ACCOUNTANT' })).toEqual({ roomAnalysis: { is: null } });
    expect(creditHistoryAccess({ id: 's1', role: 'SALES' })).toEqual({
      OR: [{ roomAnalysis: { is: null } }, { roomAnalysis: { is: { deletedAt: null, room: { is: { deletedAt: null, OR: [{ assignedToId: null }, { assignedToId: 's1' }] } } } } }],
    });
    expect(creditHistoryAccess({ id: 'o1', role: 'OWNER' })).toEqual({
      OR: [{ roomAnalysis: { is: null } }, { roomAnalysis: { is: { deletedAt: null, room: { is: { deletedAt: null } } } } }],
    });
  });
});
