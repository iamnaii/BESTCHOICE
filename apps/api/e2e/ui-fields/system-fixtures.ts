import type { DocumentsHarness } from '../documents/support/harness';
import type { DocumentsWorld } from '../documents/support/fixtures';

/** Populated UI records only in the disposable harness. Domain suites separately
 * exercise posting, totals and transitions through the real API. */
export async function seedSystemUi(h: DocumentsHarness, world: DocumentsWorld) {
  const p = h.prisma;
  const today = new Date();
  const shop = await p.companyInfo.findUniqueOrThrow({ where: { companyCode: 'SHOP' } });
  const finance = await p.companyInfo.findUniqueOrThrow({ where: { companyCode: 'FINANCE' } });
  await p.branch.updateMany({ where: { id: { in: [world.branches.a.id, world.branches.b.id] } }, data: { companyId: shop.id } });
  const name = `ทดสอบระบบ ${world.prefix} ผู้จัดจำหน่ายชื่อยาวสำหรับตรวจหน้าจอมือถือ`;
  const contact = await p.contact.create({ data: { contactCode: `UI-${world.prefix}`, name, roles: ['SUPPLIER'], phone: '0800000001', email: 'ui@example.invalid' } });
  const supplier = await p.supplier.create({ data: { name, phone: '0800000001', contactId: contact.id, address: 'ทดสอบระบบ ที่อยู่จำลองเท่านั้น', hasVat: true } });
  const externalFinance = await p.externalFinanceCompany.create({ data: { name: `ทดสอบระบบ ไฟแนนซ์ ${world.prefix}`, contactPhone: '0800000002', contactPerson: 'ทดสอบระบบ ผู้ติดต่อ' } });
  const po = await p.purchaseOrder.create({ data: { poNumber: `TEST-PO-${world.prefix}`, supplierId: supplier.id, orderDate: today, totalAmount: '1000', netAmount: '1000', createdById: world.users.owner.id } });
  const receiving = await p.goodsReceiving.create({ data: { grNumber: `TEST-GR-${world.prefix}`, poId: po.id, receivedById: world.users.owner.id } });
  const template = await p.inspectionTemplate.create({ data: { name: 'ทดสอบระบบ แบบตรวจเครื่อง', deviceType: 'PHONE', items: { create: [{ category: 'ตัวเครื่อง', itemName: 'หน้าจอและตัวเครื่อง', scoreType: 'PASS_FAIL' }] } } });
  const inspection = await p.inspection.create({ data: { productId: world.contracts.a.productId, templateId: template.id, inspectorId: world.users.owner.id } });
  const afterSales = await p.afterSalesCase.create({ data: { caseNumber: `TEST-AS-${world.prefix}`, branchId: world.branches.a.id, customerId: world.customer.id, source: 'INSTALLMENT_CONTRACT', contractId: world.contracts.a.id, productId: world.contracts.a.productId, deviceBrand: 'Apple', deviceModel: 'iPhone ทดสอบระบบ', symptom: 'ทดสอบระบบ หน้าจอสัมผัสไม่ตอบสนองเป็นบางครั้ง', warrantySnapshot: { status: 'IN_WARRANTY', within7Days: true, daysRemainingIn7Day: 7, checkedAt: today.toISOString() }, receivedById: world.users.owner.id } });
  const expense = await p.expenseDocument.create({ data: { number: `TEST-EX-${world.prefix}`, documentType: 'EXPENSE', branchId: world.branches.a.id, documentDate: today, vendorName: name, vendorSupplierId: supplier.id, subtotal: '1000', totalAmount: '1000', netPayment: '1000', createdById: world.users.owner.id, expenseDetail: { create: { lines: { create: [{ lineNo: 1, category: 'S53-1101', description: 'ทดสอบระบบ ค่าใช้จ่ายสำหรับตรวจฟอร์ม', unitPrice: '1000', amountBeforeVat: '1000' }] } } } } });
  const shareholder = await p.shareholder.create({ data: { name: `ทดสอบระบบ ผู้ถือหุ้น ${world.prefix}` } });
  const equity = await p.equityDocument.create({ data: { docNumber: `TEST-EQ-${world.prefix}`, companyId: finance.id, txnType: 'CAP_INIT', txnDate: today, makerId: world.users.owner.id, description: 'ทดสอบระบบ ร่างทุนสำหรับตรวจฟอร์ม', lines: { create: [{ shareholderId: shareholder.id, shareholderName: shareholder.name, lineNo: 1, amount: '1000' }] } } });
  const assetData = { name: 'ทดสอบระบบ คอมพิวเตอร์สำหรับหน้าร้านและงานบริการลูกค้า', category: 'EQUIPMENT' as const, branchId: world.branches.a.id, basePrice: '12000', purchaseCost: '12000', usefulLifeMonths: 60, monthlyDepr: '200', netBookValue: '12000', purchaseDate: today, createdById: world.users.owner.id, vendorId: supplier.id, supplierName: name };
  const asset = await p.fixedAsset.create({ data: { ...assetData, assetCode: `TEST-UI-${world.prefix}`, docNo: `TEST-ASSET-${world.prefix}` } });
  const activeAsset = await p.fixedAsset.create({ data: { ...assetData, status: 'POSTED', postedAt: today, assetCode: `TEST-ACT-${world.prefix}`, docNo: `TEST-ACTIVE-${world.prefix}` } });
  const income = await p.otherIncome.create({ data: { docNumber: `TEST-OI-${world.prefix}`, companyId: finance.id, issueDate: today, paymentAccountCode: '11-1101', counterpartyName: name, createdById: world.users.owner.id, items: { create: [{ lineNo: 1, accountCode: '42-1108', accountName: 'ทดสอบระบบ รายได้อื่น', description: 'ทดสอบระบบ รายการร่างสำหรับตรวจหน้าจอ', quantity: '1', unitAmount: '1000', amountBeforeVat: '1000' }] } } });
  const portal = await p.customerAccessToken.create({ data: { token: `test-ui-${world.prefix}`, contractId: world.contracts.a.id, expiresAt: new Date(Date.now() + 86400000) } });
  const room = await p.chatRoom.create({ data: { customerId: world.customer.id, channel: 'LINE_SHOP', displayName: name, externalUserId: `TEST-NOT-SENT-${world.prefix}` } });
  await p.todo.create({ data: { title: 'ทดสอบระบบ งานตรวจแบบฟอร์มมือถือ', createdById: world.users.owner.id } });
  return { shop, finance, contact, supplier, externalFinance, po, receiving, inspection, afterSales, expense, equity, asset, activeAsset, income, portal, room };
}
