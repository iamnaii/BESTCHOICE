import { PrismaClient } from '@prisma/client';

/**
 * Seed chatbot-finance Knowledge Base entries.
 * Run: npx tsx apps/api/prisma/seeds/chatbot-kb.ts
 *
 * Idempotent: upserts by intent — safe to run multiple times.
 */

const prisma = new PrismaClient();

const KB_ENTRIES = [
  {
    intent: 'product_iphone',
    category: 'product',
    triggerKeywords: ['iPhone', 'ไอโฟน', 'มือถือ', 'รุ่นไหน', 'ราคา', 'สนใจ'],
    exampleQuestions: ['มี iPhone รุ่นไหนบ้าง', 'ราคา iPhone เท่าไหร่'],
    responseTemplate: 'เรามี iPhone หลายรุ่นทั้งมือ1 และมือ2 ค่ะ\n✅ บัตรประชาชน\n✅ ไม่เช็คเครดิตบูโร\n✅ อนุมัติ 15 นาที\n\nสนใจรุ่นไหนเป็นพิเศษไหมคะ?',
    responseType: 'auto',
    requiresAuth: false,
    priority: 70,
  },
  {
    intent: 'product_ipad',
    category: 'product',
    triggerKeywords: ['iPad', 'ไอแพด', 'แท็บเล็ต'],
    exampleQuestions: ['มี iPad ไหม', 'iPad รุ่นไหนบ้าง'],
    responseTemplate: 'เรามี iPad มือ1 (ใหม่จาก Apple) ค่ะ\n✅ บัตรประชาชนใบเดียว\n✅ ไม่เช็คเครดิตบูโร\n✅ อนุมัติ 15 นาที\n\nสนใจรุ่นไหนคะ?',
    responseType: 'auto',
    requiresAuth: false,
    priority: 65,
  },
  {
    intent: 'android_redirect',
    category: 'product',
    triggerKeywords: ['Samsung', 'ซัมซุง', 'OPPO', 'Vivo', 'Xiaomi', 'Android', 'แอนดรอยด์'],
    exampleQuestions: ['มี Samsung ไหม', 'อยากได้ Android'],
    responseTemplate: 'BESTCHOICE เชี่ยวชาญด้าน iPhone และ iPad โดยเฉพาะค่ะ ขณะนี้ยังไม่มีบริการสำหรับ Android\n\nสนใจลองดู iPhone ไหมคะ? ผ่อนง่าย บัตร ปชช. ใบเดียว อนุมัติ 15 นาทีค่ะ 😊',
    responseType: 'auto',
    requiresAuth: false,
    priority: 85,
  },
  {
    intent: 'ipad_used_redirect',
    category: 'product',
    triggerKeywords: ['iPad มือสอง', 'iPad มือ2', 'ไอแพดมือสอง'],
    exampleQuestions: ['มี iPad มือ2 ไหม'],
    responseTemplate: 'ขณะนี้เรามีเฉพาะ iPad มือ1 (ใหม่จาก Apple) ค่ะ ยังไม่มี iPad มือ2 ในสต็อก',
    responseType: 'auto',
    requiresAuth: false,
    priority: 65,
  },
  {
    intent: 'installment_documents',
    category: 'onboarding',
    triggerKeywords: ['เอกสาร', 'ใช้อะไรบ้าง', 'ผ่อนยังไง', 'เงื่อนไข', 'ขั้นตอน', 'สมัคร'],
    exampleQuestions: ['ผ่อนต้องใช้เอกสารอะไร', 'ขั้นตอนผ่อนยังไง'],
    responseTemplate: '📋 เอกสารที่ใช้:\n• บัตรประชาชน\n• ทะเบียนบ้าน\n• Slip เงินเดือน 3 เดือน\n\n📌 ขั้นตอน:\n1. ส่งเอกสาร\n2. รออนุมัติ ~15 นาที\n3. เซ็นสัญญา รับเครื่อง\n\n✅ ไม่เช็คเครดิตบูโรค่ะ',
    responseType: 'auto',
    requiresAuth: false,
    priority: 80,
  },
  {
    intent: 'complaint',
    category: 'escalation',
    triggerKeywords: ['ร้องเรียน', 'ไม่พอใจ', 'complaint', 'ผิดหวัง'],
    exampleQuestions: ['ขอร้องเรียน', 'ไม่พอใจ'],
    responseTemplate: 'ขอโทษที่ทำให้ไม่สะดวกนะคะ 🙏\nกำลังส่งเรื่องให้ผู้จัดการดูแลโดยตรง\nติดต่อกลับภายใน 24 ชม.\n📞 063-134-6356',
    responseType: 'handoff',
    requiresAuth: false,
    priority: 95,
  },
  {
    intent: 'payment_method',
    category: 'payment',
    triggerKeywords: ['จ่ายยังไง', 'ชำระยังไง', 'โอนเงิน', 'ชำระเงิน', 'วิธีจ่าย', 'บัญชี'],
    exampleQuestions: ['จ่ายค่างวดยังไง', 'โอนเงินไปไหน'],
    responseTemplate: 'ชำระค่างวดได้ 2 วิธีค่ะ\n\n💳 วิธีที่ 1: สแกน QR (แนะนำ)\nพิมพ์ "ชำระ" แล้วน้องเบสจะสร้าง QR ให้ค่ะ\n\n🏦 วิธีที่ 2: โอนเงิน\nธ.กสิกรไทย 203-1-16520-5\nชื่อ บจก. เบสท์ช้อยส์โฟน\nแล้วส่งสลิปมาในแชทนี้ได้เลยค่ะ',
    responseType: 'auto',
    requiresAuth: false,
    priority: 75,
  },
  {
    intent: 'late_fee_explain',
    category: 'payment',
    triggerKeywords: ['ค่าปรับ', 'ปรับ', 'ล่าช้า', 'ทำไมโดนปรับ', 'ค่าปรับกี่บาท'],
    exampleQuestions: ['ค่าปรับคิดยังไง', 'ทำไมโดนค่าปรับ'],
    responseTemplate: 'ค่าปรับล่าช้า 50 บาท/วัน นับจากวันที่เลยกำหนดค่ะ\n\n💡 ชำระตรงเวลา ไม่มีค่าปรับ + ได้แต้มสะสมด้วยนะคะ\n\nพิมพ์ "เช็คยอด" เพื่อดูยอดค้างชำระปัจจุบันค่ะ',
    responseType: 'auto',
    requiresAuth: false,
    priority: 70,
  },
  {
    intent: 'early_payoff_info',
    category: 'payment',
    triggerKeywords: ['ปิดยอด', 'ปิดก่อน', 'จ่ายหมด', 'ปิดสัญญา', 'ปิดค่างวด'],
    exampleQuestions: ['อยากปิดยอดก่อนกำหนด', 'ปิดสัญญาได้ไหม'],
    responseTemplate: 'สนใจปิดยอดก่อนกำหนดใช่ไหมคะ? ดีเลยค่ะ\n\n🎉 ปิดก่อนได้ส่วนลดดอกเบี้ย 50%!\n\nรบกวนแจ้งเจ้าหน้าที่เพื่อคำนวณยอดปิดให้นะคะ',
    responseType: 'handoff',
    requiresAuth: true,
    priority: 70,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const entry of KB_ENTRIES) {
    const existing = await prisma.chatKnowledgeBase.findFirst({
      where: { channel: 'LINE_FINANCE', intent: entry.intent },
    });

    if (existing) {
      await prisma.chatKnowledgeBase.update({
        where: { id: existing.id },
        data: { ...entry, active: true },
      });
      updated++;
    } else {
      await prisma.chatKnowledgeBase.create({
        data: { channel: 'LINE_FINANCE', ...entry },
      });
      created++;
    }
  }

  console.log(`KB seed done. Created: ${created}, Updated: ${updated}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
