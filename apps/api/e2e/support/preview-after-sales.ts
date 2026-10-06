/** Disposable preview: original intake/repair/accounting services, local storage and disabled outbound adapters. */
import { Controller, Post, NotImplementedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { StorageService } from '../../src/modules/storage/storage.service';
import { AfterSalesDocumentService } from '../../src/modules/after-sales/services/after-sales-document.service';
import { ChatServiceCaseLinkService } from '../../src/modules/after-sales/services/chat-service-case-link.service';
import { ChatWorkAccessService } from '../../src/modules/staff-chat/services/chat-work-access.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { RepairTicketsService } from '../../src/modules/repair-tickets/repair-tickets.service';
import { RepairTicketDocNumberService } from '../../src/modules/repair-tickets/services/doc-number.service';
import { ExpenseDocumentsService } from '../../src/modules/expense-documents/expense-documents.service';
import { ExpenseDocumentCreateService } from '../../src/modules/expense-documents/services/expense-document-create.service';
import { LineAggregatorService } from '../../src/modules/expense-documents/services/line-aggregator.service';
import { DocNumberService as ExpenseDocNumberService } from '../../src/modules/expense-documents/services/doc-number.service';
import { OtherIncomeLifecycleService } from '../../src/modules/other-income/services/other-income-lifecycle.service';
import { DocNumberService as OtherIncomeDocNumberService } from '../../src/modules/other-income/services/doc-number.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { SettingsFlagsService } from '../../src/modules/settings/services/settings-flags.service';

import { AfterSalesLookupService } from '../../src/modules/after-sales/services/after-sales-lookup.service';
import { AfterSalesCaseService } from '../../src/modules/after-sales/services/after-sales-case.service';
import { AfterSalesQueryService } from '../../src/modules/after-sales/services/after-sales-query.service';
import { AfterSalesRepairService } from '../../src/modules/after-sales/services/after-sales-repair.service';
import { AfterSalesLineService } from '../../src/modules/after-sales/services/after-sales-line.service';
import { AfterSalesDocNumberService } from '../../src/modules/after-sales/services/after-sales-doc-number.service';
import { AfterSalesService } from '../../src/modules/after-sales/after-sales.service';

export function previewAfterSales(
  db: PrismaService,
  storage: StorageService,
  actor: () => { id: string; branchId?: string | null },
) {
  const audit = new AuditService(db);
  const settings = new SettingsService(
    new SettingsFlagsService(db),
    null as never,
    null as never,
    null as never,
  );
  const expenseCreator = new ExpenseDocumentCreateService(
    db,
    new ExpenseDocNumberService(settings),
    new LineAggregatorService(),
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const expense = new ExpenseDocumentsService(db, null as never, null as never, expenseCreator);
  const income = new OtherIncomeLifecycleService(
    db,
    new OtherIncomeDocNumberService(db),
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const repair = new RepairTicketsService(
    db,
    audit,
    expense,
    {
      createDraftForRepair: (dto: never, tx: never) => income.createDraftForRepair(dto, tx),
    } as never,
    settings,
    new RepairTicketDocNumberService(db),
  );
  const unavailable = () => {
    throw new NotImplementedException(
      'ตัวอย่างนี้เปิดเฉพาะรับเรื่องและซ่อม การเปลี่ยนเครื่องตรวจใน isolated integration suite',
    );
  };
  const defect = {
    checkEligibility: async () => ({ eligible: false, reasons: ['ตัวอย่างนี้ทดสอบการซ่อม'] }),
  } as never;
  const photos = { getPhotos: async () => ({ photos: null }) } as never;
  const lookup = new AfterSalesLookupService(db, repair, defect, photos);
  const line = new AfterSalesLineService(
    db,
    { sendFromTemplate: async () => ({ status: 'DISABLED' }) } as never,
    { getValue: async () => '' } as never,
  );
  const links = new ChatServiceCaseLinkService(db, new ChatWorkAccessService(db));
  const cases = new AfterSalesCaseService(
    db,
    storage,
    audit,
    repair,
    new AfterSalesDocNumberService(db),
    lookup,
    { submit: unavailable } as never,
    defect,
    line,
    links,
  );
  const query = new AfterSalesQueryService(db);
  const repairProxy = new AfterSalesRepairService(db, storage, repair, query, audit, line);
  const exchange = new Proxy({}, { get: () => unavailable }) as never;
  const facade = new AfterSalesService(lookup, cases, query, repairProxy, exchange);
  const create = facade.createCase.bind(facade);
  facade.createCase = (dto, files, user) => {
    if (dto.outcome !== 'REPAIR') return unavailable();
    return create(dto, files, user);
  };
  @Controller('preview/service-cases')
  class FixtureController {
    @Post('fixture') async fixture() {
      const staff = actor();
      const branch = staff.branchId
        ? await db.branch.findUniqueOrThrow({ where: { id: staff.branchId } })
        : await db.branch.findFirstOrThrow({ where: { deletedAt: null } });
      const marker = randomUUID().slice(0, 8);
      const customer = await db.customer.create({ data: { name: `ลูกค้าหลังการขาย ${marker}` } });
      const room = await db.chatRoom.create({
        data: {
          displayName: `รับเรื่องทดลอง ${marker}`,
          channel: 'FACEBOOK',
          assignedToId: staff.id,
        },
      });
      await db.chatMessage.create({
        data: {
          roomId: room.id,
          role: 'CUSTOMER',
          text: 'จอสัมผัสไม่ตอบสนอง ช่วยตรวจเครื่องให้หน่อย',
        },
      });
      const supplier = await db.supplier.create({
        data: { name: `ศูนย์ซ่อมทดลอง ${marker}`, phone: '0800000000', isRepairCenter: true },
      });
      return {
        roomId: room.id,
        customerId: customer.id,
        customerName: customer.name,
        branchId: branch.id,
        supplierId: supplier.id,
        imei: `35${Date.now()}`,
      };
    }
  }
  return {
    controller: FixtureController,
    providers: [
      { provide: AfterSalesService, useValue: facade },
      { provide: AfterSalesDocumentService, useValue: { render: unavailable } },
    ],
  };
}
