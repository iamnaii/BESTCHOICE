import { MessageRole, MessageType } from '@prisma/client';
import { RoomManagerService } from './room-manager.service';

function makeFile(mimetype: string, originalname: string): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: 4,
    buffer: Buffer.from('abcd'),
    stream: undefined as never,
    destination: '',
    filename: originalname,
    path: '',
  };
}

function makeManager() {
  const prisma = {
    chatMessage: {
      create: jest.fn().mockResolvedValue({ id: 'm1' }),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    chatRoom: {
      findUnique: jest.fn().mockResolvedValue({ firstResponseAt: new Date() }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const storage = {
    configured: true,
    upload: jest.fn().mockResolvedValue('k'),
    getSignedDownloadUrl: jest.fn(
      async (key: string, ttl: number) => `https://signed.example/${key}?ttl=${ttl}`,
    ),
  };
  const messageRouter = {
    sendStaffMessage: jest.fn().mockResolvedValue({ success: true, message: { id: 'm1' } }),
  };
  const manager = new RoomManagerService(
    prisma as any,
    storage as any,
    undefined,
    messageRouter as any,
  );
  return { manager, prisma, storage, messageRouter };
}

describe('RoomManagerService.uploadFile — รูปต้องถึงลูกค้าจริง', () => {
  it('รูป → ส่งผ่าน sendStaffMessage ด้วย signed URL อายุ 6 วัน + persist storage key', async () => {
    const { manager, storage, messageRouter } = makeManager();
    const res = await manager.uploadFile('r1', makeFile('image/jpeg', 'promo.jpg'), 'u1', 'tok-1');

    expect(messageRouter.sendStaffMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: 'r1',
        staffId: 'u1',
        type: MessageType.IMAGE,
        mediaType: 'image/jpeg',
        clientMessageId: 'tok-1',
      }),
    );
    const arg = messageRouter.sendStaffMessage.mock.calls[0][0];
    expect(arg.mediaUrl).toMatch(/^staff-chat\/r1\//); // persist เป็น storage key
    expect(arg.deliveryMediaUrl).toContain('ttl=518400'); // 6 วัน
    expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(expect.any(String), 518400);
    expect(res.delivered).toBe(true);
  });

  it('ไฟล์ที่ไม่ใช่รูป → บันทึกเป็น STAFF (ไม่ใช่ BOT) และไม่ส่งออกช่องทาง', async () => {
    const { manager, prisma, messageRouter } = makeManager();
    const res = await manager.uploadFile('r1', makeFile('application/pdf', 'doc.pdf'), 'u1');

    expect(messageRouter.sendStaffMessage).not.toHaveBeenCalled();
    expect(prisma.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: MessageRole.STAFF,
          type: MessageType.FILE,
        }),
      }),
    );
    expect(res.delivered).toBe(false);
  });

  it('adapter ส่งไม่สำเร็จ → upload ยังสำเร็จ แต่ delivered=false + error ติดมา', async () => {
    const { manager, messageRouter } = makeManager();
    messageRouter.sendStaffMessage.mockResolvedValue({ success: false, error: 'LINE 400' });
    const res = await manager.uploadFile('r1', makeFile('image/png', 'a.png'), 'u1');

    expect(res.success).toBe(true);
    expect(res.delivered).toBe(false);
    expect(res.error).toBe('LINE 400');
  });

  it('ไฟล์ non-image + P2002 race (2 request ชนกันหลังผ่านเช็ค dedup) → คืนแถวเดิม ไม่ throw 500', async () => {
    const { manager, prisma } = makeManager();
    const p2002 = Object.assign(new Error('Unique constraint failed on the fields: (`room_id`,`client_message_id`)'), {
      code: 'P2002',
    });
    prisma.chatMessage.create.mockRejectedValueOnce(p2002);
    // เรียกครั้งที่ 1 (เช็ค dedup ก่อน upload, I1) — ยังไม่พบแถว จึงเดินเส้นปกติจนถึง
    // create; เรียกครั้งที่ 2 (ใน catch หลัง P2002) — คู่แข่งชนะ race ไปแล้วระหว่างนั้น
    // พอดี พบแถวที่ concurrent request สร้างไว้
    prisma.chatMessage.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'm-existing', clientMessageId: 'tok-retry' });

    const res = await manager.uploadFile('r1', makeFile('application/pdf', 'doc.pdf'), 'u1', 'tok-retry');

    expect(res.success).toBe(true);
    expect(res.delivered).toBe(false);
    expect(prisma.chatMessage.findFirst).toHaveBeenCalledTimes(2);
    expect(prisma.chatMessage.findFirst).toHaveBeenCalledWith({
      where: { roomId: 'r1', clientMessageId: 'tok-retry' },
    });
  });

  it('ไฟล์ non-image + retry clientMessageId เดิม (แถวมีอยู่แล้วจริง) → เช็คก่อน upload ไม่สร้างไฟล์ orphan ใน storage [I1]', async () => {
    const { manager, prisma, storage } = makeManager();

    // Attempt แรก: ยังไม่มีแถว → เดินเส้นปกติ (upload จริง 1 ครั้ง + save)
    prisma.chatMessage.findFirst.mockResolvedValueOnce(null);
    const res1 = await manager.uploadFile('r1', makeFile('application/pdf', 'doc.pdf'), 'u1', 'tok-retry');
    expect(res1.success).toBe(true);
    expect(storage.upload).toHaveBeenCalledTimes(1);

    // Attempt ที่สอง (retry ด้วย clientMessageId เดิม): จำลองว่าแถวจาก attempt แรกมีอยู่
    // แล้วจริงใน DB — findByClientMessageId ต้องเจอและ short-circuit ก่อนแตะ storage เลย
    prisma.chatMessage.findFirst.mockResolvedValue({
      id: 'm1',
      mediaUrl: res1.key,
      text: 'doc.pdf',
    });
    const res2 = await manager.uploadFile('r1', makeFile('application/pdf', 'doc.pdf'), 'u1', 'tok-retry');

    expect(res2.success).toBe(true);
    expect(res2.delivered).toBe(false);
    expect(res2.key).toBe(res1.key); // คืน key เดิม ไม่ใช่ key ใหม่จาก Date.now()
    // storageService.upload ถูกเรียกครั้งเดียวรวมทั้ง 2 attempt — retry ไม่ upload ซ้ำ
    expect(storage.upload).toHaveBeenCalledTimes(1);
  });
});
