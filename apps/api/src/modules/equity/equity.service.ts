import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, EquityDocStatus, EquityTxnType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { validatePeriodOpen } from '../../utils/period-lock.util';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { JeLineInput, JournalAutoService } from '../journal/journal-auto.service';
import { EquityDocNumberService } from './services/equity-doc-number.service';
import {
  buildEquityJournal,
  EQ_ACCOUNTS,
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

/** Advisory lock key ที่ใช้ serialize การโพสต์ CAP_INIT (กัน 2 ใบพร้อมกัน) */
const CAP_INIT_LOCK_KEY = 918273645;

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
    const seenIds = new Set<string>();
    ids.forEach((shareholderId, i) => {
      if (seenIds.has(shareholderId)) {
        throw new BadRequestException(`รายการที่ ${i + 1}: ผู้ถือหุ้นซ้ำในเอกสารเดียวกัน`);
      }
      seenIds.add(shareholderId);
    });
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
  private async assertInitOnce(
    excludeId?: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const other = await client.equityDocument.findFirst({
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

  // ─── Maker-checker (SystemConfig EQUITY_MAKER_CHECKER_ENABLED, default OFF) ─

  async isMakerCheckerEnabled(): Promise<{ enabled: boolean }> {
    try {
      const row = await this.prisma.systemConfig.findUnique({
        where: { key: 'EQUITY_MAKER_CHECKER_ENABLED' },
      });
      return { enabled: row?.value === 'true' };
    } catch {
      return { enabled: false };
    }
  }

  // ─── Workflow: submit / withdraw ────────────────────────────────────────

  /** DRAFT → READY (เมื่อ maker-checker เปิด) — validate ครบก่อนส่ง */
  async submit(id: string, userId: string) {
    const { enabled } = await this.isMakerCheckerEnabled();
    if (!enabled) {
      throw new BadRequestException('Maker-Checker ปิดอยู่ — กดลงบัญชีได้โดยตรง ไม่ต้องส่งอนุมัติ');
    }
    const doc = await this.findOne(id);
    if (doc.status !== 'DRAFT') {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ส่งอนุมัติได้เฉพาะร่าง`,
      );
    }
    this.assertDocValid(doc);
    if (doc.txnType === 'CAP_INIT') await this.assertInitOnce(id);

    const claimed = await this.prisma.equityDocument.updateMany({
      where: { id, status: 'DRAFT' },
      data: { status: 'READY' },
    });
    if (claimed.count === 0) {
      throw new ConflictException('เอกสารถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณารีโหลด');
    }
    await this.audit(userId, 'EQUITY_SUBMITTED', id, { docNumber: doc.docNumber });
    return this.findOne(id);
  }

  /** READY → DRAFT — maker เท่านั้น */
  async withdraw(id: string, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'READY') {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ถอนได้เฉพาะรออนุมัติ`,
      );
    }
    if (doc.makerId !== userId) {
      throw new ForbiddenException('เฉพาะผู้สร้างเอกสารจึงจะถอนกลับเป็นร่างได้');
    }
    await this.prisma.equityDocument.update({ where: { id }, data: { status: 'DRAFT' } });
    await this.audit(userId, 'EQUITY_WITHDRAWN', id, { docNumber: doc.docNumber });
    return this.findOne(id);
  }

  /** โยน BadRequestException เมื่อ validateEquityDoc ไม่ผ่าน (ใช้ตอน submit + post) */
  private assertDocValid(doc: Awaited<ReturnType<EquityService['findOne']>>) {
    const errors = validateEquityDoc(
      {
        txnType: doc.txnType,
        resolutionNo: doc.resolutionNo,
        resolutionDate: doc.resolutionDate,
        paymentAccountCode: doc.paymentAccountCode,
        paAccountCode: doc.paAccountCode,
        paAmount: doc.paAmount ? new D(doc.paAmount.toString()) : null,
        paDirection: doc.paDirection,
        lines: doc.lines.map((l) => ({
          shareholderId: l.shareholderId,
          amount: new D(l.amount.toString()),
          premium: new D(l.premium.toString()),
          paid: new D(l.paid.toString()),
          wht: new D(l.wht.toString()),
        })),
      },
      { hasAttachment: doc.attachments.length > 0 },
    );
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'ไม่ผ่านการตรวจสอบก่อนลงบัญชี', errors });
    }
  }

  // ─── GL guards ──────────────────────────────────────────────────────────

  /** ยอดคงเหลือทั้งบัญชี (POSTED, ไม่ลบ) — side 'cr' = ΣCr−ΣDr, 'dr' = ΣDr−ΣCr */
  private async accountBalance(
    client: Prisma.TransactionClient | PrismaService,
    accountCode: string,
    side: 'dr' | 'cr',
  ): Promise<Prisma.Decimal> {
    const expr = side === 'cr' ? 'jl.credit - jl.debit' : 'jl.debit - jl.credit';
    const rows = await client.$queryRawUnsafe<Array<{ balance: unknown }>>(
      `SELECT COALESCE(SUM(${expr}), 0)::decimal AS balance
       FROM journal_lines jl
       JOIN journal_entries je ON je.id = jl.journal_entry_id
       WHERE jl.account_code = $1
         AND jl.deleted_at IS NULL
         AND je.status = 'POSTED'
         AND je.deleted_at IS NULL`,
      accountCode,
    );
    return new D(String(rows[0]?.balance ?? 0));
  }

  // ─── Post (DRAFT→POSTED เมื่อ MC ปิด / READY→POSTED เมื่อ MC เปิด) ───────

  async post(id: string, userId: string) {
    const doc = await this.findOne(id);
    const { enabled: makerChecker } = await this.isMakerCheckerEnabled();

    if (makerChecker) {
      if (doc.status !== 'READY') {
        throw new ConflictException(
          `Maker-Checker เปิดอยู่ — เอกสารต้องผ่านการส่งอนุมัติก่อน (สถานะปัจจุบัน: ${doc.status})`,
        );
      }
      if (doc.makerId === userId) {
        throw new ForbiddenException('ผู้อนุมัติต้องไม่ใช่ผู้สร้างเอกสาร (Maker-Checker เปิดอยู่)');
      }
    } else if (doc.status !== 'DRAFT' && doc.status !== 'READY') {
      throw new ConflictException(`เอกสาร ${doc.docNumber} สถานะ ${doc.status} — ลงบัญชีซ้ำไม่ได้`);
    }

    this.assertDocValid(doc);
    if (doc.txnType === 'CAP_INIT') await this.assertInitOnce(id);

    const companyId = await this.companyResolver.getFinanceCompanyId();
    await validatePeriodOpen(this.prisma, doc.txnDate, companyId);

    const builderLines = this.toBuilderLines(doc.lines);
    const totalAmount = builderLines.reduce((s, l) => s.plus(l.amount), new D(0));

    // GL guards (อ่านยอดสด — เช็คซ้ำใน tx อีกรอบเพื่อปิด race)
    const runGlGuards = async (client: Prisma.TransactionClient | PrismaService) => {
      if (doc.txnType === 'DIV_PAY') {
        const payable = await this.accountBalance(client, EQ_ACCOUNTS.DIVIDEND_PAYABLE, 'cr');
        if (totalAmount.gt(payable)) {
          throw new BadRequestException(
            `V_DIV_PAY_LE_PAYABLE — ยอดจ่ายปันผล (${totalAmount.toFixed(2)}) เกินเงินปันผลค้างจ่ายในบัญชี 21-4104 (${payable.toFixed(2)}) — กรุณาบันทึกประกาศจ่ายปันผล (DIV_DEC) ก่อน`,
          );
        }
      }
      if (doc.txnType === 'CAP_DEC') {
        const capital = await this.accountBalance(client, EQ_ACCOUNTS.COMMON_STOCK, 'cr');
        if (totalAmount.gt(capital)) {
          throw new BadRequestException(
            `V_CAP_DEC_LE_CAPITAL — ยอดลดทุน (${totalAmount.toFixed(2)}) เกินหุ้นสามัญคงเหลือในบัญชี 31-1101 (${capital.toFixed(2)})`,
          );
        }
      }
    };
    await runGlGuards(this.prisma);

    // DIV_VS_RE — warning ไม่ block (ปันผลระหว่างกาลก่อนปิดปีทำได้) — ตอบกลับให้ UI แสดง
    let warning: string | null = null;
    if (doc.txnType === 'DIV_DEC') {
      const re = await this.accountBalance(this.prisma, EQ_ACCOUNTS.RETAINED_EARNINGS, 'cr');
      if (totalAmount.gt(re)) {
        warning = `DIV_VS_RE — ยอดปันผลที่ประกาศ (${totalAmount.toFixed(2)}) เกินกำไรสะสมในบัญชี 32-1101 (${re.toFixed(2)}) — ตรวจสอบว่าเป็นปันผลระหว่างกาลจากกำไรปีปัจจุบันจริง`;
      }
    }

    const jeLines = buildEquityJournal({
      txnType: doc.txnType,
      paymentAccountCode: doc.paymentAccountCode,
      paAccountCode: doc.paAccountCode,
      paAmount: doc.paAmount ? new D(doc.paAmount.toString()) : null,
      paDirection: doc.paDirection as PaDirection | null,
      lines: builderLines,
    });

    const posted = await this.prisma.$transaction(async (tx) => {
      // CAP_INIT — advisory lock + re-check ใต้ lock ก่อน CAS claim (กัน 2 ใบพร้อมกัน)
      if (doc.txnType === 'CAP_INIT') {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${CAP_INIT_LOCK_KEY})`);
        await this.assertInitOnce(id, tx); // re-check ใต้ lock — กัน race กับใบอื่นที่โพสต์พร้อมกัน
      }

      // CAS claim — กันโพสต์แข่งกัน
      const claimed = await tx.equityDocument.updateMany({
        where: { id, status: doc.status },
        data: { status: 'POSTED', approverId: userId, postedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new ConflictException('เอกสารถูกเปลี่ยนสถานะโดยผู้อื่นแล้ว — กรุณารีโหลด');
      }
      await runGlGuards(tx); // เช็คซ้ำใน tx ปิด race window

      const je = await this.journalAuto.createAndPost(
        {
          description: `ส่วนของผู้ถือหุ้น ${doc.txnType} ${doc.docNumber}${doc.description ? ` — ${doc.description}` : ''}`,
          reference: doc.id,
          companyId: doc.companyId,
          postedAt: doc.txnDate,
          metadata: {
            flow: 'equity',
            idempotencyKey: `equity:${doc.id}`,
            equityDocId: doc.id,
            docNumber: doc.docNumber,
            txnType: doc.txnType,
          },
          lines: jeLines.map<JeLineInput>((l) => ({
            accountCode: l.accountCode,
            dr: l.dr,
            cr: l.cr,
            description: l.description,
          })),
        },
        tx,
      );
      return tx.equityDocument.update({
        where: { id },
        data: { journalEntryId: je.id },
        include: { lines: true, attachments: true },
      });
    });

    await this.audit(userId, 'EQUITY_POSTED', id, {
      docNumber: doc.docNumber,
      txnType: doc.txnType,
      journalEntryId: posted.journalEntryId,
      totalAmount: totalAmount.toFixed(2),
      ...(warning ? { warning } : {}),
    });
    return { ...posted, warning };
  }

  // ─── Reverse (POSTED → REVERSED, mirror-reverse pattern interco) ────────

  async reverse(id: string, dto: ReverseEquityDocumentDto, userId: string) {
    const doc = await this.findOne(id);
    if (doc.status !== 'POSTED') {
      throw new ConflictException(
        `เอกสาร ${doc.docNumber} สถานะ ${doc.status} — กลับรายการได้เฉพาะที่ลงบัญชีแล้ว`,
      );
    }
    if (!doc.journalEntryId)
      throw new BadRequestException(`เอกสาร ${doc.docNumber} ไม่มี JE reference`);

    const companyId = await this.companyResolver.getFinanceCompanyId();
    await validatePeriodOpen(this.prisma, new Date(), companyId); // reversal ลงวันนี้

    const originalJe = await this.prisma.journalEntry.findUnique({
      where: { id: doc.journalEntryId },
      include: { lines: true },
    });
    if (!originalJe) throw new NotFoundException(`ไม่พบ JE ${doc.journalEntryId}`);

    const reversed = await this.prisma.$transaction(async (tx) => {
      const reversedLines: JeLineInput[] = originalJe.lines.map((l) => ({
        accountCode: l.accountCode,
        dr: new D(l.credit.toString()),
        cr: new D(l.debit.toString()),
        description: `[กลับรายการ] ${l.description ?? ''}`.trim(),
      }));

      let result: { id: string; entryNumber: string };
      try {
        result = await this.journalAuto.createAndPost(
          {
            description: `[กลับรายการ] ${doc.docNumber} — ${dto.reason}`,
            reference: `${originalJe.id}:equity-reverse`,
            companyId: originalJe.companyId,
            metadata: {
              tag: 'REVERSAL',
              flow: 'equity-reverse',
              idempotencyKey: `equity-reverse:${originalJe.id}`,
              originalEntryId: originalJe.id,
              reversesEntryId: originalJe.id,
              equityDocId: doc.id,
            },
            lines: reversedLines,
          },
          tx,
        );
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException('การกลับรายการเอกสารนี้ถูกลงบัญชีไปแล้ว (คำขอซ้ำ)');
        }
        throw err;
      }

      const meta = (originalJe.metadata ?? {}) as Record<string, unknown>;
      await tx.journalEntry.update({
        where: { id: originalJe.id },
        data: {
          metadata: {
            ...(meta as Prisma.InputJsonObject),
            reversed: true,
            reversedByEntryNumber: result.entryNumber,
          },
        },
      });

      return tx.equityDocument.update({
        where: { id },
        data: {
          status: 'REVERSED',
          reverseJournalEntryId: result.id,
          reverseReason: dto.reason,
          reversedAt: new Date(),
        },
        include: { lines: true, attachments: true },
      });
    });

    await this.audit(userId, 'EQUITY_REVERSED', id, {
      docNumber: doc.docNumber,
      reason: dto.reason,
      reverseJournalEntryId: reversed.reverseJournalEntryId,
    });
    return reversed;
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
