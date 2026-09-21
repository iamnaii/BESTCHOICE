/** Preview by default. Apply explicitly with --apply after migrations/deployment. */
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const note = `อ้างอิง applehouseth.com ${snapshot.fetchedAt.slice(0, 10)} · เครื่องไทย แบต 80–100% มีกล่อง ประกันเหลือ ≥4 เดือน ไม่มีรอย/ตำหนิ · รวมโปรโมชัน ณ วันที่ดึงข้อมูล · เครื่องนอกและสภาพอื่นหักตามเกณฑ์ร้าน`;
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
    const existingKeys = existing.map(row => key(row.model, row.storage));
    if (new Set(existingKeys).size !== existingKeys.length) throw new Error('Duplicate normalized model/storage rows; reconcile before importing');
    for (const row of snapshot.rows) {
      const old = existing.find(x => key(x.model, x.storage) === key(row.model, row.storage));
      if (old?.deletedAt) { console.log(`SKIP deleted: ${row.model} ${row.storage}`); continue; }
      console.log(`${old ? 'UPDATE' : 'CREATE'} ${row.model} ${row.storage}: ${old?.basePrice ?? '-'} -> ${row.basePrice}`);
      if (apply) {
        const data = { basePrice: new Prisma.Decimal(row.basePrice), note };
        if (old) await tx.tradeInValuation.update({ where: { id: old.id }, data });
        else await tx.tradeInValuation.create({ data: { ...data, brand: 'Apple', model: row.model, storage: row.storage, condition: 'A' } });
      }
    }
    // Withdraw only recognisable source-managed rows absent from the new source.
    // Manual rows and soft-deleted rows are never silently resurrected or removed.
    for (const old of existing) {
      const sourceManaged = old.note?.includes('yellobe') || old.note === 'อ้างอิงราคาตลาด 2026-07-18' || old.note?.startsWith('อ้างอิง applehouseth.com ');
      if (!old.deletedAt && sourceManaged && !keys.has(key(old.model, old.storage))) {
        console.log(`WITHDRAW unavailable source price: ${old.model} ${old.storage}`);
        if (apply) await tx.tradeInValuation.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
      }
    }
  }, { timeout: 60000 });
  console.log(apply ? 'AppleHouse benchmark applied.' : 'PREVIEW ONLY — use --apply to write these changes.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
