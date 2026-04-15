import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedChatRooms() {
  const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
  const customer2 = await prisma.customer.findFirst({ where: { deletedAt: null }, skip: 1 });
  const customer3 = await prisma.customer.findFirst({ where: { deletedAt: null }, skip: 2 });
  const staff = await prisma.user.findFirst({ where: { role: 'SALES', isActive: true } });
  const owner = await prisma.user.findFirst({ where: { role: 'OWNER', isActive: true } });
  const financeManager = await prisma.user.findFirst({ where: { role: 'FINANCE_MANAGER', isActive: true } });

  if (!customer || !staff || !owner) {
    console.log('Missing base data — run main seed first');
    return;
  }

  console.log('Customer 1:', customer.id, customer.name);
  console.log('Customer 2:', customer2?.id, customer2?.name);
  console.log('Customer 3:', customer3?.id, customer3?.name);
  console.log('Staff:', staff.id, staff.name);

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000);
  const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
  const daysAgo = (d: number) => new Date(now - d * 86_400_000);

  // ─── Room 1: LINE Finance — สมชาย (HOT, pinned, 3 unread) ────────────────
  // สนใจ iPhone 16 Pro ผ่อน
  const room1 = await prisma.chatRoom.create({
    data: {
      lineUserId: 'U_line_finance_' + customer.id.slice(0, 8),
      externalUserId: 'U_line_finance_' + customer.id.slice(0, 8),
      customerId: customer.id,
      channel: 'LINE_FINANCE',
      status: 'ACTIVE',
      assignedToId: staff.id,
      unreadCount: 3,
      totalMessages: 9,
      lastMessageAt: minutesAgo(5),
      leadScore: 88,
      leadTemperature: 'HOT',
      pinnedAt: hoursAgo(2),
      pinnedById: staff.id,
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room1.id,
        text: 'สวัสดีครับ สนใจผ่อน iPhone 16 Pro ครับ',
        role: 'CUSTOMER',
        createdAt: daysAgo(1),
      },
      {
        roomId: room1.id,
        text: 'สวัสดีครับคุณ ' + customer.name + ' ยินดีให้บริการครับ iPhone 16 Pro มีให้เลือกหลายความจุเลยครับ',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: new Date(daysAgo(1).getTime() + 3 * 60_000),
        readAt: new Date(daysAgo(1).getTime() + 5 * 60_000),
      },
      {
        roomId: room1.id,
        text: 'ขอดูราคา 256GB กับ 512GB ได้เลยไหมครับ',
        role: 'CUSTOMER',
        createdAt: new Date(daysAgo(1).getTime() + 10 * 60_000),
      },
      {
        roomId: room1.id,
        text: 'ได้เลยครับ\n• iPhone 16 Pro 256GB — 44,900 บาท\n• iPhone 16 Pro 512GB — 52,900 บาท\nผ่อนได้ 6–24 งวด ดาวน์ขั้นต่ำ 30% ครับ',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: new Date(daysAgo(1).getTime() + 12 * 60_000),
        readAt: new Date(daysAgo(1).getTime() + 15 * 60_000),
      },
      {
        roomId: room1.id,
        text: 'ถ้าผ่อน 12 งวด ดาวน์ 30% งวดละเท่าไหร่ครับ',
        role: 'CUSTOMER',
        createdAt: minutesAgo(30),
      },
      {
        roomId: room1.id,
        text: 'รุ่น 256GB ดาวน์ 13,470 บาท ผ่อน 12 งวดๆ ละ 2,946 บาทครับ (รวมดอกเบี้ย flat rate 1.5%/เดือน)',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: minutesAgo(25),
        readAt: minutesAgo(20),
      },
      {
        roomId: room1.id,
        text: '[sticker:11537:52002734]',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: minutesAgo(20),
        readAt: minutesAgo(18),
      },
      {
        roomId: room1.id,
        text: 'มีสีไหนบ้างครับ ตอนนี้มีของพร้อมส่งไหม',
        role: 'CUSTOMER',
        createdAt: minutesAgo(10),
      },
      {
        roomId: room1.id,
        text: 'สาขาลาดพร้าวเปิดถึงกี่โมงครับ จะแวะไปดูเครื่อง',
        role: 'CUSTOMER',
        createdAt: minutesAgo(5),
      },
    ],
  });

  // ─── Room 2: Facebook — สมชาย (WARM, 1 unread) — cross-channel ─────────────
  const room2 = await prisma.chatRoom.create({
    data: {
      lineUserId: 'FB_psid_' + customer.id.slice(0, 8),
      externalUserId: 'FB_psid_' + customer.id.slice(0, 8),
      customerId: customer.id,
      channel: 'FACEBOOK',
      status: 'ACTIVE',
      assignedToId: owner.id,
      unreadCount: 1,
      totalMessages: 5,
      lastMessageAt: hoursAgo(2),
      leadScore: 62,
      leadTemperature: 'WARM',
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room2.id,
        text: 'สวัสดีครับ เห็นโฆษณา iPhone ผ่อนได้ สนใจครับ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(5),
      },
      {
        roomId: room2.id,
        text: 'ยินดีต้อนรับครับ มีบริการผ่อน 0% ถึง 24 งวดครับ ต้องการดูเงื่อนไขไหมครับ',
        role: 'STAFF',
        staffId: owner.id,
        createdAt: hoursAgo(4),
        readAt: hoursAgo(3),
      },
      {
        roomId: room2.id,
        text: 'ต้องใช้เอกสารอะไรบ้างครับ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(3),
      },
      {
        roomId: room2.id,
        text: 'ใช้แค่บัตรประชาชนตัวจริง + สลิปเงินเดือนล่าสุด 1 ใบครับ ถ้ามีสเตทเมนต์ย้อนหลัง 3 เดือนยิ่งดีครับ',
        role: 'STAFF',
        staffId: owner.id,
        createdAt: hoursAgo(2),
        readAt: new Date(hoursAgo(2).getTime() + 5 * 60_000),
      },
      {
        roomId: room2.id,
        text: 'โอเคครับ จะเตรียมเอกสารไว้ก่อนนะครับ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(2),
      },
    ],
  });

  // ─── Room 3: LINE Shop — วิภาวดี (COLD, 0 unread, IDLE) ─────────────────────
  const cust2 = customer2 ?? customer;
  const room3 = await prisma.chatRoom.create({
    data: {
      lineUserId: 'U_shop_' + cust2.id.slice(0, 8),
      externalUserId: 'U_shop_' + cust2.id.slice(0, 8),
      customerId: cust2.id,
      channel: 'LINE_SHOP',
      status: 'IDLE',
      unreadCount: 0,
      totalMessages: 4,
      lastMessageAt: daysAgo(1),
      leadScore: 25,
      leadTemperature: 'COLD',
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room3.id,
        text: 'มีเคส iPhone 16 Pro สีดำไหมคะ',
        role: 'CUSTOMER',
        createdAt: daysAgo(2),
      },
      {
        roomId: room3.id,
        text: 'มีค่ะ เคส MagSafe สีดำ ราคา 890 บาท และเคสใสกันกระแทก 490 บาทค่ะ',
        role: 'BOT',
        createdAt: new Date(daysAgo(2).getTime() + 2 * 60_000),
      },
      {
        roomId: room3.id,
        text: 'เคส MagSafe มีรูปภาพไหมคะ',
        role: 'CUSTOMER',
        createdAt: daysAgo(1),
      },
      {
        roomId: room3.id,
        text: 'มีรูปภาพสินค้าค่ะ กรุณารอสักครู่ พนักงานกำลังส่งข้อมูลให้ค่ะ',
        role: 'BOT',
        createdAt: new Date(daysAgo(1).getTime() + 1 * 60_000),
      },
    ],
  });

  // ─── Room 4: LINE Finance — สมหญิง (HOT, 2 unread) — Samsung S25 ─────────────
  const cust3 = customer3 ?? customer2 ?? customer;
  const room4 = await prisma.chatRoom.create({
    data: {
      lineUserId: 'U_line_finance_' + cust3.id.slice(0, 8) + '_s25',
      externalUserId: 'U_line_finance_' + cust3.id.slice(0, 8) + '_s25',
      customerId: cust3.id,
      channel: 'LINE_FINANCE',
      status: 'ACTIVE',
      assignedToId: financeManager?.id ?? staff.id,
      unreadCount: 2,
      totalMessages: 6,
      lastMessageAt: minutesAgo(15),
      leadScore: 76,
      leadTemperature: 'HOT',
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room4.id,
        text: 'สวัสดีค่ะ อยากทราบราคา Samsung Galaxy S25 Ultra ผ่อนได้ไหมคะ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(1),
      },
      {
        roomId: room4.id,
        text: 'สวัสดีค่ะ Samsung Galaxy S25 Ultra ราคา 49,900 บาท ผ่อนได้ 6–24 งวดค่ะ',
        role: 'STAFF',
        staffId: financeManager?.id ?? staff.id,
        createdAt: new Date(hoursAgo(1).getTime() + 5 * 60_000),
        readAt: new Date(hoursAgo(1).getTime() + 8 * 60_000),
      },
      {
        roomId: room4.id,
        text: 'ดาวน์น้อยสุดเท่าไหร่คะ',
        role: 'CUSTOMER',
        createdAt: new Date(hoursAgo(1).getTime() + 15 * 60_000),
      },
      {
        roomId: room4.id,
        text: 'ดาวน์ขั้นต่ำ 30% ครับ คือ 14,970 บาท ผ่อน 12 งวดๆ ละ 3,078 บาทค่ะ',
        role: 'STAFF',
        staffId: financeManager?.id ?? staff.id,
        createdAt: new Date(hoursAgo(1).getTime() + 18 * 60_000),
        readAt: new Date(hoursAgo(1).getTime() + 20 * 60_000),
      },
      {
        roomId: room4.id,
        text: 'แล้วถ้าดาวน์ 50% ผ่อน 12 งวด งวดละเท่าไหร่คะ',
        role: 'CUSTOMER',
        createdAt: minutesAgo(20),
      },
      {
        roomId: room4.id,
        text: 'สามารถส่งสลิปเงินเดือนก่อนได้ไหมคะ จะคำนวณยอดที่แน่นอนให้ค่ะ',
        role: 'CUSTOMER',
        createdAt: minutesAgo(15),
      },
    ],
  });

  // ─── Room 5: LINE Finance — ลูกค้าเดิม (WARM, 0 unread) — ถามเรื่องค่างวด ──
  const room5 = await prisma.chatRoom.create({
    data: {
      lineUserId: 'U_line_finance_existing_' + customer.id.slice(0, 6),
      externalUserId: 'U_line_finance_existing_' + customer.id.slice(0, 6),
      customerId: customer.id,
      channel: 'LINE_FINANCE',
      status: 'ACTIVE',
      assignedToId: staff.id,
      unreadCount: 0,
      totalMessages: 7,
      lastMessageAt: hoursAgo(6),
      leadScore: 50,
      leadTemperature: 'WARM',
    },
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        roomId: room5.id,
        text: 'สวัสดีครับ อยากสอบถามยอดค้างชำระครับ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(8),
      },
      {
        roomId: room5.id,
        text: 'สวัสดีครับ ขอเบอร์โทรศัพท์ที่ลงทะเบียนไว้เพื่อตรวจสอบได้เลยครับ',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: new Date(hoursAgo(8).getTime() + 3 * 60_000),
        readAt: new Date(hoursAgo(8).getTime() + 5 * 60_000),
      },
      {
        roomId: room5.id,
        text: '0812345678 ครับ',
        role: 'CUSTOMER',
        createdAt: new Date(hoursAgo(8).getTime() + 7 * 60_000),
      },
      {
        roomId: room5.id,
        text: 'ตรวจสอบแล้วครับ มียอดค้างชำระ 2 งวด รวม 5,892 บาทครับ กำหนดชำระภายในวันที่ 25 ของเดือนนี้ครับ',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: hoursAgo(7),
        readAt: new Date(hoursAgo(7).getTime() + 10 * 60_000),
      },
      {
        roomId: room5.id,
        text: 'โอนผ่าน QR ได้ไหมครับ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(7),
      },
      {
        roomId: room5.id,
        text: 'ได้เลยครับ สแกน QR Code ที่ส่งให้ผ่าน LINE Pay หรือโอนผ่านธนาคารก็ได้ครับ',
        role: 'STAFF',
        staffId: staff.id,
        createdAt: new Date(hoursAgo(7).getTime() + 3 * 60_000),
        readAt: hoursAgo(6),
      },
      {
        roomId: room5.id,
        text: 'ขอบคุณมากครับ จะโอนในวันนี้เลยครับ',
        role: 'CUSTOMER',
        createdAt: hoursAgo(6),
      },
    ],
  });

  console.log('Mock chat data seeded!');
  console.log('Rooms: 5');
  console.log('  1. LINE Finance - ' + customer.name + ' (HOT, pinned, 3 unread) — iPhone 16 Pro');
  console.log('  2. Facebook - ' + customer.name + ' (WARM, 1 unread) — cross-channel');
  console.log('  3. LINE Shop - ' + cust2.name + ' (COLD, IDLE) — เคส');
  console.log('  4. LINE Finance - ' + cust3.name + ' (HOT, 2 unread) — Samsung S25 Ultra');
  console.log('  5. LINE Finance - ' + customer.name + ' (WARM, 0 unread) — ยอดค้างชำระ');
  console.log('Messages: 8+5+4+6+7 = 30 messages');
  console.log('Cross-channel: ' + customer.name + ' has LINE Finance x2 + Facebook');
}

seedChatRooms()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
