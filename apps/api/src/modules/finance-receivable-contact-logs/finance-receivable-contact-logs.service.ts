import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FinanceContactResult } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateFinanceContactLogDto,
  UpdateFinanceContactLogDto,
} from './dto/finance-receivable-contact-log.dto';
import { normalizeFinanceCompanyName } from './finance-company-name-normalizer.util';

@Injectable()
export class FinanceReceivableContactLogsService {
  constructor(private prisma: PrismaService) {}

  async record(
    receivableId: string,
    userId: string,
    dto: CreateFinanceContactLogDto,
  ) {
    const receivable = await this.prisma.financeReceivable.findFirst({
      where: { id: receivableId, deletedAt: null },
      select: {
        id: true,
        externalFinanceCompanyId: true,
        financeCompany: true,
        contactAttemptCount: true,
        lastPromisedDate: true,
      },
    });
    if (!receivable) throw new NotFoundException('ไม่พบรายการเงินรับจากไฟแนนซ์');

    return this.prisma.$transaction(async (tx) => {
      let companyId = receivable.externalFinanceCompanyId;

      // D6: lazy resolve — upsert ExternalFinanceCompany if receivable has no FK yet
      if (!companyId) {
        const normalized = normalizeFinanceCompanyName(receivable.financeCompany);
        const company = await tx.externalFinanceCompany.upsert({
          where: { name: receivable.financeCompany },
          create: {
            name: receivable.financeCompany,
            isActive: true,
          },
          update: {},
        });
        companyId = company.id;
        await tx.financeReceivable.update({
          where: { id: receivableId },
          data: { externalFinanceCompanyId: companyId },
        });
        // suppress unused-var warning for `normalized` until backfill script reuses it
        void normalized;
      }

      const contactedAt = dto.contactedAt ? new Date(dto.contactedAt) : new Date();
      const log = await tx.financeReceivableContactLog.create({
        data: {
          financeReceivableId: receivableId,
          externalFinanceCompanyId: companyId!,
          financeCompanyContactId: dto.financeCompanyContactId,
          contactedById: userId,
          contactedAt,
          channel: dto.channel ?? 'CALL',
          result: dto.result,
          notes: dto.notes,
          promisedDate: dto.promisedDate ? new Date(dto.promisedDate) : null,
          promisedAmount: dto.promisedAmount ?? null,
        },
      });

      // KPI denorm update — compute literal nextCount so tests can assert numeric value
      const nextLastPromised =
        dto.result === FinanceContactResult.PROMISED && dto.promisedDate
          ? new Date(dto.promisedDate)
          : receivable.lastPromisedDate;

      await tx.financeReceivable.update({
        where: { id: receivableId },
        data: {
          lastContactedAt: contactedAt,
          lastPromisedDate: nextLastPromised,
          contactAttemptCount: (receivable.contactAttemptCount ?? 0) + 1,
        },
      });

      return log;
    });
  }

  // stubs — implemented in Task 9
  async list(_receivableId: string) {
    return [];
  }
  async update(
    _receivableId: string,
    _logId: string,
    _userId: string,
    _userRole: string,
    _dto: UpdateFinanceContactLogDto,
  ) {
    throw new ForbiddenException('Not implemented');
  }
  async softDelete(_receivableId: string, _logId: string) {
    throw new ForbiddenException('Not implemented');
  }
}
