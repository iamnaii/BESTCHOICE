const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const p = new PrismaClient();

async function main() {
  console.log('Creating branch and admin user...');

  const branch = await p.branch.create({
    data: { name: 'สำนักงานใหญ่', code: 'HQ', address: '', phone: '', isActive: true },
  });

  const hash = await bcrypt.hash('1234', 10);

  await p.user.create({
    data: {
      email: 'akenarin.ak@gmail.com',
      password: hash,
      name: 'เอกนรินทร์ คงเดช',
      role: 'OWNER',
      branchId: branch.id,
      isActive: true,
    },
  });

  console.log('Done! Admin user created.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
