import { PrismaClient, ChatChannel, ChatRoomStatus, ChatPriority, MessageRole, MessageType } from '@prisma/client';

/**
 * Seed mock chat rooms + messages for testing the Unified Inbox.
 */
export async function seedMockChat(prisma: PrismaClient): Promise<void> {
  // Get existing customers and staff
  const customers = await prisma.customer.findMany({ take: 5, where: { deletedAt: null } });
  const staff = await prisma.user.findMany({
    where: { deletedAt: null, role: { in: ['OWNER', 'BRANCH_MANAGER', 'SALES'] } },
    take: 3,
  });

  if (customers.length === 0 || staff.length === 0) {
    console.log('[MockChat] No customers or staff found — skipping');
    return;
  }

  const now = new Date();
  const ago = (mins: number) => new Date(now.getTime() - mins * 60 * 1000);

  // ─── Room 1: Active LINE Finance chat (handoff from bot) ───
  const r1 = await prisma.chatRoom.create({
    data: {
      lineUserId: `mock-line-finance-${customers[0].id}`,
      customerId: customers[0].id,
      channel: ChatChannel.LINE_FINANCE,
      status: ChatRoomStatus.ACTIVE,
      priority: ChatPriority.HIGH,
      handoffMode: true,
      handoffReason: 'ลูกค้าต้องการคุยกับเจ้าหน้าที่',
      handoffTaggedAt: ago(15),
      totalMessages: 6,
      lastMessageAt: ago(2),
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'สวัสดีค่ะ สอบถามยอดค้างหน่อยค่ะ', createdAt: ago(30) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'สวัสดีค่ะ ดิฉันน้องเบส ผู้ช่วยของ BESTCHOICE ค่ะ กรุณาแจ้งเลขสัญญาด้วยนะคะ', createdAt: ago(29) },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'สัญญาเลขที่ BC-2026-0001 ค่ะ', createdAt: ago(25) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'สัญญา BC-2026-0001 มียอดค้าง 3 งวด รวม 7,500 บาทค่ะ งวดถัดไปกำหนดชำระ 15 เม.ย. 2569', createdAt: ago(24), toolsUsed: ['check_payment_status'] },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'อยากคุยกับเจ้าหน้าที่ค่ะ อยากขอผ่อนผันงวดนี้', createdAt: ago(20) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'ส่งต่อให้เจ้าหน้าที่แล้วนะคะ กรุณารอสักครู่ค่ะ', createdAt: ago(19) },
        ],
      },
    },
  });

  // ─── Room 2: Pending LINE Shop chat (assigned to sales) ───
  const r2 = await prisma.chatRoom.create({
    data: {
      lineUserId: `mock-line-shop-${customers[1].id}`,
      customerId: customers[1].id,
      channel: ChatChannel.LINE_SHOP,
      status: ChatRoomStatus.ACTIVE,
      priority: ChatPriority.NORMAL,
      assignedToId: staff[1]?.id,
      totalMessages: 4,
      lastMessageAt: ago(10),
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'สนใจ iPhone 16 Pro Max ครับ', createdAt: ago(60) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'สวัสดีค่ะ ขอบคุณที่สนใจสินค้าของเรานะคะ! iPhone 16 Pro Max มีหลายรุ่นค่ะ สนใจรุ่นไหนเป็นพิเศษคะ?', createdAt: ago(59) },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: '256GB ครับ สีดำ ผ่อนได้ไหม?', createdAt: ago(45) },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'ดาวน์เท่าไหร่ครับ?', createdAt: ago(10) },
        ],
      },
    },
  });

  // ─── Room 3: Facebook chat (open, unassigned) ───
  const r3 = await prisma.chatRoom.create({
    data: {
      lineUserId: `mock-fb-${customers[2]?.id || 'anon'}`,
      externalUserId: 'fb-psid-mock-12345',
      customerId: customers[2]?.id,
      channel: ChatChannel.FACEBOOK,
      status: ChatRoomStatus.ACTIVE,
      priority: ChatPriority.NORMAL,
      totalMessages: 3,
      lastMessageAt: ago(5),
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'ร้านเปิดกี่โมงครับ', createdAt: ago(8) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'สวัสดีค่ะ ร้านเปิดให้บริการทุกวัน 10:00 - 20:00 น. ค่ะ', createdAt: ago(7) },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'มีโปรโมชั่นอะไรบ้างครับ วันนี้', createdAt: ago(5) },
        ],
      },
    },
  });

  // ─── Room 4: Web widget (anonymous visitor) ───
  const r4 = await prisma.chatRoom.create({
    data: {
      lineUserId: 'web-visitor-mock-001',
      externalUserId: 'web-visitor-mock-001',
      channel: ChatChannel.WEB,
      status: ChatRoomStatus.ACTIVE,
      priority: ChatPriority.LOW,
      totalMessages: 2,
      lastMessageAt: ago(3),
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'สอบถามเรื่องผ่อน iPhone มือสอง หน่อยครับ', createdAt: ago(5) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'สวัสดีค่ะ ยินดีให้บริการค่ะ! iPhone มือสองสามารถผ่อนได้สูงสุด 10 งวด ดาวน์เริ่มต้น 30% ค่ะ สนใจรุ่นไหนคะ?', createdAt: ago(4) },
        ],
      },
    },
  });

  // ─── Room 5: Resolved chat (for history) ───
  const r5 = await prisma.chatRoom.create({
    data: {
      lineUserId: `mock-resolved-${customers[3]?.id || 'old'}`,
      customerId: customers[3]?.id,
      channel: ChatChannel.LINE_FINANCE,
      status: ChatRoomStatus.IDLE,
      priority: ChatPriority.NORMAL,
      assignedToId: staff[0]?.id,
      resolvedAt: ago(120),
      totalMessages: 5,
      lastMessageAt: ago(120),
      messages: {
        create: [
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'จ่ายค่างวดแล้วค่ะ ส่งสลิปให้', createdAt: ago(180) },
          { role: MessageRole.CUSTOMER, type: MessageType.IMAGE, text: 'slip.jpg', mediaUrl: 'slips/mock-slip.jpg', mediaType: 'image/jpeg', createdAt: ago(179) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'ได้รับสลิปแล้วค่ะ กำลังตรวจสอบนะคะ', createdAt: ago(178) },
          { role: MessageRole.STAFF, type: MessageType.TEXT, text: 'ตรวจสอบสลิปเรียบร้อยแล้วค่ะ ยอดตรง', staffId: staff[0]?.id, createdAt: ago(150) },
          { role: MessageRole.BOT, type: MessageType.TEXT, text: 'ชำระเงินเรียบร้อยค่ะ ขอบคุณนะคะ 🎉', createdAt: ago(149) },
        ],
      },
    },
  });

  // ─── Room 6: Critical overdue (needs attention) ───
  const r6 = await prisma.chatRoom.create({
    data: {
      lineUserId: `mock-critical-${customers[4]?.id || 'urgent'}`,
      customerId: customers[4]?.id,
      channel: ChatChannel.LINE_FINANCE,
      status: ChatRoomStatus.ACTIVE,
      priority: ChatPriority.CRITICAL,
      handoffMode: true,
      handoffReason: 'ลูกค้าค้างชำระเกิน 90 วัน — ต้องเจรจา',
      handoffTaggedAt: ago(60),
      totalMessages: 3,
      lastMessageAt: ago(1),
      messages: {
        create: [
          { role: MessageRole.AUTO_TRIGGER, type: MessageType.TEXT, text: '[ระบบ] แจ้งเตือน: สัญญา BC-2026-0005 ค้างชำระ 3 งวด (93 วัน)', createdAt: ago(60) },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'ช่วงนี้ลำบากมากค่ะ ขอผ่อนผันได้ไหม', createdAt: ago(5) },
          { role: MessageRole.CUSTOMER, type: MessageType.TEXT, text: 'ช่วยหน่อยนะคะ ไม่อยากโดนยึดเครื่อง', createdAt: ago(1) },
        ],
      },
    },
  });

  console.log(`[MockChat] Created 6 rooms: r1(ACTIVE/HIGH/handoff), r2(ACTIVE), r3(ACTIVE/FB), r4(ACTIVE/WEB), r5(IDLE/resolved), r6(CRITICAL/handoff)`);
}
