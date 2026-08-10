import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, EquityDocStatus, EquityTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JournalAutoService } from '../journal/journal-auto.service';
import { EquityDocNumberService } from './services/equity-doc-number.service';
import {
  buildEquityJournal,
  EquityBuilderLine,
  NEEDS_SHAREHOLDERS,
  PaDirection,
} from './equity-journal.builder';
import { computeDefaultWht, validateEquityDoc } from './equity-validation.util';
import { CreateEquityDocumentDto, EquityLineDto } from './dto/create-equity-document.dto';
import { UpdateEquityDocumentDto } from './dto/update-equity-document.dto';
import { ReverseEquityDocumentDto } from './dto/reverse-equity-document.dto';
import { CreateShareholderDto, UpdateShareholderDto } from './dto/shareholder.dto';
import { ListEquityDto } from './dto/list-equity.dto';

const D = Prisma.Decimal;

@Injectable()
export class EquityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly docNumber: EquityDocNumberService,
    private readonly companyResolver: CompanyResolverService,
    private readonly journalAuto: JournalAutoService,
  ) {}

  // ─── Shareholders ────────────────────────────────────────────────────────

  listShareholders() {
    return this.prisma.shareholder.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  createShareholder(dto: CreateShareholderDto) {
    return this.prisma.shareholder.create({
      data: {
        name: dto.name,
        taxId: dto.taxId ?? null,
        shares: dto.shares ?? 0,
        sharePct: dto.sharePct != null ? new D(dto.sharePct) : null,
        type: dto.type ?? 'INDIVIDUAL',
        note: dto.note ?? null,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async updateShareholder(id: string, dto: UpdateShareholderDto) {
    const sh = await this.prisma.shareholder.findFirst({ where: { id, deletedAt: null } });
    if (!sh) throw new NotFoundException('ไม่พบผู้ถือหุ้น');
    return this.prisma.shareholder.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.taxId !== undefined ? { taxId: dto.taxId } : {}),
        ...(dto.shares !== undefined ? { shares: dto.shares } : {}),
        ...(dto.sharePct !== undefined ? { sharePct: new D(dto.sharePct) } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  // ─── Documents CRUD ──────────────────────────────────────────────────────

  async list(query: ListEquityDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const where: Prisma.EquityDocumentWhereInput = {
      deletedAt: null,
      ...(query.txnType ? { txnType: query.txnType as EquityTxnType } : {}),
      ...(query.status ? { status: query.status as EquityDocStatus } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.equityDocument.findMany({
        where,
        include: { lines: { orderBy: { lineNo: 'asc' } }, attachments: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.equityDocument.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const doc = await this.prisma.equityDocument.findFirst({
      where: { id, deletedAt: null },
      include: {
        lines: { orderBy: { lineNo: 'asc' }, include: { shareholder: true } },
        attachments: true,
        maker: { select: { id: true, name: true } },
        approver: { select: { id: true, name: true } },
      },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสาร');
    return doc;
  }

  /** แปลง DTO lines → snapshot rows พร้อม WHT default (DIV_PAY) — ใช้ทั้ง create/update/preview */
  private async resolveLines(txnType: EquityTxnType, dtoLines: EquityLineDto[]) {
    if (!NEEDS_SHAREHOLDERS.includes(txnType)) return [];
    const ids = dtoLines.map((l) => l.shareholderId);
    const shs = await this.prisma.shareholder.findMany({
      where: { id: { in: ids }, deletedAt: null },
    });
    const byId = new Map(shs.map((s) => [s.id, s]));
    return dtoLines.map((l, i) => {
      const sh = byId.get(l.shareholderId);
      if (!sh) throw new BadRequestException(`รายการที่ ${i + 1}: ไม่พบผู้ถือหุ้นในระบบ`);
      const amount = new D(l.amount);
      const wht =
        txnType === 'DIV_PAY'
          ? l.wht != null
            ? new D(l.wht)
            : computeDefaultWht(sh.type, amount)
          : new D(0);
      return {
        shareholderId: sh.id,
        shareholderName: sh.name,
        lineNo: i + 1,
        amount,
        premium: new D(l.premium ?? 0),
        paid: new D(l.paid ?? 0),
        wht,
      };
    });
  }

  private toBuilderLines(
    rows: {
      amount: Prisma.Decimal;
      premium: Prisma.Decimal;
      paid: Prisma.Decimal;
      wht: Prisma.Decimal;
    }[],
  ): EquityBuilderLine[] {
    return rows.map((r) => ({
      amount: new D(r.amount.toString()),
      premium: new D(r.premium.toString()),
      paid: new D(r.paid.toString()),
      wht: new D(r.wht.toString()),
    }));
  }

  /** V_INIT_ONCE — มี CAP_INIT อื่นที่ยังไม่ถูก reverse → ห้ามสร้าง/โพสต์ใบใหม่ */
  private async assertInitOnce(excludeId?: string) {
    const other = await this.prisma.equityDocument.findFirst({
      where: {
        txnType: 'CAP_INIT',
        status: { not: 'REVERSED' },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { docNumber: true },
    });
    if (other) {
      throw new ConflictException(
        `มีเอกสารเริ่มลงทุน (CAP_INIT) อยู่แล้ว (${other.docNumber}) — บันทึกได้ครั้งเดียว หากต้องการเพิ่มทุนให้ใช้ประเภท "เพิ่มทุน (CAP_INC)"`,
      );
    }
  }

  async create(dto: CreateEquityDocumentDto, userId: string) {
    if (dto.txnType === 'CAP_INIT') await this.assertInitOnce();
    const companyId = await this.companyResolver.getFinanceCompanyId();
    const lines = await this.resolveLines(dto.txnType, dto.lines ?? []);

    const created = await this.prisma.$transaction(async (tx) => {
      const txnDate = new Date(dto.txnDate);
      const docNumber = await this.docNumber.nextDocNumber(tx, txnDate);
      return tx.equityDocument.create({
        data: {
          docNumber,
          companyId,
          txnType: dto.txnType,
          status: 'DRAFT',
          txnDate,
          description: dto.description ?? null,
          resolutionNo: dto.resolutionNo ?? null,
          resolutionDate: dto.resolutionDate ? new Date(dto.resolutionDate) : null,
          paymentAccountCode: dto.paymentAccountCode ?? null,
          paAccountCode: dto.paAccountCode ?? null,
          paAmount: dto.paAmount != null ? new D(dto.paAmount) : null,
          paDirection: dto.paDirection ?? null,
          makerId: userId,
          lines: { create: lines },
        },
        include: { lines: true },
      });
    });

    await this.audit(userId, 'EQUITY_CREATED', created.id, {
      docNumber: created.docNumber,
      txnType: created.txnType,
    });
    return created;
  }

  async update(id: string, dto: UpdateEquityDocumentDto, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — แก้ไขได้เฉพาะร่าง`,
      );
    }
    const txnType = (dto.txnType ?? doc.txnType) as EquityTxnType;
    if (txnType === 'CAP_INIT') await this.assertInitOnce(id);
    const lines = dto.lines !== undefined ? await this.resolveLines(txnType, dto.lines) : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (lines !== null) {
        // แก้ร่าง = ลบทั้งชุดแล้วสร้างใหม่ (precedent interco updateBatch — ยังไม่มี JE อ้างถึง)
        await tx.equityShareholderLine.deleteMany({ where: { documentId: id } });
      }
      return tx.equityDocument.update({
        where: { id },
        data: {
          txnType,
          ...(dto.txnDate !== undefined ? { txnDate: new Date(dto.txnDate) } : {}),
          ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
          ...(dto.resolutionNo !== undefined ? { resolutionNo: dto.resolutionNo ?? null } : {}),
          ...(dto.resolutionDate !== undefined
            ? { resolutionDate: dto.resolutionDate ? new Date(dto.resolutionDate) : null }
            : {}),
          ...(dto.paymentAccountCode !== undefined
            ? { paymentAccountCode: dto.paymentAccountCode ?? null }
            : {}),
          ...(dto.paAccountCode !== undefined ? { paAccountCode: dto.paAccountCode ?? null } : {}),
          ...(dto.paAmount !== undefined
            ? { paAmount: dto.paAmount != null ? new D(dto.paAmount) : null }
            : {}),
          ...(dto.paDirection !== undefined ? { paDirection: dto.paDirection ?? null } : {}),
          ...(lines !== null ? { lines: { create: lines } } : {}),
        },
        include: { lines: true },
      });
    });
    await this.audit(userId, 'EQUITY_UPDATED', id, { docNumber: doc.docNumber });
    return updated;
  }

  async softDelete(id: string, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ลบได้เฉพาะร่าง`);
    }
    await this.prisma.equityDocument.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit(userId, 'EQUITY_DELETED', id, { docNumber: doc.docNumber });
    return { success: true };
  }

  /** Preview JE จาก payload ร่าง (wizard step 2) — single source of truth ฝั่ง server */
  async journalPreview(dto: CreateEquityDocumentDto) {
    const lines = await this.resolveLines(dto.txnType, dto.lines ?? []);
    const jeLines = buildEquityJournal({
      txnType: dto.txnType,
      paymentAccountCode: dto.paymentAccountCode ?? null,
      paAccountCode: dto.paAccountCode ?? null,
      paAmount: dto.paAmount != null ? new D(dto.paAmount) : null,
      paDirection: (dto.paDirection ?? null) as PaDirection | null,
      lines: this.toBuilderLines(lines),
    });
    const codes = [...new Set(jeLines.map((l) => l.accountCode))];
    const coa = await this.prisma.chartOfAccount.findMany({
      where: { code: { in: codes }, deletedAt: null },
      select: { code: true, name: true },
    });
    const nameByCode = new Map(coa.map((c) => [c.code, c.name]));
    return {
      lines: jeLines.map((l) => ({
        accountCode: l.accountCode,
        accountName: nameByCode.get(l.accountCode) ?? l.accountCode,
        debit: l.dr.toFixed(2),
        credit: l.cr.toFixed(2),
        description: l.description,
      })),
      resolvedLines: lines.map((l) => ({
        shareholderId: l.shareholderId,
        shareholderName: l.shareholderName,
        amount: l.amount.toFixed(2),
        premium: l.premium.toFixed(2),
        paid: l.paid.toFixed(2),
        wht: l.wht.toFixed(2),
      })),
    };
  }

  private async audit(
    userId: string,
    action: string,
    entityId: string,
    newValue: Prisma.InputJsonObject,
  ) {
    await this.prisma.auditLog.create({
      data: { userId, action, entity: 'equity_document', entityId, newValue },
    });
  }
}
