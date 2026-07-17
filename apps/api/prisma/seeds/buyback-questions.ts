import { Prisma, PrismaClient } from '@prisma/client';

type PrismaAny = PrismaClient & Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

type ChoiceSeed = { label: string; deductType: 'PERCENT' | 'FIXED'; deductValue: number };
type QuestionSeed = {
  key: string;
  title: string;
  helpText?: string;
  selectType: 'SINGLE' | 'MULTI';
  choices: ChoiceSeed[];
};

const questionData: QuestionSeed[] = [
  {
    key: 'device-origin',
    title: 'เครื่องศูนย์',
    selectType: 'SINGLE',
    choices: [
      { label: 'เครื่องศูนย์ไทย (TH)', deductType: 'FIXED', deductValue: 0 },
      { label: 'เครื่องนอก (โมเดลอื่น)', deductType: 'FIXED', deductValue: 1500 },
    ],
  },
  {
    key: 'warranty',
    title: 'ประกัน Apple',
    helpText: 'เช็คได้ที่ Settings > General > About หรือ checkcoverage.apple.com',
    selectType: 'SINGLE',
    choices: [
      { label: 'ประกันเหลือมากกว่า 4 เดือน', deductType: 'FIXED', deductValue: 0 },
      { label: 'ประกันเหลือน้อยกว่า 4 เดือน', deductType: 'FIXED', deductValue: 300 },
      { label: 'หมดประกัน', deductType: 'FIXED', deductValue: 500 },
    ],
  },
  {
    key: 'body-condition',
    title: 'สภาพตัวเครื่อง',
    selectType: 'SINGLE',
    choices: [
      { label: 'ไม่มีรอยขีดข่วน', deductType: 'PERCENT', deductValue: 0 },
      { label: 'มีรอยนิดหน่อย รอยเคส', deductType: 'PERCENT', deductValue: 8 },
      { label: 'มีรอยมาก ถลอก สีหลุด', deductType: 'PERCENT', deductValue: 18 },
      { label: 'ตัวเครื่องมีรอยตก / เบี้ยว / แตก / งอ', deductType: 'PERCENT', deductValue: 51 },
      { label: 'ฝาหลัง / กระจกหลังแตก', deductType: 'PERCENT', deductValue: 51 },
    ],
  },
  {
    key: 'screen-scratch',
    title: 'รอยหน้าจอ',
    selectType: 'SINGLE',
    choices: [
      { label: 'หน้าจอไม่มีรอย', deductType: 'PERCENT', deductValue: 0 },
      { label: 'หน้าจอมีรอยบางๆ', deductType: 'PERCENT', deductValue: 8 },
      { label: 'หน้าจอมีรอยสะดุด', deductType: 'PERCENT', deductValue: 18 },
      { label: 'หน้าจอมีรอยแตกชำรุด', deductType: 'PERCENT', deductValue: 70 },
    ],
  },
  {
    key: 'display',
    title: 'การแสดงผลหน้าจอ',
    selectType: 'SINGLE',
    choices: [
      { label: 'แสดงภาพปกติ', deductType: 'PERCENT', deductValue: 0 },
      { label: 'จุด Bright / ฝุ่นในจอ / ขอบจอเงา', deductType: 'PERCENT', deductValue: 35 },
      { label: 'จุด Dead / จุดสี / ลายเส้น / จอปลอม', deductType: 'PERCENT', deductValue: 70 },
      { label: 'ไม่สามารถแสดงภาพหน้าจอ', deductType: 'PERCENT', deductValue: 85 },
    ],
  },
  {
    key: 'battery',
    title: 'สุขภาพแบตเตอรี่',
    helpText: 'เช็คได้ที่ Settings > Battery > Battery Health',
    selectType: 'SINGLE',
    choices: [
      { label: 'แบตเตอรี่ 80% ขึ้นไป', deductType: 'FIXED', deductValue: 0 },
      { label: 'แบตเตอรี่ต่ำกว่า 80%', deductType: 'FIXED', deductValue: 1500 },
    ],
  },
  {
    key: 'box-accessories',
    title: 'กล่อง / อุปกรณ์',
    selectType: 'SINGLE',
    choices: [
      { label: 'มีกล่อง อุปกรณ์ครบ', deductType: 'FIXED', deductValue: 0 },
      { label: 'มีกล่อง อุปกรณ์ไม่ครบ', deductType: 'FIXED', deductValue: 200 },
      { label: 'ไม่มีกล่อง', deductType: 'FIXED', deductValue: 500 },
    ],
  },
  {
    key: 'functional-issues',
    title: 'ปัญหาการใช้งาน (เลือกได้หลายข้อ — ไม่เลือก = ไม่มีปัญหา)',
    selectType: 'MULTI',
    choices: [
      { label: 'ระบบสัมผัส (ทัชสกรีน)', deductType: 'PERCENT', deductValue: 75 },
      { label: 'WiFi / Bluetooth / GPS', deductType: 'PERCENT', deductValue: 85 },
      { label: 'ระบบสั่น', deductType: 'PERCENT', deductValue: 35 },
      { label: 'โทรออก-รับสาย / ไมค์ มีปัญหา', deductType: 'PERCENT', deductValue: 75 },
      { label: 'Face ID / สแกนนิ้ว', deductType: 'PERCENT', deductValue: 51 },
      { label: 'ลำโพงบน-ล่าง', deductType: 'PERCENT', deductValue: 35 },
      { label: 'กล้องหน้า-หลัง / แฟลช', deductType: 'PERCENT', deductValue: 70 },
      { label: 'Sensor', deductType: 'PERCENT', deductValue: 51 },
      { label: 'ปุ่มล็อก power / volume', deductType: 'PERCENT', deductValue: 35 },
    ],
  },
];

export async function seedBuybackQuestions(prisma: PrismaClient) {
  console.log('Seeding buyback questions...');
  const db = prisma as unknown as PrismaAny;
  let created = 0;
  let skipped = 0;

  for (let qi = 0; qi < questionData.length; qi++) {
    const q = questionData[qi];
    // idempotent by key — นับรวม soft-deleted (ห้ามคืนชีพของที่ owner ลบ)
    const existing = await db.buybackQuestion.findFirst({ where: { key: q.key } });
    if (existing) {
      skipped++;
      continue;
    }
    await db.buybackQuestion.create({
      data: {
        key: q.key,
        title: q.title,
        helpText: q.helpText ?? null,
        selectType: q.selectType,
        sortOrder: qi,
        choices: {
          create: q.choices.map((c, ci) => ({
            label: c.label,
            deductType: c.deductType,
            deductValue: new Prisma.Decimal(c.deductValue),
            sortOrder: ci,
          })),
        },
      },
    });
    created++;
  }
  console.log(`Buyback questions: ${created} created, ${skipped} skipped`);
}
