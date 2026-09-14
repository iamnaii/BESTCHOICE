import { Logger } from '@nestjs/common';
import { ChatChannel, MessageRole } from '@prisma/client';
import { WebWidgetGateway } from './web-widget.gateway';

/**
 * ผู้สนใจอัตโนมัติจากเว็บ (สเปค 3.2 — ทุกช่องทาง "ลูกค้าที่ทักเข้ามา")
 * ข้อความของผู้ชมเว็บเข้าทาง `widget:send` → roomManager.saveMessage ตรง ๆ ไม่ผ่าน routeInbound
 * ⇒ gateway ต้องขอผู้สนใจเองหลังบันทึกข้อความ CUSTOMER · เปิดหน้าเว็บเฉย ๆ (connect) ยังไม่สร้าง (Ruling R3)
 */
describe('WebWidgetGateway → ผู้สนใจอัตโนมัติ', () => {
  let roomManager: {
    getOrCreateRoom: jest.Mock;
    saveMessage: jest.Mock;
    ensureProspect: jest.Mock;
  };
  let gateway: WebWidgetGateway;
  let emit: jest.Mock;

  const makeClient = () => ({
    handshake: { query: { visitorId: 'visitor-1' } },
    join: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  });

  const connect = async (room: { id: string; customerId: string | null }) => {
    roomManager.getOrCreateRoom.mockResolvedValue({ ...room, channel: ChatChannel.WEB, totalMessages: 3 });
    const client = makeClient();
    await gateway.handleConnection(client as any);
    return client;
  };

  beforeEach(() => {
    // gateway log ทุก connect/ข้อความ — ปิดไว้ให้ผลเทสสะอาด
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    roomManager = {
      getOrCreateRoom: jest.fn(),
      saveMessage: jest.fn().mockResolvedValue({ id: 'msg-1', createdAt: new Date('2026-09-13T10:00:00Z') }),
      ensureProspect: jest.fn().mockResolvedValue('cust-web'),
    };
    gateway = new WebWidgetGateway(roomManager as any, {} as any);
    emit = jest.fn();
    gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as any;
  });

  afterEach(() => jest.restoreAllMocks());

  it('เปิดหน้าเว็บ (connect) อย่างเดียว → ไม่สร้างผู้สนใจ และไม่ส่งธง ensureProspect', async () => {
    await connect({ id: 'room-web', customerId: null });
    expect(roomManager.getOrCreateRoom).toHaveBeenCalledWith({ externalUserId: 'visitor-1', channel: ChatChannel.WEB });
    expect(roomManager.ensureProspect).not.toHaveBeenCalled();
  });

  it('ผู้ชมส่งข้อความในห้องที่ยังไม่มีเจ้าของ → บันทึกข้อความ CUSTOMER แล้วขอผู้สนใจของห้องนั้น', async () => {
    const client = await connect({ id: 'room-web', customerId: null });
    await gateway.handleMessage(client as any, { text: ' สนใจ iPhone 15 ' });
    expect(roomManager.saveMessage).toHaveBeenCalledWith({ roomId: 'room-web', role: MessageRole.CUSTOMER, text: 'สนใจ iPhone 15' });
    expect(roomManager.ensureProspect).toHaveBeenCalledWith('room-web');
    expect(roomManager.saveMessage.mock.invocationCallOrder[0]).toBeLessThan(
      roomManager.ensureProspect.mock.invocationCallOrder[0],
    );
    expect(emit).toHaveBeenCalledWith('widget:message', expect.objectContaining({ role: 'CUSTOMER', text: 'สนใจ iPhone 15' }));
  });

  it('ได้ผู้สนใจแล้ว → ข้อความถัดไปบน socket เดิมไม่ขอซ้ำ', async () => {
    const client = await connect({ id: 'room-web', customerId: null });
    await gateway.handleMessage(client as any, { text: 'ข้อความแรก' });
    await gateway.handleMessage(client as any, { text: 'ข้อความสอง' });
    expect(roomManager.saveMessage).toHaveBeenCalledTimes(2);
    expect(roomManager.ensureProspect).toHaveBeenCalledTimes(1);
  });

  it('สร้างผู้สนใจไม่สำเร็จ (คืน null) → ข้อความถัดไปลองใหม่ (self-heal)', async () => {
    roomManager.ensureProspect.mockResolvedValueOnce(null);
    const client = await connect({ id: 'room-web', customerId: null });
    await gateway.handleMessage(client as any, { text: 'ข้อความแรก' });
    await gateway.handleMessage(client as any, { text: 'ข้อความสอง' });
    expect(roomManager.ensureProspect).toHaveBeenCalledTimes(2);
  });

  it('ห้องมีเจ้าของอยู่แล้วตอน connect → ส่งข้อความไม่ขอผู้สนใจ', async () => {
    const client = await connect({ id: 'room-web', customerId: 'cust-1' });
    await gateway.handleMessage(client as any, { text: 'สวัสดี' });
    expect(roomManager.saveMessage).toHaveBeenCalledTimes(1);
    expect(roomManager.ensureProspect).not.toHaveBeenCalled();
  });

  it('ข้อความว่าง → ไม่บันทึกและไม่ขอผู้สนใจ', async () => {
    const client = await connect({ id: 'room-web', customerId: null });
    await gateway.handleMessage(client as any, { text: '   ' });
    expect(roomManager.saveMessage).not.toHaveBeenCalled();
    expect(roomManager.ensureProspect).not.toHaveBeenCalled();
  });
});
