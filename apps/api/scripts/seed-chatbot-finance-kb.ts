/**
 * Seed Knowledge Base สำหรับ Finance Bot
 * Source: docs/reports/KNOWLEDGE-BASE-FINANCE-BOT.md
 *
 * รัน: npx ts-node apps/api/scripts/seed-chatbot-finance-kb.ts
 */
import { PrismaClient, ChatChannel } from '@prisma/client';

const prisma = new PrismaClient();

interface KbEntry {
  intent: string;
  category: string;
  triggerKeywords: string[];
  exampleQuestions: string[];
  responseTemplate: string;
  responseType: 'auto' | 'handoff' | 'info';
  requiresAuth: boolean;
  requiresTools?: string[];
  priority: number;
}

const ENTRIES: KbEntry[] = [
  // ─── ค่าปรับ (Sensitive — pre-emptive answer) ───
  {
    intent: 'fee_31_days',
    category: 'fee_policy',
    triggerKeywords: ['31 วัน', 'เดือน 31', 'ทำไมต้องปรับ', 'ไม่เป็นธรรม'],
    exampleQuestions: [
      '1 ปีมีเดือนที่มี 31 วัน อย่างนี้ต้องโดนปรับทุกเดือน 50 บาทหรอคะ',
      'พี่ได้แจ้งทางร้านก่อนแล้วว่าบางเดือนมี 31 วัน อย่างนี้ต้องโดนปรับทุกเดือนหรือ',
    ],
    responseTemplate:
      'เข้าใจค่ะ ขอชี้แจงให้ชัดเจนนะคะ 🙏\n\n' +
      '📅 วันครบกำหนดของลูกค้าคือวันเดิมของทุกเดือนตามสัญญา\n' +
      '📌 ระบบคำนวณค่าปรับจากจำนวนวันที่เลย "วันครบกำหนดของลูกค้า" ' +
      'ไม่ได้คำนวณตามจำนวนวันของเดือน\n\n' +
      '💡 น้องเบสแนะนำให้ชำระล่วงหน้า 1-2 วันค่ะ และจะส่งแจ้งเตือนล่วงหน้า 5, 3, 1 วันให้นะคะ\n\n' +
      'หากมีข้อสงสัยเพิ่มเติม ติดต่อ 063-134-6356 ได้เลยค่ะ 😊',
    responseType: 'info',
    requiresAuth: false,
    priority: 100,
  },

  // ─── เลื่อนชำระ ───
  {
    intent: 'request_deferral',
    category: 'payment',
    triggerKeywords: ['ขอเลื่อน', 'เลื่อน', 'ไม่ทัน', 'ไม่มีจ่าย', 'พรุ่งนี้ได้ไหม', 'ขอผ่อนผัน'],
    exampleQuestions: [
      'ขอเลื่อนงวดนี้ได้ไหม',
      'จ่ายไม่ทัน รอเงินเดือน',
      'พี่ค่ะ ขอช้าวันสองวันได้ไหม',
    ],
    responseTemplate:
      'เข้าใจค่ะ ขอบคุณที่แจ้งล่วงหน้านะคะ 🙏\n\n' +
      'เรื่องการเลื่อนชำระต้องให้พี่เจ้าหน้าที่ดูแลให้นะคะ\n' +
      'น้องเบสจะส่งเรื่องให้ทันที พี่จะติดต่อกลับใน 2 ชั่วโมงค่ะ',
    responseType: 'handoff',
    requiresAuth: true,
    priority: 90,
  },

  // ─── ปลดล็อกเครื่อง ───
  {
    intent: 'unlock_device',
    category: 'device',
    triggerKeywords: ['ปลดล็อก', 'ปลดล็อค', 'เครื่องล็อก', 'ใช้ไม่ได้', 'lock'],
    exampleQuestions: [
      'ปลดล็อกให้หน่อย',
      'ปลดล็อกได้ยังคะ',
      'จ่ายแล้วยังไม่เห็นปลดล็อค',
    ],
    responseTemplate:
      'ขอเช็คให้นะคะ 🙏\n' +
      'น้องเบสจะส่งเรื่องให้พี่ที่ดูแลปลดล็อก\n' +
      '⏳ ดำเนินการภายใน 24 ชั่วโมงในเวลาทำการค่ะ',
    responseType: 'handoff',
    requiresAuth: true,
    priority: 80,
  },

  // ─── ปิดยอด/คืนเครื่อง ───
  {
    intent: 'early_close',
    category: 'contract',
    triggerKeywords: ['ปิดยอด', 'ปิดสัญญา', 'คืนเครื่อง', 'ปิดก่อน', 'หมดสัญญา'],
    exampleQuestions: [
      'อยากปิดยอด',
      'ขอปิดสัญญาก่อนได้ไหม',
      'ส่วนลดถ้าปิดมีไหม',
    ],
    responseTemplate:
      'ได้ค่ะ 😊\n' +
      'การปิดยอดก่อนกำหนดต้องให้พี่เจ้าหน้าที่คำนวณส่วนลดให้นะคะ\n' +
      'รอติดต่อกลับสักครู่ค่ะ',
    responseType: 'handoff',
    requiresAuth: true,
    priority: 75,
  },

  // ─── iCloud / Apple ID ───
  {
    intent: 'icloud_password',
    category: 'device',
    triggerKeywords: ['ลืมรหัส', 'iCloud', 'Apple ID', 'รหัสไอคราว', 'เปลี่ยนรหัส'],
    exampleQuestions: [
      'ลืมรหัส iCloud',
      'ขอเปลี่ยนรหัสไอคราว',
      'ลืมรหัสแอปเปิ้ลไอดี',
    ],
    responseTemplate:
      'เข้าใจค่ะ 🙏\n' +
      '1️⃣ Reset ผ่าน iforgot.apple.com ก่อนนะคะ\n' +
      '2️⃣ ถ้าไม่ได้ ต้องนำเครื่องมาที่ร้านค่ะ\n' +
      'หรือติดต่อช่าง 063-134-6356',
    responseType: 'info',
    requiresAuth: false,
    priority: 60,
  },

  // ─── WiFi / settings ───
  {
    intent: 'mdm_wifi_lock',
    category: 'device',
    triggerKeywords: ['ปิด wifi ไม่ได้', 'ปิดไวไฟ', 'ตั้งค่าไม่ได้', 'ปิดไม่ได้'],
    exampleQuestions: [
      'อันนี้คือล็อก WiFi ให้ปิดไม่ได้ด้วยหรอ',
      'ผมไม่สามารถปิดไวไฟได้',
    ],
    responseTemplate:
      'เป็นเรื่องปกติค่ะ ไม่ต้องกังวลนะคะ 😊\n' +
      'ระบบบริษัทล็อกการตั้งค่าบางอย่างไว้ระหว่างผ่อน\n' +
      '✅ ใช้งานทั่วไปได้ปกติ — เมื่อผ่อนหมด ระบบจะปลดอัตโนมัติค่ะ',
    responseType: 'info',
    requiresAuth: false,
    priority: 50,
  },

  // ─── เวลาทำการ / เบอร์ ───
  {
    intent: 'business_hours',
    category: 'info',
    triggerKeywords: ['เวลาทำการ', 'เปิดกี่โมง', 'ปิดกี่โมง', 'วันหยุด', 'เบอร์ติดต่อ', 'เบอร์โทร'],
    exampleQuestions: [
      'เวลาทำการกี่โมง',
      'ขอเบอร์ติดต่อ',
      'ปิดวันไหน',
    ],
    responseTemplate:
      '⏰ จันทร์-เสาร์ 9:00-18:00 (ปิดอาทิตย์)\n' +
      '📞 063-134-6356',
    responseType: 'auto',
    requiresAuth: false,
    priority: 40,
  },
];

