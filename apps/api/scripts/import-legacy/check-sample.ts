import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  // Sample customer
  const cust = await p.customer.findUnique({ where: { legacyMemberCode: 'M00001' } });
  console.log('=== Customer M00001 ===');
  console.log('name:           ', cust?.name);
  console.log('phone:          ', cust?.phone);
  console.log('addressIdCard:  ', cust?.addressIdCard);
  console.log('addressCurrent: ', cust?.addressCurrent);
  console.log('addressWork:    ', cust?.addressWork);
  console.log('workplace:      ', cust?.workplace);
  console.log('occupation:     ', cust?.occupation);
  console.log('salary:         ', cust?.salary?.toString());
  console.log('references:     ', JSON.stringify(cust?.references, null, 2));
  console.log();
  console.log('=== Contract BCP2504-00001 ===');
  const c = await p.contract.findUnique({ where: { contractNumber: 'BCP2504-00001' } });
  if (!c) { console.log('not found'); return; }
  console.log('contractNumber:', c.contractNumber);
  console.log('sellingPrice:  ', c.sellingPrice.toString());
  console.log('downPayment:   ', c.downPayment.toString());
  console.log('financedAmount:', c.financedAmount.toString());
  console.log('storeCommission:', c.storeCommission?.toString());
  console.log('interestTotal: ', c.interestTotal.toString());
  console.log('interestRate:  ', c.interestRate.toString(), '(=' + (Number(c.interestRate) * 100).toFixed(1) + '%)');
  console.log('totalMonths:   ', c.totalMonths);
  console.log('monthlyPayment:', c.monthlyPayment.toString());
  console.log('status:        ', c.status);
  const total = Number(c.monthlyPayment) * c.totalMonths;
  const sum = Number(c.financedAmount) + Number(c.storeCommission || 0) + Number(c.interestTotal);
  console.log();
  console.log('total payments :', total);
  console.log('financed+com+int:', sum);
  console.log('diff           :', (total - sum).toFixed(2));
  await p.$disconnect();
})();
