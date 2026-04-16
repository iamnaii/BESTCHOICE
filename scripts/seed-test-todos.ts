/**
 * Seed Go-Live Testing Todos — สร้าง Todo tasks สำหรับเทสระบบก่อนใช้งานจริง
 *
 * ใช้:
 *   npx tsx scripts/seed-test-todos.ts
 *
 * ต้อง: มี user accounts ใน DB แล้ว (แนน, กวาง, ตุ๊กตา)
 * Script จะหา user by name แล้ว assign todo ให้แต่ละคน
 *
 * ถ้ายังไม่มี user → สร้าง todo ทั้งหมดโดย assign ให้ user แรกที่เป็น OWNER
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

function checklist(items: string[]): ChecklistItem[] {
  return items.map((text) => ({ id: randomUUID(), text, done: false }));
}

async function main() {
  console.log('=== Seeding Go-Live Testing Todos ===\n');

  // Find users — try by name first, fall back to first OWNER
  const allUsers = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, role: true },
  });

  const findUser = (keyword: string) =>
    allUsers.find(
      (u) =>
        u.name?.includes(keyword) ||
        u.email?.toLowerCase().includes(keyword.toLowerCase()),
    );

  // เจ้าของ = OWNER คนแรก (คนที่ตั้งค่าระบบ + integrations)
  // แนน = หัวหน้าพนักงาน (เทส core flows + ตรวจรวม)
  // กวาง, ตุ๊กตา = พนักงาน (เทสตาม checklist)
  const owner = allUsers.find((u) => u.role === 'OWNER');
  const nan = findUser('แนน') || findUser('nan') || owner;
  const kwang = findUser('กวาง') || findUser('kwang') || nan;
  const tukta = findUser('ตุ๊กตา') || findUser('tukta') || nan;

  if (!owner) {
    console.error('❌ ไม่พบ OWNER user — สร้าง user accounts ก่อนรัน script นี้');
    process.exit(1);
  }

  console.log(`เจ้าของ: ${owner.name || owner.email} (${owner.id})`);
  console.log(`แนน: ${nan!.name || nan!.email} (${nan!.id})`);
  console.log(`กวาง: ${kwang!.name || kwang!.email} (${kwang!.id})`);
  console.log(`ตุ๊กตา: ${tukta!.name || tukta!.email} (${tukta!.id})`);

  // Delete existing test todos (by tag)
  await prisma.todo.deleteMany({ where: { tags: { has: 'go-live-test' } } });
  console.log('\nลบ todos เก่าที่มี tag go-live-test แล้ว\n');

  const todos = [
    // ═══════════════════════════════════════════
    // แนน — ตั้งค่า + Integrations + ตรวจรวม
    // ═══════════════════════════════════════════
    {
      title: '🔧 Phase 1: ตั้งค่าระบบ + Security',
      description:
        'ตั้งค่าบริษัท สาขา ข้อมูลธุรกิจจริง ก่อนให้ทีมเทส',
      assigneeId: owner.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-1', 'เจ้าของ'],
      checklist: checklist([
        'ตั้งค่าบริษัท /settings → ชื่อ, เลขผู้เสียภาษี, ที่อยู่, กรรมการ, ธนาคาร',
        'สร้าง/ตรวจสาขา /branches → ข้อมูลจริง',
        'ตั้งค่า General Settings → ค่าปรับ, ดอกเบี้ย, ดาวน์ขั้นต่ำ, งวดสูงสุด, prefixes',
        'ตรวจ Chart of Accounts → /financial-audit → ครบตาม PEAK',
        'เปลี่ยนรหัสผ่าน test accounts (ถ้ายังเป็น admin1234)',
        'ตรวจ /api/health → status: ok, database: ok',
        'ตรวจ /system-status → ดูสถานะทุก service',
      ]),
    },
    {
      title: '🔌 Phase 2: ต่อ Integrations ทั้งหมด',
      description:
        'ต่อระบบภายนอกทุกตัวผ่าน /settings/integrations',
      assigneeId: owner.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-2', 'เจ้าของ'],
      checklist: checklist([
        'LINE OA (Shop) → ใส่ credentials → Test Connection → ตั้ง webhook URL',
        'LINE OA (Finance) → ใส่ credentials → Test Connection → ตั้ง webhook URL',
        'LINE LIFF → ตรวจ LIFF ID ตรง → เทสเปิด LIFF จากมือถือ',
        'PaySolutions → ใส่ credentials → Test Connection → ตั้ง webhook URL',
        'SMS (ThaiBulkSMS) → ใส่ credentials → Test Connection',
        'Email (SMTP/Resend) → ตรวจ config → ทดสอบ forgot password',
        'MDM (PJ-Soft) → ใส่ credentials → Test Connection',
        'PEAK (บัญชี) → ใส่ credentials → Test Connection',
        'GCS/S3 Storage → ทดสอบอัพโหลดรูป → ตรวจ GCS bucket',
        'Sentry → ตรวจ DSN ตั้งค่าแล้ว → ทำให้เกิด error → ตรวจ Sentry dashboard',
      ]),
    },
    {
      title: '🏪 Phase 3: เทส Core Business Flows',
      description:
        'เทสทุก business flow ด้วยข้อมูลจริง/กึ่งจริงบน production',
      assigneeId: nan!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-3', 'แนน'],
      checklist: checklist([
        'เพิ่ม Supplier อย่างน้อย 1 ราย',
        'สร้าง PO + รับสินค้าเข้าสต็อก อย่างน้อย 5 ชิ้น',
        'สร้างลูกค้า + อัพโหลดบัตร ปชช.',
        'ขายเงินสดผ่าน POS → ตรวจ stock ลด + journal ถูก + ใบเสร็จ',
        'ขายผ่อนผ่าน POS → ตรวจคำนวณ (ดาวน์+งวด+ดอกเบี้ย+VAT)',
        'ตรวจสัญญา ACTIVE + ตารางผ่อนครบ + journal ถูก',
        'เซ็นสัญญา → PDF ถูก',
        'รับชำระค่างวด Manual → ตรวจ payment + journal',
        'รับชำระผ่าน PaySolutions QR → สแกนจ่ายจริง → ตรวจ webhook',
        'เทส LIFF → เปิดจากมือถือ → ดูสัญญา → ชำระ',
        'ตรวจ Dashboard KPI ถูก',
        'ตรวจ Trial Balance สมดุล',
        'ตรวจ Tax Report → VAT ถูก entity',
      ]),
    },
    {
      title: '👥 Phase 4: เตรียมให้ทีมเทส',
      description:
        'สร้าง account กวาง+ตุ๊กตา + เพิ่มสินค้าเข้าสต็อกให้พอเทส',
      assigneeId: owner.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'เจ้าของ'],
      checklist: checklist([
        'สร้าง account กวาง (OWNER)',
        'สร้าง account ตุ๊กตา (OWNER)',
        'เพิ่มสินค้าเข้าสต็อกให้พอเทส (อย่างน้อย 6 ชิ้น — คนละ 3)',
      ]),
    },
    {
      title: '✅ Phase 4: แนน ตรวจรวมหลังทีมเทส',
      description:
        'หลังกวาง+ตุ๊กตาเทสเสร็จ ตรวจว่าข้อมูลรวมถูกต้อง',
      assigneeId: nan!.id,
      priority: 'MEDIUM' as const,
      tags: ['go-live-test', 'phase-4', 'แนน'],
      checklist: checklist([
        'ตรวจ Audit Logs → เห็น action ของกวาง+ตุ๊กตา ถูกคน ถูกเวลา',
        'ตรวจ Dashboard KPI → ยอดขายรวมตรงกับที่ทีมทำ',
        'ตรวจ Trial Balance → Dr. = Cr. หลังทุกคนทำรายการ',
        'ตรวจ Tax Report → VAT ถูก entity',
        'ตรวจ Commission → คำนวณถูกทุกคน',
        'ตรวจ /system-status → ทุก service OK',
        'ตรวจ Sentry → ไม่มี unexpected errors',
        'ตรวจ /notifications → แสดงถูก',
      ]),
    },

    // ═══════════════════════════════════════════
    // กวาง
    // ═══════════════════════════════════════════
    {
      title: '🛒 กวาง: ขายเงินสด (1 รายการ)',
      description: 'เทสขายเงินสดครบ flow — สร้างลูกค้า → POS → ตรวจผล',
      assigneeId: kwang!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'กวาง'],
      checklist: checklist([
        'Login ได้',
        '/customers → สร้างลูกค้าใหม่ + อัพโหลดรูปบัตร ปชช.',
        '/pos → เลือกลูกค้า → เลือกสินค้า → ขายเงินสด',
        'ตรวจ /sales → เห็น sale record',
        'ตรวจ /stock → สินค้าหายจากสต็อก',
        'ตรวจ /receipts → ใบเสร็จสร้างอัตโนมัติ → พิมพ์ได้ → ข้อมูลถูก',
        'ตรวจ /financial-audit → journal Dr. Cash / Cr. Revenue ถูก',
      ]),
    },
    {
      title: '📝 กวาง: ขายผ่อน (1 รายการ)',
      description: 'เทสขายผ่อนครบ flow — POS → สัญญา → เซ็น → ตรวจ journal',
      assigneeId: kwang!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'กวาง'],
      checklist: checklist([
        '/pos → สร้างลูกค้าใหม่ → เลือกสินค้า → เลือกผ่อน',
        'กรอกดาวน์ + จำนวนงวด → ตรวจตัวเลขคำนวณถูก (เทียบเครื่องคิดเลข)',
        'ยืนยัน → สัญญาสร้างสำเร็จ',
        'ตรวจ /contracts → สถานะ ACTIVE + ตารางผ่อนครบ',
        'ตรวจ journal → Dr. HP Receivable / Cr. Revenue + VAT',
        'เซ็นสัญญา /contracts/{id}/sign → PDF สร้างได้ → ข้อมูลถูก',
      ]),
    },
    {
      title: '💰 กวาง: รับชำระค่างวด (Manual)',
      description: 'เทสรับชำระค่างวด manual — บันทึก + ตรวจ journal',
      assigneeId: kwang!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'กวาง'],
      checklist: checklist([
        'เปิดสัญญาที่สร้าง → กดรับชำระงวด 1',
        'ใส่จำนวนเงิน → บันทึก',
        'ตรวจ payment = PAID + งวด 1 mark ชำระแล้ว',
        'ตรวจ journal → Dr. Cash / Cr. HP Receivable + Commission + VAT',
      ]),
    },
    {
      title: '📱 กวาง: Trade-in (1 รายการ)',
      description: 'เทสรับซื้อมือสอง — ตรวจสภาพ → ตีราคา → เข้าสต็อก',
      assigneeId: kwang!.id,
      priority: 'MEDIUM' as const,
      tags: ['go-live-test', 'phase-4', 'กวาง'],
      checklist: checklist([
        '/trade-in → สร้างรายการรับซื้อ',
        'ตรวจสภาพ → ตีราคา → ยืนยัน',
        'ตรวจ สต็อกมือสองเพิ่ม',
        'ตรวจ journal → Dr. Inventory Used / Cr. Cash',
      ]),
    },
    {
      title: '📊 กวาง: ตรวจรายงาน',
      description: 'ตรวจว่ารายงานแสดงข้อมูลถูกต้อง',
      assigneeId: kwang!.id,
      priority: 'MEDIUM' as const,
      tags: ['go-live-test', 'phase-4', 'กวาง'],
      checklist: checklist([
        'Dashboard → KPI แสดงถูก',
        '/tax-reports → VAT ถูก',
        '/financial-audit → trial balance สมดุล',
      ]),
    },

    // ═══════════════════════════════════════════
    // ตุ๊กตา
    // ═══════════════════════════════════════════
    {
      title: '🛒 ตุ๊กตา: ขายเงินสด (1 รายการ)',
      description:
        'เทสขายเงินสด — คนละสินค้ากับกวาง',
      assigneeId: tukta!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'ตุ๊กตา'],
      checklist: checklist([
        'Login ได้',
        '/customers → สร้างลูกค้าใหม่ (คนละคนกับกวาง) + อัพโหลดรูป',
        '/pos → ขายเงินสด → สำเร็จ',
        'ตรวจ sales + stock + receipt + journal ถูก',
      ]),
    },
    {
      title: '📝 ตุ๊กตา: ขายผ่อน (1 รายการ)',
      description:
        'เทสขายผ่อน — คนละสินค้ากับกวาง',
      assigneeId: tukta!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'ตุ๊กตา'],
      checklist: checklist([
        '/pos → สร้างลูกค้าใหม่ → ผ่อน → ดาวน์ + งวด',
        'ตรวจคำนวณถูก (เทียบเครื่องคิดเลข)',
        'สัญญา ACTIVE + ตารางผ่อนครบ',
        'ตรวจ journal ถูก',
        'เซ็นสัญญา + PDF ถูก',
      ]),
    },
    {
      title: '💳 ตุ๊กตา: รับชำระผ่าน PaySolutions QR',
      description:
        'เทสชำระจริงผ่าน QR — ถ้าต่อ PaySolutions แล้ว',
      assigneeId: tukta!.id,
      priority: 'HIGH' as const,
      tags: ['go-live-test', 'phase-4', 'ตุ๊กตา'],
      checklist: checklist([
        'สร้าง payment link สำหรับงวดแรก',
        'สแกน QR จ่ายจริงด้วย mobile banking',
        'ตรวจ payment link = USED + payment auto + journal auto',
        'ตรวจ ลูกค้าได้ LINE แจ้งเตือน (ถ้าต่อ LINE แล้ว)',
      ]),
    },
    {
      title: '📱 ตุ๊กตา: ขายมือสองต่อ',
      description:
        'ขายสินค้ามือสองที่กวางรับซื้อ — ตรวจ Revenue account ถูก',
      assigneeId: tukta!.id,
      priority: 'MEDIUM' as const,
      tags: ['go-live-test', 'phase-4', 'ตุ๊กตา'],
      checklist: checklist([
        '/pos → ขายสินค้ามือสองที่กวาง trade-in',
        'ตรวจ Revenue account = 41-1102 (ขายมือสอง)',
      ]),
    },
    {
      title: '📄 ตุ๊กตา: เทสเอกสาร',
      description: 'พิมพ์สัญญา ใบเสร็จ สติ๊กเกอร์ — ตรวจความถูกต้อง',
      assigneeId: tukta!.id,
      priority: 'MEDIUM' as const,
      tags: ['go-live-test', 'phase-4', 'ตุ๊กตา'],
      checklist: checklist([
        'พิมพ์สัญญา PDF → ข้อมูลบริษัท ลูกค้า สินค้า ค่างวด ถูก',
        'พิมพ์ใบเสร็จ → เลข + จำนวนเงิน + VAT ถูก',
        '/stickers → สร้างสติ๊กเกอร์ราคา → พิมพ์ได้',
      ]),
    },

    // ═══════════════════════════════════════════
    // เทสร่วม
    // ═══════════════════════════════════════════
    {
      title: '🤝 เทสร่วม: ตรวจข้อมูลข้ามกัน',
      description:
        'หลังกวาง+ตุ๊กตาเสร็จ — ตรวจว่าเห็นข้อมูลของกันและกัน',
      assigneeId: nan!.id,
      priority: 'MEDIUM' as const,
      tags: ['go-live-test', 'phase-4', 'ร่วม'],
      checklist: checklist([
        'กวาง เห็นลูกค้า/สัญญา/sales ที่ตุ๊กตาสร้าง',
        'ตุ๊กตา เห็นลูกค้า/สัญญา/sales ที่กวางสร้าง',
        'แนน ตรวจยอดขายรวม = sales กวาง + sales ตุ๊กตา',
        'แนน ตรวจ trial balance สมดุลหลังทุกคนทำรายการ',
      ]),
    },
  ];

  // Create all todos
  for (const todo of todos) {
    await prisma.todo.create({
      data: {
        title: todo.title,
        description: todo.description,
        status: 'TODO',
        priority: todo.priority,
        createdById: owner.id,
        assigneeId: todo.assigneeId,
        tags: todo.tags,
        checklist: todo.checklist,
      },
    });
    console.log(`  ✅ ${todo.title}`);
  }

  console.log(`\n=== สร้าง ${todos.length} todos สำเร็จ ===`);
  console.log('เปิดดูได้ที่หน้า Todos ในระบบ');
}

main()
  .catch((err) => {
    console.error('❌ Seed todos failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
