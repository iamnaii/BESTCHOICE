import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { TradeInService } from '../../src/modules/trade-in/trade-in.service';
import { TradeInVoucherService } from '../../src/modules/trade-in/services/voucher.service';
import { ContactResolverService } from '../../src/modules/contacts/contact-resolver.service';
import { CustomerPiiService } from '../../src/modules/customers/customer-pii.service';
import { JournalAutoService } from '../../src/modules/journal/journal-auto.service';
import { CompanyResolverService } from '../../src/modules/journal/company-resolver.service';
import { ShopTradeInTemplate } from '../../src/modules/journal/cpa-templates/shop-trade-in.template';
import { ShopAccountResolver } from '../../src/modules/journal/shop-account-resolver.service';
import { PiiAuditService } from '../../src/modules/pii/pii-audit.service';
import { BuybackQuestionAdminService } from '../../src/modules/trade-in/services/buyback-question-admin.service';
import { OnlineAppraisalService } from '../../src/modules/trade-in/services/online-appraisal.service';
import { ShopBuybackService } from '../../src/modules/shop-buyback/shop-buyback.service';
import { BuybackPricingService } from '../../src/modules/shop-buyback/buyback-pricing.service';
import { ContactsService } from '../../src/modules/contacts/contacts.service';
import { AuditService } from '../../src/modules/audit/audit.service';

export async function seedTradeInShop(db: PrismaService, branchName: string) {
  if (!process.env.DATABASE_URL?.includes('/bc_chat_credit_test?host=/tmp/bc-chat-credit.')) {
    throw new Error('Trade-in fixtures require the disposable PostgreSQL harness');
  }
  const shop = await db.companyInfo.upsert({
    where: { companyCode: 'SHOP' }, update: {},
    create: { companyCode: 'SHOP', nameTh: 'SHOP ตัวอย่าง Local', taxId: '0000000000000',
      address: 'ข้อมูลจำลองสำหรับทดสอบ', directorName: 'ผู้ทดสอบ' },
  });
  const user = await db.user.upsert({
    where: { email: 'admin@bestchoice.com' }, update: { accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' },
    create: { email: 'admin@bestchoice.com', name: 'ISOLATED TEST SYSTEM', password: 'unused', role: 'OWNER', accessibleCompanies: ['SHOP', 'FINANCE'], primaryCompany: 'SHOP' },
  });
  for (const [code, name] of [['S11-1102', 'เงินสดสาขาทดสอบ'], ['S11-1202', 'ธนาคาร SHOP จ่าย'], ['S11-2002', 'สินค้าคงคลังมือถือมือสอง']]) {
    await db.chartOfAccount.upsert({ where: { code }, update: {}, create: { code, name, type: 'สินทรัพย์', normalBalance: 'Dr' } });
  }
  const existing = await db.branch.findFirst({ where: { name: branchName } });
  const branch = existing
    ? await db.branch.update({ where: { id: existing.id }, data: { companyId: shop.id, shopCashAccountCode: 'S11-1102' } })
    : await db.branch.create({ data: { name: branchName, companyId: shop.id, shopCashAccountCode: 'S11-1102' } });
  const seller = await db.contact.upsert({ where: { contactCode: 'LOCAL-TRADE-IN-SELLER' }, update: {},
    create: { contactCode: 'LOCAL-TRADE-IN-SELLER', name: 'ผู้ขายตัวอย่าง Local', phone: '0000000000', roles: ['TRADE_IN_SELLER'] } });
  return { shop, branch, seller, user };
}

export function tradeInProviders(db: PrismaService, storage: StorageService) {
  const contacts = new ContactResolverService(db);
  const voucher = new TradeInVoucherService(db, storage);
  const tradeIn = new TradeInService(db, storage, voucher, contacts, new CustomerPiiService(db),
    new ShopTradeInTemplate(new JournalAutoService(db), db, new CompanyResolverService(db)), new ShopAccountResolver(db));
  const disabledLine = { sendFlexMessage: async () => { throw new Error('External messaging disabled in isolated tests'); } };
  return [
    { provide: TradeInService, useValue: tradeIn },
    { provide: TradeInVoucherService, useValue: voucher },
    PiiAuditService, BuybackQuestionAdminService,
    { provide: OnlineAppraisalService, useValue: new OnlineAppraisalService(db,
      new ShopBuybackService(db, disabledLine as never, new BuybackPricingService())) },
    { provide: ContactsService, useValue: new ContactsService(db, new AuditService(db), contacts) },
  ];
}
