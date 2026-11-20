/** Preview by default. Apply explicitly with --apply after migrations/deployment. */
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APPLEHOUSE_NOTE_PREFIX, planAppleHouseImport } from './applehouse-import-plan';

const snapshot = JSON.parse(readFileSync(join(__dirname, 'data/applehouse-valuations.json'), 'utf8')) as {
  source: string; fetchedAt: string; rows: Array<{ model: string; storage: string; basePrice: number }>;
};
if (snapshot.source !== 'https://applehouseth.com/' || !Number.isFinite(Date.parse(snapshot.fetchedAt)) || !snapshot.rows.length) {
  throw new Error('Invalid AppleHouse snapshot');
}
const keys = new Set<string>();
const key = (model: string, storage: string) => `${model.toLowerCase()}|${storage.toLowerCase()}`;
for (const row of snapshot.rows) {
  const id = key(row.model, row.storage);
  if (keys.has(id) || !/^iPhone\b/i.test(row.model) || !/^\d+(GB|TB)$/.test(row.storage) || !Number.isSafeInteger(row.basePrice) || row.basePrice <= 0) {
    throw new Error(`Invalid/duplicate AppleHouse price: ${id}`);
  }
  keys.add(id);
}

const prisma = new PrismaClient();
async function main() {
  if (process.argv.includes('--validate-only')) {
    console.log(`Valid AppleHouse snapshot: ${snapshot.rows.length} prices collected ${snapshot.fetchedAt}`);
    return;
  }
  const apply = process.argv.includes('--apply');
  const note = `${APPLEHOUSE_NOTE_PREFIX}${snapshot.fetchedAt.slice(0, 10)} · เครื่องไทย แบต 80–100% มีกล่อง ประกันเหลือ ≥4 เดือน ไม่มีรอย/ตำหนิ · รวมโปรโมชัน ณ วันที่ดึงข้อมูล · เครื่องนอกและสภาพอื่นหักตามเกณฑ์ร้าน`;
  await prisma.$transaction(async tx => {
    const questions = await tx.buybackQuestion.findMany({
      where: { isActive: true, deletedAt: null },
      include: { choices: { where: { isActive: true, deletedAt: null } } },
    });
    if (!questions.length || questions.some(q => q.selectType === 'SINGLE' && !q.choices.length)) {
      throw new Error('Configure an active shop inspection questionnaire with choices before switching benchmark');
    }
    const reference = await tx.systemConfig.findFirst({ where: { key: 'sell_reference_pricing_v1', deletedAt: null } });
    if (reference) {
      const source = JSON.parse(reference.value)?.source;
      if (typeof source !== 'string' || !/^https:\/\/(www\.)?yellobe\.com\//.test(source)) throw new Error('Unexpected active reference pricing source; review before switching benchmark');
      console.log('DEACTIVATE Yellobe reference profiles; use shop questionnaire deductions with AppleHouse baseline.');
      if (apply) await tx.systemConfig.update({ where: { id: reference.id }, data: { deletedAt: new Date() } });
    }
    const existing = await tx.tradeInValuation.findMany({ where: {
      brand: { equals: 'Apple', mode: 'insensitive' }, condition: 'A',
    } });
    // Rules live in applehouse-import-plan.ts: shop-edited prices are kept, rows the
    // importer withdrew come back when the source prices them again, rows deleted
    // any other way stay deleted.
    const plan = planAppleHouseImport(existing, snapshot.rows, note);
    const now = new Date();
    for (const action of plan) {
      const label = `${action.model} ${action.storage}`;
      switch (action.kind) {
        case 'create':
          console.log(`เพิ่มรุ่น ${label}: ${action.basePrice}`);
          if (apply) await tx.tradeInValuation.create({ data: {
            brand: 'Apple', model: action.model, storage: action.storage, condition: 'A',
            basePrice: new Prisma.Decimal(action.basePrice), note: action.note,
          } });
          break;
        case 'update':
          console.log(`${action.from === action.basePrice ? 'ราคาเท่าเดิม' : 'ปรับราคา'} ${label}: ${action.from} -> ${action.basePrice}`);
          if (apply) await tx.tradeInValuation.update({ where: { id: action.id },
            data: { basePrice: new Prisma.Decimal(action.basePrice), note: action.note } });
          break;
        case 'restore':
          console.log(`เปิดรับซื้อกลับ ${label}: ${action.basePrice}`);
          if (apply) await tx.tradeInValuation.update({ where: { id: action.id },
            data: { basePrice: new Prisma.Decimal(action.basePrice), note: action.note, deletedAt: null } });
          break;
        case 'keep-shop-price':
          console.log(`คงราคาที่ร้านปรับเอง ${label}: ร้าน ${action.shopPrice} (AppleHouse ${action.sourcePrice})`);
          break;
        case 'skip-deleted':
          console.log(`ข้าม (ถูกลบในระบบ) ${label}`);
          break;
        case 'withdraw':
          console.log(`ปิดรับซื้อ (AppleHouse ไม่มีราคา) ${label}`);
          if (apply) await tx.tradeInValuation.update({ where: { id: action.id },
            data: { note: action.note, deletedAt: now } });
          break;
      }
    }
    const count = (kind: (typeof plan)[number]['kind']) => plan.filter(a => a.kind === kind).length;
    const changed = plan.filter(a => a.kind === 'update' && a.from !== a.basePrice).length;
    console.log(`สรุป: ปรับราคา ${changed} · เท่าเดิม ${count('update') - changed} · เพิ่ม ${count('create')} · เปิดกลับ ${count('restore')} · คงราคาร้าน ${count('keep-shop-price')} · ปิดรับซื้อ ${count('withdraw')} · ข้ามที่ถูกลบ ${count('skip-deleted')}`);
  }, { timeout: 60000 });
  console.log(apply ? 'AppleHouse benchmark applied.' : 'PREVIEW ONLY — use --apply to write these changes.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