async function main() {
  console.log('🌱 Seeding chatbot-finance knowledge base...');

  let created = 0;
  let updated = 0;

  for (const entry of ENTRIES) {
    const existing = await prisma.chatKnowledgeBase.findFirst({
      where: { channel: ChatChannel.LINE_FINANCE, intent: entry.intent },
    });

    if (existing) {
      await prisma.chatKnowledgeBase.update({
        where: { id: existing.id },
        data: {
          category: entry.category,
          triggerKeywords: entry.triggerKeywords,
          exampleQuestions: entry.exampleQuestions,
          responseTemplate: entry.responseTemplate,
          responseType: entry.responseType,
          requiresAuth: entry.requiresAuth,
          requiresTools: entry.requiresTools ?? [],
          priority: entry.priority,
          active: true,
        },
      });
      updated++;
    } else {
      await prisma.chatKnowledgeBase.create({
        data: {
          channel: ChatChannel.LINE_FINANCE,
          intent: entry.intent,
          category: entry.category,
          triggerKeywords: entry.triggerKeywords,
          exampleQuestions: entry.exampleQuestions,
          responseTemplate: entry.responseTemplate,
          responseType: entry.responseType,
          requiresAuth: entry.requiresAuth,
          requiresTools: entry.requiresTools ?? [],
          priority: entry.priority,
        },
      });
      created++;
    }
  }

  console.log(`✅ Done. Created: ${created}, Updated: ${updated}, Total: ${ENTRIES.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
