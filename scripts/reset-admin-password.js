const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const p = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('123456', 10);

  const user = await p.user.update({
    where: { email: 'akenarin.ak@gmail.com' },
    data: { password: hash },
  });

  console.log(`Password updated for ${user.email}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
