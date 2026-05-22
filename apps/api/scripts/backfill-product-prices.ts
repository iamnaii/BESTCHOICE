import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    include: { prices: { where: { deletedAt: null } } },
  });

  let updated = 0;
  let bothNull = 0;

  for (const p of products) {
    const prices = p.prices;
    const installmentPrice =
      prices.find(x => x.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      prices.find(x => x.label.startsWith('ราคาผ่อน'))?.amount ??
      null;

    const cashPrice =
      prices.find(x => x.label === 'ราคาเงินสด')?.amount ??
      prices.find(x => x.label.startsWith('ราคาเงินสด'))?.amount ??
      null;

    if (installmentPrice === null && cashPrice === null) {
      bothNull++;
      continue;
    }

    await prisma.product.update({
      where: { id: p.id },
      data: { installmentPrice, cashPrice },
    });
    updated++;
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    JSON.stringify({
      scanned: products.length,
      updated,
      bothNull,
      elapsedMs,
    }, null, 2),
  );
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
