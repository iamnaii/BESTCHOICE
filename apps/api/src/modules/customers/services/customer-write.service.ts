import { CustomerDocumentsService } from './customer-documents.service';
import { UploadDocumentDto } from '../dto/document.dto';
import { procurementPreparation } from '../../employee-access/access-preparation-context';
import { domainAccessClient } from '../../employee-access/access-execution-context';
import {
  AccessPartySourceService,
  partyWriteExecution,
} from '../../employee-access/access-party-source.service';
import type {
  CustomerFillContactAcknowledgement,
  CustomerContactChangedField,
} from '@installment/shared';
import { isValidThaiNationalId } from '@installment/shared';
import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { FillProspectContactDto } from '../dto/fill-prospect-contact.dto';
import { encryptPII } from '../../../utils/crypto.util';
import { hashPII, encryptReferencesJson } from '../../../utils/pii.util';
import { normalizeThaiPhone } from '../../../utils/thai-phone.util';
import { CustomerPiiService } from '../customer-pii.service';
import { lockCustomerPhone } from '../customer-phone-lock';
import { ContactResolverService } from '../../contacts/contact-resolver.service';
import { BOUGHT_WHERE, CustomerQueryService } from './customer-query.service';
import { AuditService } from '../../audit/audit.service';
import {
  isChatPlaceholder,
  PLACEHOLDER_FIELDS_SELECT,
} from '../../chat-prospects/chat-placeholder';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import {
  lockFinanceLineCustomers,
  staffLineFinanceChange,
  unlinkFinanceLine,
} from '../../line-oa/services/finance-line-link';
import {
  ACTIVE_FINANCE_LINK_WHERE,
  type FinanceLineStatus,
} from '../../line-oa/services/otp-verified-customer';
import { isRetryablePrismaWriteError } from '../../../utils/transaction-retry.util';

/** ปุ่มยกเลิกผูก LINE การเงิน (legacy) — ลองทั้งทรานแซกชันใหม่เมื่อ Postgres ตัดสิน deadlock/serialization (ตาข่าย — ลำดับล็อกเดียวกับ bind แล้ว ดู `unlinkFinanceLineByStaff`) */
const FINANCE_LINE_UNLINK_MAX_ATTEMPTS = 3;
import { contactAddedEntry, isBlankContact } from '../../customer-journey/chat-identity-entries';
import type { ContactField } from '../../customer-journey/journey-data-schemas';

/** สัญญาที่ "ยังผ่อนอยู่" — ชุดเดียวกับ assertCustomerContractPolicy / CustomerQueryService.search */
const ACTIVE_CONTRACT_STATUSES: ContractStatus[] = ['ACTIVE', 'OVERDUE', 'DEFAULT'];

/**
 * A7 (mockup บอร์ด 4) — ข้อมูลคนเดิมที่ 409 ข้อมูลซ้ำส่งให้เว็บ: ชื่อ · ลูกค้าตั้งแต่ · ผ่อนอยู่กี่สัญญา
 * (+ `purchased` — M-A3 คำนวณแยกใน CustomerWriteService.toExistingCustomerRef ด้วย BOUGHT_WHERE)
 * **ห้ามเพิ่มเบอร์/เลขบัตร/อีเมลของคนเดิม** — คนที่พิมพ์ข้อมูลซ้ำอาจไม่ใช่เจ้าของข้อมูลนั้น
 * (SentryExceptionFilter ส่ง existingCustomer ทั้งก้อนต่อให้ client — R47)
 */
const EXISTING_CUSTOMER_REF_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  _count: {
    select: { contracts: { where: { deletedAt: null, status: { in: ACTIVE_CONTRACT_STATUSES } } } },
  },
} satisfies Prisma.CustomerSelect;

type ExistingCustomerRow = Prisma.CustomerGetPayload<{
  select: typeof EXISTING_CUSTOMER_REF_SELECT;
}>;

/** client ที่ใช้ตรวจซ้ำ — ทรานแซกชันที่ถือล็อกเบอร์ (หรือ root เมื่อไม่มีการเขียนเบอร์หลัก) */
type Db = PrismaService | Prisma.TransactionClient;

/**
 * P2002 ของตาราง customers → 409 ภาษาไทยตามช่องที่ชนจริง (`meta.target` เป็นรายชื่อคอลัมน์/ฟิลด์ หรือชื่อ index)
 * รูป body เดียวกับ 409 ของด่านตรวจซ้ำ (`message` + `field`) — ไม่มี existingCustomer เพราะไม่รู้ว่าชนแถวไหน
 */
export function uniqueClashToConflict(
  err: Prisma.PrismaClientKnownRequestError,
): ConflictException {
  const rawTarget = (err.meta as { target?: unknown } | undefined)?.target;
  const target = (
    Array.isArray(rawTarget) ? rawTarget.join(',') : String(rawTarget ?? '')
  ).toLowerCase();
  if (target.includes('phone')) {
    return new ConflictException({ message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว', field: 'phone' });
  }
  if (target.includes('national')) {
    return new ConflictException({
      message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
      field: 'nationalId',
    });
  }
  return new ConflictException('ข้อมูลลูกค้าซ้ำกับรายการที่มีอยู่แล้ว กรุณาตรวจสอบแล้วลองใหม่');
}

/**
 * Write-path slice of the decomposed CustomersService.
 *
 * Owns create (holds a $transaction —
 * moved WHOLE, never split) / update / remove / uploadDocument /
 * deleteDocument, plus the write-path helpers (assertContactNotDuplicate,
 * normalize*, validateNationalId, buildPiiEncryptedFields + its inline
 * encrypt fallback) and the piiKey/hashSalt getters.
 *
 * The inline encrypt fallback (active when piiService is NOT injected) is
 * kept verbatim — legacy specs omit piiService on purpose to exercise it.
 * `findOne` existence-guard is delegated to CustomerQueryService (the shared
 * guard) where the original called `this.findOne(...)`.
 */
@Injectable()
export class CustomerWriteService {
  constructor(
    private readonly basePrisma: PrismaService,
    private readonly contactResolver: ContactResolverService,
    private readonly query: CustomerQueryService,
    @Optional() private readonly piiService?: CustomerPiiService,
    @Optional() private readonly audit?: AuditService,
    // การเดินทางของลูกค้า — CONTACT_ADDED (body ใน audit ถูก REDACTED จึงย้อนหาเวลาที่ได้เบอร์ไม่ได้)
    @Optional() private readonly journey?: JourneyEntryWriter,
    @Optional() private readonly parties?: AccessPartySourceService,
    @Optional() private readonly documents?: CustomerDocumentsService,
  ) {}

  private get prisma(): PrismaService {
    return domainAccessClient(this.basePrisma);
  }

  private async managedAudit(
    action: string,
    id: string,
    oldAssigned?: string | null,
    newAssigned?: string | null,
    contactId?: string | null,
  ) {
    const ctx = partyWriteExecution();
    if (!ctx) return;
    if (!this.audit) throw new Error('Required customer audit writer unavailable');
    await this.audit.log(
      {
        userId: ctx.snapshot.userId,
        action,
        entity: 'customer',
        entityId: id,
        oldValue: { assignedToId: oldAssigned ?? null },
        newValue: {
          assignedToId: newAssigned ?? null,
          ...(contactId !== undefined ? { contactId } : {}),
        },
      },
      ctx.client,
    );
  }

  private async existingIdentityMutation(
    tx: Prisma.TransactionClient,
    kind: 'customer' | 'contact',
    id: string,
    revival = false,
  ) {
    try {
      return await this.parties!.mutation(
        tx,
        kind,
        id,
        kind === 'customer' ? 'customers.update' : 'contacts.update',
        revival,
      );
    } catch (error) {
      if (error instanceof ForbiddenException)
        throw new ConflictException('ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว');
      throw error;
    }
  }

  private get piiKey(): string {
    return process.env.PII_ENCRYPTION_KEY || '';
  }

  private get hashSalt(): string {
    return process.env.PII_HASH_SALT || '';
  }

  /**
   * Phase 3 dual-write: produces an object with encrypted + hash columns
   * matching the plaintext fields in `data`. Caller spreads result into
   * the Prisma create/update data object.
   *
   * Skips encryption when PII_ENCRYPTION_KEY missing (dev mode without key set).
   * Skips hash when PII_HASH_SALT missing.
   *
   * Only fields explicitly present in `data` are encrypted — undefined values
   * are NOT touched (matters for partial updates).
   */
  private buildPiiEncryptedFields(data: {
    nationalId?: string | null;
    phone?: string | null;
    phoneSecondary?: string | null;
    email?: string | null;
    addressIdCard?: string | null;
    addressCurrent?: string | null;
    addressWork?: string | null;
    guardianNationalId?: string | null;
    guardianPhone?: string | null;
    guardianAddress?: string | null;
    references?: unknown;
  }): Record<string, unknown> {
    // Phase 3 SP4 — delegate to CustomerPiiService when injected. Falls back
    // to inline logic so legacy spec tests that construct CustomersService
    // without the new dependency keep working (jest 'as unknown as ...' DI).
    if (this.piiService) {
      return this.piiService.encryptCustomerFields(data) as Record<string, unknown>;
    }
    const key = this.piiKey;
    const salt = this.hashSalt;
    const out: Record<string, unknown> = {};

    const enc = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return v;
      return key ? encryptPII(v, key) : v;
    };
    const hsh = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return v;
      return salt ? hashPII(v, salt) : v;
    };

    if (data.nationalId !== undefined) {
      out.nationalIdEncrypted = enc(data.nationalId);
      out.nationalIdHash = hsh(data.nationalId);
    }
    if (data.phone !== undefined) {
      out.phoneEncrypted = enc(data.phone);
      out.phoneHash = hsh(data.phone);
    }
    if (data.phoneSecondary !== undefined) out.phoneSecondaryEncrypted = enc(data.phoneSecondary);
    if (data.email !== undefined) out.emailEncrypted = enc(data.email);
    if (data.addressIdCard !== undefined) out.addressIdCardEncrypted = enc(data.addressIdCard);
    if (data.addressCurrent !== undefined) out.addressCurrentEncrypted = enc(data.addressCurrent);
    if (data.addressWork !== undefined) out.addressWorkEncrypted = enc(data.addressWork);
    if (data.guardianNationalId !== undefined)
      out.guardianNationalIdEncrypted = enc(data.guardianNationalId);
    if (data.guardianPhone !== undefined) out.guardianPhoneEncrypted = enc(data.guardianPhone);
    if (data.guardianAddress !== undefined)
      out.guardianAddressEncrypted = enc(data.guardianAddress);
    if (data.references !== undefined) {
      out.referencesEncrypted =
        key && data.references ? encryptReferencesJson(data.references, key) : data.references;
    }

    return out;
  }

  /**
   * Normalize NID/passport for dedup. Strips spaces, dashes, then uppercases.
   * "1-1234-56789-00-1" → "1123456789001". Without this, the @unique constraint
   * is only effective when callers happen to pass already-clean strings —
   * which isn't guaranteed across LIFF, POS, chatbot, and legacy import paths.
   */
  private normalizeNationalId(raw: string): string {
    return raw.replace(/[\s-]/g, '').toUpperCase();
  }

  /**
   * T3-C9: Normalize a Thai mobile phone for application-level dedup. We do
   * NOT add a DB `@unique` constraint because existing data contains legacy
   * duplicates we can't auto-resolve; instead we block NEW writes from
   * creating more. กติกาอยู่ที่ normalizeThaiPhone (ใช้ร่วมกับบอทขาย capture_lead)
   */
  private normalizePhone(raw: string | null | undefined): string | null {
    return normalizeThaiPhone(raw);
  }

  /**
   * T3-C9: Normalize email for case-insensitive dedup. Lowercases and trims
   * outer whitespace. We keep it simple — no local-part sub-address parsing
   * (foo+bar@...) because owners sometimes legitimately share a single
   * family inbox with sub-addresses.
   */
  private normalizeEmail(raw: string | null | undefined): string | null {
    if (!raw) return null;
    return raw.trim().toLowerCase();
  }

  /**
   * existingCustomer ของ 409 ข้อมูลซ้ำ — id/name (เดิม) + createdAt/activeContracts (A7) + purchased (M-A3)
   * `purchased` = คนเดิม "เป็นลูกค้าแล้ว" ตามนิยามเดียวกับแท็บลูกค้า (`view=customers`) —
   * ใช้ BOUGHT_WHERE ตัวเดียวกับรายการลูกค้า (ห้ามเขียนสูตรที่สอง) · pattern เดียวกับ
   * journey-summary.service.ts (`count` + `AND: [{ id }, BOUGHT_WHERE]`) · ยิงเฉพาะตอนชนจริง (ทาง 409)
   * `db` = client ตัวเดียวกับที่ตรวจซ้ำ — ทาง 409 ในทรานแซกชันที่ถือล็อกเบอร์ต้องไม่ขอคอนเนกชันที่สองจาก pool
   * ระหว่างถือล็อก (pool เต็ม = รอจนทรานแซกชันหมดเวลา → P2028 500 แทน 409 ไทย)
   */
  private async toExistingCustomerRef(db: Db, row: ExistingCustomerRow) {
    if (partyWriteExecution()) return undefined;
    const purchased =
      (await db.customer.count({ where: { AND: [{ id: row.id }, BOUGHT_WHERE] } })) > 0;
    return {
      id: row.id,
      name: row.name,
      createdAt: row.createdAt.toISOString(),
      activeContracts: row._count.contracts,
      purchased,
    };
  }

  /**
   * T3-C9: application-level dedup for phone + email. Throws ConflictException
   * on collision with a non-soft-deleted record. `ignoreCustomerId` excludes
   * the customer being updated from the search (so update-in-place doesn't
   * collide with itself).
   *
   * R44: ทุก 409 ของ dedup แนบ `field` ('phone' | 'email' | 'nationalId') มาด้วย — ตัวเนื้อหาเดิม
   * ไม่บอกว่าชนที่ช่องไหน เว็บจึงเดาเป็น "เบอร์ซ้ำ" เสมอและเสนอปุ่ม "แก้เบอร์" ให้กับการชนเลขบัตร
   * (ประตูตัน: แก้เบอร์เท่าไรก็ยังชนเลขบัตรเดิม). เพิ่มคีย์อย่างเดียว ไม่แตะ message/existingCustomer
   * A7: existingCustomer มาจาก toExistingCustomerRef ทุกเส้นทาง (id/name เดิม + createdAt/activeContracts + purchased)
   *
   * ล็อกเบอร์หลัก (2026-09-17): `db` = ทรานแซกชันที่เพิ่ง `lockCustomerPhone` ของเบอร์นี้ — การตรวจต้องวิ่งบน
   * คอนเนกชันที่ถือล็อก ไม่ใช่ root (toExistingCustomerRef ก็ใช้ `db` ตัวเดียวกัน)
   */
  private async assertContactNotDuplicate(
    db: Db,
    phone: string | null,
    email: string | null,
    ignoreCustomerId?: string,
  ): Promise<void> {
    if (phone) {
      // Phase 5: use phoneHash for lookup (faster, correct post-Phase 6 drop of plaintext)
      const phoneHash = hashPII(phone, this.hashSalt);
      const dupPhone = await db.customer.findFirst({
        where: {
          phoneHash,
          deletedAt: null,
          ...(ignoreCustomerId ? { id: { not: ignoreCustomerId } } : {}),
        },
        select: EXISTING_CUSTOMER_REF_SELECT,
      });
      if (dupPhone) {
        throw new ConflictException({
          message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
          existingCustomer: await this.toExistingCustomerRef(db, dupPhone),
          field: 'phone',
        });
      }
    }
    if (email) {
      // Postgres default collation is case-sensitive, so a literal `where:
      // { email }` wouldn't catch "Foo@x.com" vs "foo@x.com". We rely on
      // normalization at write-time; the dedup lookup uses Prisma's
      // `mode: 'insensitive'` too, for belt-and-braces against any legacy
      // row that slipped through un-normalized.
      const dupEmail = await db.customer.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          deletedAt: null,
          ...(ignoreCustomerId ? { NOT: { id: ignoreCustomerId } } : {}),
        },
        select: EXISTING_CUSTOMER_REF_SELECT,
      });
      if (dupEmail) {
        throw new ConflictException({
          message: 'ลูกค้าที่มีอีเมลนี้มีอยู่แล้ว',
          existingCustomer: await this.toExistingCustomerRef(db, dupEmail),
          field: 'email',
        });
      }
    }
  }

  /**
   * Fix round 1 (Ruling R34, Finding 1) — dedup เลขบัตรผ่าน `nationalIdHash` เท่านั้น (คอลัมน์
   * plaintext ถูก drop ไปแล้ว Phase 6), บล็อกเฉพาะแถวที่ยังไม่ถูกลบ. คืนแถวที่เจอ (รวมแถว
   * soft-delete) ให้ caller ตัดสินใจต่อเอง — เดิม `create()` มีก้อนนี้ inline อยู่คนเดียว
   * (ไม่มีใครกันซ้ำให้ `fillPlaceholderContact`); สกัดออกมาเป็น helper เดียว ใช้ร่วมกันทั้งสองที่
   * แทนการก็อปบล็อก.
   *
   * `create()` ไม่มี `ignoreCustomerId` (แถวใหม่ ไม่มี "ตัวเอง" ให้กันซ้ำ) ⇒ ยังเป็น `findUnique`
   * บน `where: { nationalIdHash }` เหมือนเดิม (ห้ามสลับเป็น `findFirst` ที่เส้นทางนั้น —
   * `customers.service.spec.ts` mock/อ่าน `findUnique...where.nationalIdHash` อยู่) — ตั้งแต่ A7
   * call นี้มี `select` เพิ่มแล้ว จึงไม่ byte-identical กับของเดิม คงไว้แค่เมธอด + where.
   * `fillPlaceholderContact` ส่ง `ignoreCustomerId` เพื่อกันชนกับตัวเอง (สมมาตรกับ
   * `assertContactNotDuplicate`) ⇒ ต้องใช้ `findFirst` เพราะ `findUnique` รับเฉพาะ where บนคอลัมน์ unique ล้วน ไม่ใส่เงื่อนไขอื่นปนได้.
   * A7: ทั้งสองทาง select ชุดเดียวกัน (EXISTING_CUSTOMER_REF_SELECT + deletedAt) — `findUnique` ก่อน A7 ไม่มี
   * select (ดึงทั้งแถวรวมคอลัมน์ PII) ทั้งที่ caller ใช้แค่ id/deletedAt
   * `db` — fillPlaceholderContact ส่งทรานแซกชันที่ถือล็อกเบอร์ (ตรวจบนคอนเนกชันเดียวกับที่เขียน) · create() ส่ง root
   */
  private async assertNationalIdNotDuplicate(
    db: Db,
    nationalId: string,
    ignoreCustomerId?: string,
  ): Promise<{ id: string; deletedAt: Date | null } | null> {
    const nidHash = hashPII(nationalId, this.hashSalt);
    const select = {
      ...EXISTING_CUSTOMER_REF_SELECT,
      deletedAt: true,
    } satisfies Prisma.CustomerSelect;
    const existing = ignoreCustomerId
      ? await db.customer.findFirst({
          where: { nationalIdHash: nidHash, id: { not: ignoreCustomerId } },
          select,
        })
      : await db.customer.findUnique({
          where: { nationalIdHash: nidHash },
          select,
        });
    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
        existingCustomer: await this.toExistingCustomerRef(db, existing),
        field: 'nationalId',
      });
    }
    return existing;
  }

  async create(input: CreateCustomerDto) {
    // Task 22 I3 — LINE การเงินผูกได้ทางเดียวคือ OTP ของลูกค้าเอง: ส่ง U-id มา = 400 · ช่องว่าง = ไม่เขียนคอลัมน์
    const { branchId, assignedToId, lineIdFinance, ...dto } = input;
    staffLineFinanceChange(lineIdFinance, null);
    const ctx = partyWriteExecution();
    if (ctx) await lockCustomerPhone(ctx.client, this.piiService, dto.phone);
    const origin = ctx
      ? await this.parties!.destination(ctx.client, ctx.scope.company, branchId)
      : undefined;
    if (ctx && origin) {
      const source = {
        company: origin.accessCompanyCode,
        ...(origin.accessBranchId ? { branchId: origin.accessBranchId } : {}),
      };
      this.parties!.assert(ctx.snapshot, 'customers.create', [source]);
    }

    if (ctx && dto.referredById) {
      // Selection may use any genuine readable source; retain owned locks and exclude ghosts.
      const sources = await this.parties!.customer(ctx.client, dto.referredById, true, false, true);
      this.parties!.assert(ctx.snapshot, 'customers.read', sources, false);
    }
    // nationalId is optional (walk-in quick-create path omits it).
    // When provided, normalize + deduplicate; when absent, skip all nationalId checks.
    const normalizedNid = dto.nationalId ? this.normalizeNationalId(dto.nationalId) : undefined;
    const normalizedPhone = this.normalizePhone(dto.phone);
    const normalizedPhoneSecondary = this.normalizePhone(dto.phoneSecondary);
    const normalizedEmail = this.normalizeEmail(dto.email);

    let reviveGhostId: string | null = null;

    if (normalizedNid) {
      // Phase 5: use nationalIdHash for dedup (faster + correct post-Phase 6 drop of plaintext)
      // Fix round 1 (Ruling R34) — shared with fillPlaceholderContact via assertNationalIdNotDuplicate
      // (no ignoreCustomerId here → still findUnique() on nationalIdHash; since A7 it also carries a select).
      const existing = await this.assertNationalIdNotDuplicate(this.prisma, normalizedNid);
      // Soft-deleted ghost with the same nationalIdHash would otherwise break
      // the create() below with a P2002 on the unique column. Treat it as the
      // same person being re-registered: revive + update with the new form data
      // instead of crashing.
      reviveGhostId = existing?.deletedAt ? existing.id : null;

      // Validate Thai national ID checksum (skip for foreigners)
      if (!dto.isForeigner && !isValidThaiNationalId(normalizedNid)) {
        throw new ConflictException('เลขบัตรประชาชนไม่ถูกต้อง');
      }
    }

    const dataPlaintext = {
      ...dto,
      // Walk-in: normalizedNid is undefined → store null (field is nullable in DB)
      nationalId: normalizedNid ?? null,
      phone: normalizedPhone ?? dto.phone,
      phoneSecondary: normalizedPhoneSecondary ?? dto.phoneSecondary ?? null,
      email: normalizedEmail ?? dto.email ?? null,
    };
    const piiEncrypted = this.buildPiiEncryptedFields({
      // Only encrypt nationalId when it was actually provided
      nationalId: normalizedNid ?? undefined,
      phone: dataPlaintext.phone,
      phoneSecondary: dataPlaintext.phoneSecondary,
      email: dataPlaintext.email,
      addressIdCard: dto.addressIdCard,
      addressCurrent: dto.addressCurrent,
      addressWork: dto.addressWork,
      references: dto.references,
    });
    // Nested Contact/origin links require Prisma's checked relation input.
    const { referredById, ...createFields } = dataPlaintext;
    const data: Prisma.CustomerCreateInput = {
      ...createFields,
      ...(referredById ? { referredBy: { connect: { id: referredById } } } : {}),
      ...(piiEncrypted as Partial<Prisma.CustomerCreateInput>),
      references:
        dto.references !== undefined ? (dto.references as Prisma.InputJsonValue) : undefined,
    };
    // Task 10 — resolve the party-master Contact and link it in the SAME
    // transaction as the customer write. nationalIdHash is REUSED from
    // piiEncrypted (computed by buildPiiEncryptedFields above) — never hashed
    // twice. Contact stores PLAINTEXT phone/name (it's a lightweight
    // directory, not the PII vault).
    const nationalIdHash = (piiEncrypted.nationalIdHash as string | null | undefined) ?? null;
    return this.prisma.$transaction(async (tx) => {
      // ล็อกเบอร์หลักเป็นคำสั่งแรกของทรานแซกชัน (ก่อน contact:code ใน findOrCreateByNaturalKey) —
      // กติกาลำดับล็อก .claude/rules/database.md
      await lockCustomerPhone(tx, this.piiService, normalizedPhone);
      if (ctx && reviveGhostId) {
        const sources = await this.existingIdentityMutation(tx, 'customer', reviveGhostId, true);
        await this.parties!.assignment(tx, 'customer', reviveGhostId, assignedToId, sources);
      }
      let reusedContactId: string | undefined;
      const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
        name: dto.name,
        taxId: null,
        nationalIdHash,
        phone: dataPlaintext.phone ?? null,
        role: 'CUSTOMER',
        ...(ctx && reviveGhostId ? { reviveCustomerId: reviveGhostId } : {}),
        ...(origin
          ? {
              origin,
              onExisting: (id: string) => {
                reusedContactId = id;
              },
            }
          : {}),
      });
      const contactConnect: Prisma.ContactCreateNestedOneWithoutCustomersInput = {
        connect: { id: contact.id },
      };
      // Stub-upgrade guard: ensureRole creates a lightweight Customer stub
      // (name + phone mirrored from the contact, no nationalIdHash) that the
      // nationalId dedup above cannot see. If a proper /customers create is
      // called later for the same person, we must UPGRADE the stub rather than
      // create a second Customer row on the same contact (Customer.contactId
      // is not @unique, so Prisma would silently allow a second row).
      // หา stub ก่อนตรวจเบอร์ซ้ำ แล้วยกเว้นแถวนั้นจากการตรวจ — stub ที่มี phoneHash ของเบอร์เดียวกัน
      // คือคนเดียวกัน (contact จับคู่ด้วยเลขบัตรเท่านั้น ไม่เคยจับด้วยเบอร์ — findOrCreateByNaturalKey
      // ⇒ ไม่มีเลขบัตร = contact ใหม่เสมอ = ไม่มี stub ให้ยกเว้น) ไม่งั้นได้ 409 แทนการ upgrade
      // และเติมเลขบัตรให้ stub ไม่ได้อีกเลย (nationalId ไม่อยู่ใน UpdateCustomerDto)
      const existingStub = reviveGhostId
        ? null
        : await tx.customer.findFirst({
            where: { contactId: contact.id, deletedAt: null },
            select: { id: true },
          });
      if (ctx && reusedContactId && !reviveGhostId && !existingStub)
        await this.existingIdentityMutation(tx, 'contact', reusedContactId);
      if (ctx && existingStub) {
        const sources = await this.existingIdentityMutation(tx, 'customer', existingStub.id);
        await this.parties!.assignment(tx, 'customer', existingStub.id, assignedToId, sources);
      }
      const oldAssigned =
        ctx && (reviveGhostId || existingStub?.id)
          ? (
              await tx.customer.findUniqueOrThrow({
                where: { id: reviveGhostId ?? existingStub!.id },
                select: { assignedToId: true },
              })
            ).assignedToId
          : null;
      const assignment =
        ctx && assignedToId !== undefined
          ? { assignedTo: assignedToId ? { connect: { id: assignedToId } } : { disconnect: true } }
          : {};
      const referralClear = referredById === null ? { referredBy: { disconnect: true } } : {};
      // T3-C9: reject duplicate phone / email at application level — บนคอนเนกชันที่ถือล็อก
      await this.assertContactNotDuplicate(tx, normalizedPhone, normalizedEmail, existingStub?.id);
      if (reviveGhostId) {
        // Revive path: clear deletedAt and overwrite the row with the new
        // form submission. The admin is creating a customer whose nationalId
        // matches a soft-deleted ghost — Prisma.CustomerCreateInput shares
        // enough fields with UpdateInput to be compatible here.
        const row = await tx.customer.update({
          where: { id: reviveGhostId },
          data: {
            ...(data as Prisma.CustomerUpdateInput),
            ...assignment,
            ...referralClear,
            contact: contactConnect,
            deletedAt: null,
          },
        });
        await this.managedAudit(
          'CUSTOMER_REVIVED',
          row.id,
          oldAssigned,
          row.assignedToId,
          row.contactId,
        );
        return row;
      }
      if (existingStub) {
        // Upgrade the stub: overwrite with full create data (including all
        // PII-encrypted fields) — same logic as a regular create, just on
        // an existing row.
        const row = await tx.customer.update({
          where: { id: existingStub.id },
          data: {
            ...(data as Prisma.CustomerUpdateInput),
            ...assignment,
            ...referralClear,
            contact: contactConnect,
          },
        });
        await this.managedAudit(
          'CUSTOMER_ENRICHED',
          row.id,
          oldAssigned,
          row.assignedToId,
          row.contactId,
        );
        return row;
      }
      if (ctx && origin)
        await this.parties!.assignment(tx, 'customer', null, assignedToId, [
          {
            company: origin.accessCompanyCode,
            ...(origin.accessBranchId ? { branchId: origin.accessBranchId } : {}),
          },
        ]);
      const row = await tx.customer.create({
        data: {
          ...data,
          contact: contactConnect,
          ...(origin
            ? {
                accessCompany: { connect: { companyCode: origin.accessCompanyCode } },
                ...(origin.accessBranchId
                  ? { accessBranch: { connect: { id: origin.accessBranchId } } }
                  : {}),
              }
            : {}),
          ...(ctx && assignedToId ? { assignedTo: { connect: { id: assignedToId } } } : {}),
        },
      });
      await this.managedAudit('CUSTOMER_CREATED', row.id, null, row.assignedToId, row.contactId);
      return row;
    });
  }

  async update(id: string, input: UpdateCustomerDto, actor?: { id: string; role: string }) {
    // lineIdFinance ไม่ไหลเข้า data ของการแก้ไขเลย — ตัดสินแยกด้วย staffLineFinanceChange ด้านล่าง (Task 22 I3/I4)
    const { assignedToId, lineIdFinance, ...dto } = input;
    const ctx = partyWriteExecution();
    if (ctx && actor?.id !== ctx.snapshot.userId) throw new Error('Customer actor mismatch');
    if (ctx) {
      await lockCustomerPhone(ctx.client, this.piiService, dto.phone);
      const sources = await this.parties!.mutation(ctx.client, 'customer', id, 'customers.update');
      await this.parties!.assignment(ctx.client, 'customer', id, assignedToId, sources);
    }
    if (ctx && dto.referredById) {
      // Selection may use any genuine readable source; retain owned locks and exclude ghosts.
      const sources = await this.parties!.customer(ctx.client, dto.referredById, true, false, true);
      this.parties!.assert(ctx.snapshot, 'customers.read', sources, false);
    }
    const rawBefore = ctx
      ? await ctx.client.customer.findUniqueOrThrow({ where: { id } })
      : undefined;
    if (ctx && !this.piiService) throw new Error('Required customer PII writer unavailable');
    const before = ctx
      ? this.piiService!.decryptCustomerFields(rawBefore!, {
          strict: await this.piiService!.isStrictMode(ctx.client),
        })!
      : await this.query.findOne(id);
    // NID is intentionally not in UpdateCustomerDto — customers can't change
    // their ID through this endpoint. If NID needs correction, create a
    // dedicated admin-only flow that writes to an audit log.

    // T3-C9: normalize + dedup phone/email when either is being changed.
    const normalizedPhone = dto.phone !== undefined ? this.normalizePhone(dto.phone) : undefined;
    const normalizedPhoneSecondary =
      dto.phoneSecondary !== undefined ? this.normalizePhone(dto.phoneSecondary) : undefined;
    const normalizedEmail = dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;

    // ตั้งเบอร์หลักที่ไม่ว่าง **และต่างจากเบอร์เดิม** → ตรวจซ้ำในทรานแซกชันที่ถือล็อกเบอร์ (ด้านล่าง)
    // ไม่แตะเบอร์ / ส่งเบอร์เดิมกลับมา (ฟอร์มแก้ไขส่งเบอร์ทุกครั้ง) = ตรวจแค่อีเมลที่นี่ตามเดิม — เบอร์เดิมไม่ได้
    // สร้างคู่ซ้ำใหม่ และถ้าตรวจซ้ำ ลูกค้าที่มีคู่ซ้ำอยู่แล้ว (เช่น stub จาก ensureRole ที่ไม่บล็อกเบอร์) จะแก้ข้อมูลอะไรไม่ได้เลย
    const phoneChanged = !!normalizedPhone && this.normalizePhone(before.phone) !== normalizedPhone;
    // Task 22 I3/I4 — LINE การเงิน: ค่าเดิม/ไม่ส่ง = ไม่แตะ · ล้างช่อง = ยกเลิกผูก (ล้างคอลัมน์ + ปิดแถว customer_line_links
    // ของลูกค้าคนนี้ในทรานแซกชันเดียวกับการแก้ไข ⇒ ลูกค้ายืนยัน OTP ด้วย LINE ใหม่ได้) · ค่าใหม่ = 400 (ผูกได้ทาง OTP เท่านั้น)
    const lineFinance = staffLineFinanceChange(lineIdFinance, before.lineIdFinance);
    if (!phoneChanged) {
      await this.assertContactNotDuplicate(this.prisma, null, normalizedEmail ?? null, id);
    }

    // Compute final plaintext values for fields being updated
    const finalPhone = normalizedPhone !== undefined ? (normalizedPhone ?? dto.phone) : undefined;
    const finalPhoneSecondary = normalizedPhoneSecondary;
    const finalEmail = normalizedEmail;

    const piiEncrypted = this.buildPiiEncryptedFields({
      // nationalId not in UpdateDto by design — never updated
      phone: finalPhone,
      phoneSecondary: finalPhoneSecondary,
      email: finalEmail,
      addressIdCard: dto.addressIdCard,
      addressCurrent: dto.addressCurrent,
      addressWork: dto.addressWork,
      references: dto.references,
    });

    const { referredById, ...updateFields } = dto;
    const data: Prisma.CustomerUpdateInput = {
      ...updateFields,
      ...(referredById !== undefined
        ? { referredBy: referredById ? { connect: { id: referredById } } : { disconnect: true } }
        : {}),
      ...(ctx && assignedToId !== undefined
        ? { assignedTo: assignedToId ? { connect: { id: assignedToId } } : { disconnect: true } }
        : {}),
      ...(normalizedPhone !== undefined ? { phone: normalizedPhone ?? dto.phone } : {}),
      ...(normalizedPhoneSecondary !== undefined
        ? { phoneSecondary: normalizedPhoneSecondary }
        : {}),
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(piiEncrypted as Partial<Prisma.CustomerUpdateInput>),
      references:
        dto.references !== undefined ? (dto.references as Prisma.InputJsonValue) : undefined,
    };
    // เปลี่ยนเบอร์หลักเป็นเบอร์ใหม่ที่ไม่ว่าง → ล็อก + ตรวจซ้ำ (ignoreCustomerId) + เขียน ในทรานแซกชันเดียว
    // ยกเลิกผูก LINE การเงิน → ทรานแซกชันเดียวกัน (ล็อกเบอร์ยังเป็นคำสั่งแรก · ยกเลิกผูกก่อนเขียน ⇒ แถวที่คืนเป็นค่าหลังล้าง)
    // ไม่แตะเบอร์/เบอร์เดิม และไม่ยกเลิกผูก = ทางเดิมไม่มีทรานแซกชัน · journey ยังบันทึกหลัง commit
    const updated =
      phoneChanged || lineFinance === 'clear'
        ? await this.prisma.$transaction(async (tx) => {
            if (phoneChanged) {
              await lockCustomerPhone(tx, this.piiService, normalizedPhone);
              await this.assertContactNotDuplicate(
                tx,
                normalizedPhone,
                normalizedEmail ?? null,
                id,
              );
            }
            if (lineFinance === 'clear') await unlinkFinanceLine(tx, { customerId: id });
            return tx.customer.update({ where: { id }, data });
          })
        : await this.prisma.customer.update({ where: { id }, data });

    // CONTACT_ADDED — เบอร์จากว่าง → มีค่า เทียบในโค้ด ไม่เก็บตัวเบอร์ · เปลี่ยนเบอร์ที่มีอยู่แล้วไม่นับ
    // (nationalId ไม่อยู่ใน UpdateCustomerDto ⇒ ทางนี้ได้แค่เบอร์)
    if (finalPhone !== undefined && !isBlankContact(finalPhone) && isBlankContact(before.phone)) {
      const entry = contactAddedEntry({
        customerId: id,
        fields: ['phone'],
        via: 'UPDATE',
        actorUserId: actor?.id ?? null,
        occurredAt: new Date(),
      });
      if (ctx) {
        if (!this.journey) throw new Error('Required customer journey writer unavailable');
        await this.journey.recordInTx(ctx.client, entry);
      } else await this.journey?.recordAfterCommit(entry);
    }
    await this.managedAudit('CUSTOMER_UPDATED', id, before.assignedToId, updated.assignedToId);
    return updated;
  }

  /**
   * Task 27 — ปุ่ม "ยกเลิกการผูก" LINE น้องเบส (การเงิน) ในฟอร์มแก้ไขลูกค้า (`POST /customers/:id/finance-line/unlink` — OWNER/BM).
   * ทางเดียวกับ PATCH ล้างช่อง (`unlinkFinanceLine({ customerId })` — ล้างคอลัมน์ + ปิดแถวของลูกค้าคนนี้ + ล้าง `chat_rooms.verified_at`)
   * แต่ตัดสินจาก**แถว OTP ที่ยังผูก**ด้วย (PATCH ดูคอลัมน์อย่างเดียว — คอลัมน์ว่างแต่มีแถว = ไม่แตะ) ⇒ ปุ่มปิดแถวได้เสมอ ·
   * ไม่มีทั้งแถวและคอลัมน์ = สำเร็จแบบไม่แตะอะไร (กดซ้ำ/หน้าจอค้าง) ไม่เขียน audit ·
   * audit `CUSTOMER_FINANCE_LINE_UNLINKED` (สถานะก่อน/หลัง ไม่มี U-id) — ทางเดิมไม่มี audit เฉพาะ (Task 22 รายงานข้อ 3) ·
   * ไม่สลับ rich menu (เหมือน LIFF ยกเลิกเอง) · ผูกใหม่ได้ทาง OTP ของลูกค้าเท่านั้น · ตอบ 201 เหมือน POST action อื่นของ `/customers/:id`
   *
   * **ลำดับล็อก:** แถวลูกค้า → แถว link → ห้องแชท (`lockFinanceLineCustomers`) = ลำดับเดียวกับทางยกเลิกผูกพี่น้อง (PATCH ล้างช่อง · LIFF —
   * `unlinkFinanceLine`) และตั้งแต่ Task 29 รวม `VerificationService.bind` (เดิม bind ล็อกกลับด้าน ⇒ ยืนยัน OTP พร้อมกดปุ่มกับลูกค้าคนเดียวกัน =
   * deadlock 40P01 — fix round 1 review M-2 · ปักที่ `finance-line-lock-order.db.spec.ts`) · การลองทั้งทรานแซกชันใหม่เมื่อ Postgres ตัดสิน
   * deadlock/serialization คงไว้เป็นตาข่าย (legacy สูงสุด `FINANCE_LINE_UNLINK_MAX_ATTEMPTS` ครั้ง — ทุกขั้นอ่านใหม่ใต้ล็อก · managed = ระบบสิทธิ์
   * ลองใหม่เอง maxAttempts 3)
   */
  async unlinkFinanceLineByStaff(
    id: string,
    actor: { id: string },
  ): Promise<{ id: string; unlinked: boolean; financeLine: FinanceLineStatus }> {
    const ctx = partyWriteExecution();
    if (ctx && actor.id !== ctx.snapshot.userId) throw new Error('Customer actor mismatch');
    if (ctx) await this.parties!.mutation(ctx.client, 'customer', id, 'customers.update');
    const unlinkInTx = () =>
      this.prisma.$transaction(async (tx) => {
        // ล็อกแถวลูกค้าก่อนอ่านสถานะ ⇒ กดพร้อมกันได้ audit ใบเดียว · NO KEY UPDATE พอ: บล็อกผู้เขียนแถวนี้ด้วยกัน แต่ไม่บล็อก insert แถวลูก
        // ที่อ้าง FK (KEY SHARE) · ทรานแซกชันนี้แก้แค่ line_id_finance (ไม่ใช่คอลัมน์ key) — แบบ lockCreditCustomer
        await lockFinanceLineCustomers(tx, [id]);
        const customer = await tx.customer.findUnique({
          where: { id },
          select: { deletedAt: true, lineIdFinance: true },
        });
        if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
        const active = await tx.customerLineLink.findFirst({
          where: { customerId: id, ...ACTIVE_FINANCE_LINK_WHERE },
          select: { linkedAt: true },
        });
        const lineIdFinanceColumnSet = !!customer.lineIdFinance?.trim();
        if (!active && !lineIdFinanceColumnSet) return null;
        await unlinkFinanceLine(tx, { customerId: id });
        const financeLine: FinanceLineStatus = {
          verified: !!active,
          linkedAt: active ? active.linkedAt.toISOString() : null,
        };
        return { financeLine, lineIdFinanceColumnSet };
      });
    let before: Awaited<ReturnType<typeof unlinkInTx>> = null;
    for (let attempt = 1; ; attempt++) {
      try {
        before = await unlinkInTx();
        break;
      } catch (error) {
        // managed: ทรานแซกชันเป็นของระบบสิทธิ์ (join) — ลองซ้ำข้างในไม่ได้ ให้ชั้นนอกลองทั้งก้อน
        if (
          ctx ||
          attempt >= FINANCE_LINE_UNLINK_MAX_ATTEMPTS ||
          !isRetryablePrismaWriteError(error)
        )
          throw error;
      }
    }
    const after: FinanceLineStatus = { verified: false, linkedAt: null };
    if (before) {
      const entry = {
        userId: actor.id,
        action: 'CUSTOMER_FINANCE_LINE_UNLINKED',
        entity: 'customer',
        entityId: id,
        oldValue: before,
        newValue: { financeLine: after },
      };
      if (ctx) {
        if (!this.audit) throw new Error('Required customer audit writer unavailable');
        await this.audit.log(entry, ctx.client);
      } else await this.audit?.log(entry); // หลัง commit — แถวอยู่ใน Merkle chain (database.md)
    }
    return { id, unlinked: !!before, financeLine: after };
  }

  async remove(id: string) {
    const ctx = partyWriteExecution();
    if (ctx) await this.parties!.mutation(ctx.client, 'customer', id, 'customers.delete');
    else await this.query.findOne(id);

    const activeContracts = await this.prisma.contract.count({
      where: {
        customerId: id,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
    });
    if (activeContracts > 0) {
      throw new BadRequestException(
        ctx
          ? 'ไม่สามารถลบลูกค้าในสถานะปัจจุบันได้'
          : `ไม่สามารถลบลูกค้าได้: มีสัญญาที่ยังเปิดอยู่ ${activeContracts} สัญญา`,
      );
    }

    const row = await this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.managedAudit('CUSTOMER_DELETED', id, row.assignedToId, row.assignedToId);
    return row;
  }

  async uploadDocument(id: string, dto: UploadDocumentDto, file?: Express.Multer.File) {
    if (procurementPreparation.getStore()) return this.documents!.upload(id, dto, file);
    if (partyWriteExecution() || !dto.fileUrl || !dto.fileName || !dto.mimeType || !dto.fileSize)
      throw new BadRequestException('กรุณาระบุเอกสาร');
    const customer = await this.query.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = [...currentDocs, dto.fileUrl];
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  async deleteDocument(id: string, fileUrl: string, attachmentId?: string) {
    if (partyWriteExecution()) return this.documents!.remove(id, attachmentId ?? '');
    if (!fileUrl) throw new BadRequestException('กรุณาระบุเอกสาร');
    const customer = await this.query.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = currentDocs.filter((doc) => doc !== fileUrl);
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  /**
   * เติมเบอร์/ชื่อให้ "ผู้สนใจอัตโนมัติจากแชท" (สเปค 3.6 · Ruling R27) — แถวเดิม ไม่สร้างคนใหม่
   * ใช้ได้เฉพาะ placeholder ที่ยังไม่ถูกลบ · dedup เบอร์+เลขบัตรเหมือน create/update (409 พร้อม
   * existingCustomer ให้เว็บเสนอ "รวม") ที่มา CHAT_* ไม่ถูกแตะ (เป็นข้อมูลวิเคราะห์ lead — R14/R24)
   *
   * Fix round 1 (Ruling R34) — จงใจไม่ตรวจ checksum เลขบัตร (`validateNationalId`) บนเส้นทางนี้:
   * DTO ไม่มี `isForeigner` ให้เลือก, ฟอร์มฝั่งเว็บบังคับ checksum อยู่แล้วก่อนส่งมา, และเลขบัตร
   * จะถูกตรวจซ้ำอีกครั้งตอนเปิดสัญญา — อย่า "แก้" เพิ่ม validateNationalId เข้ามาทีหลัง.
   */
  async fillPlaceholderContact(
    id: string,
    dto: FillProspectContactDto,
    actor: { id: string; role: string },
  ): Promise<{ id: string; name: string; phone: string } | CustomerFillContactAcknowledgement> {
    const ctx = partyWriteExecution();
    const phone = this.normalizePhone(dto.phone) ?? dto.phone;
    if (ctx) {
      if (actor.id !== ctx.snapshot.userId) throw new Error('Customer actor mismatch');
      if (!this.parties || !this.piiService || !this.audit || !this.journey)
        throw new Error('Required customer enrichment providers unavailable');
      // Phone must precede Customer/source row locks, including placeholder validation.
      await lockCustomerPhone(ctx.client, this.piiService, phone);
      await this.parties.mutation(ctx.client, 'customer', id, 'customers.update');
    }
    const rawCurrent = await this.prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        ...PLACEHOLDER_FIELDS_SELECT,
        ...(ctx
          ? {
              phoneEncrypted: true,
              nationalIdEncrypted: true,
              prefix: true,
              nickname: true,
              facebookName: true,
            }
          : {}),
      },
    });
    const current = ctx
      ? this.piiService!.decryptCustomerFields(rawCurrent, {
          strict: await this.piiService!.isStrictMode(ctx.client),
        })
      : rawCurrent;
    if (!current || current.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    if (!isChatPlaceholder(current)) {
      // Fix round 1 (Ruling R35) — ข้อความเดิมสมมติว่า "มีเบอร์แล้ว" เสมอ (จริง ๆ อาจมีแค่เลขบัตร)
      // และชี้ไปหน้า PATCH /customers/:id ซึ่ง SALES/FINANCE_MANAGER (roles ของ endpoint นี้) เปิดไม่ได้
      // (@Roles('OWNER','BRANCH_MANAGER') เท่านั้น) — บอกบทบาทที่ทำได้จริงแทน
      throw new ConflictException(
        'เติมเบอร์ได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์และเลขบัตร — คนนี้มีข้อมูลติดต่อแล้ว ให้เจ้าของหรือผู้จัดการสาขาแก้ที่หน้ารายละเอียดลูกค้า',
      );
    }
    // Fix round 1 (Ruling R34, Finding 1) — normalizeNationalId (ไม่ใช่ trim เฉย ๆ) เพื่อให้
    // เลขที่มีขีด/เว้นวรรคถูกเก็บแบบ normalize เหมือน create() ไม่งั้นค่าที่ไม่ normalize จะมองไม่เห็น
    // จาก nationalIdHash lookup ของทุกจุดอื่นในระบบ
    const nationalId = dto.nationalId ? this.normalizeNationalId(dto.nationalId) : undefined;

    const piiEncrypted = this.buildPiiEncryptedFields({
      phone,
      ...(nationalId ? { nationalId } : {}),
    });
    const name = dto.name?.trim() || current.name;
    let updated: { id: string; name: string; phone: string | null };
    try {
      // ล็อกเบอร์ → ตรวจเบอร์ซ้ำ → ตรวจเลขบัตรซ้ำ → เขียน ในทรานแซกชันเดียว (ล็อกเบอร์ 2026-09-17)
      updated = await this.prisma.$transaction(async (tx) => {
        await lockCustomerPhone(tx, this.piiService, phone);
        await this.assertContactNotDuplicate(tx, phone, null, id);
        if (nationalId) {
          // ไม่สนใจ soft-deleted ghost ที่ helper คืนมา (ต่างจาก create() ที่ revive) — ปุ่มเติมเบอร์
          // ผู้สนใจไม่ใช่หน้าที่ชุบชีวิตลูกค้าเก่า แค่กันซ้ำกับคนที่ยังไม่ถูกลบ; ghost ที่หลุดผ่านด่านนี้
          // ให้ P2002 ตอน update ด้านล่างจับแทน
          await this.assertNationalIdNotDuplicate(tx, nationalId, id);
        }
        return tx.customer.update({
          where: { id },
          data: {
            phone,
            name,
            ...(dto.prefix !== undefined ? { prefix: dto.prefix || null } : {}),
            ...(dto.nickname !== undefined ? { nickname: dto.nickname || null } : {}),
            ...(dto.facebookName !== undefined ? { facebookName: dto.facebookName || null } : {}),
            ...(nationalId ? { nationalId } : {}),
            ...(piiEncrypted as Partial<Prisma.CustomerUpdateInput>),
          },
          select: { id: true, name: true, phone: true },
        });
      });
    } catch (err) {
      // Fix round 1 (Ruling R34) — เผื่อแถว soft-deleted ghost ที่ยังถือ nationalIdHash เดิมอยู่
      // ชน @unique ตรง ๆ ตอน update (pattern เดียวกับ stock-adjustments.service.ts) — แปลเป็นข้อความไทย
      // ไม่ปล่อย P2002 ดิบเป็น 500 · จับนอก $transaction เพราะ Postgres ยกเลิกทรานแซกชันทันทีที่คำสั่งพัง
      // · แยกช่องตาม meta.target — เดิมทุก P2002 ถูกเรียกว่า "เลขบัตรซ้ำ" แม้ชนที่ช่องอื่น
      if (!ctx && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw uniqueClashToConflict(err);
      }
      throw err;
    }

    if (ctx) {
      const changedFields: CustomerContactChangedField[] = [
        'phone',
        ...(nationalId ? ['nationalId' as const] : []),
      ];
      if (name !== current.name) changedFields.push('name');
      for (const field of ['prefix', 'nickname', 'facebookName'] as const)
        if (dto[field] !== undefined && (dto[field] || null) !== current[field])
          changedFields.push(field);
      await this.audit!.log(
        {
          userId: ctx.snapshot.userId,
          action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED',
          entity: 'customer',
          entityId: id,
          newValue: { changedFields },
        },
        ctx.client,
      );
      await this.journey!.recordInTx(
        ctx.client,
        contactAddedEntry({
          customerId: id,
          fields: nationalId ? ['phone', 'nationalId'] : ['phone'],
          via: 'FILL_CONTACT',
          actorUserId: ctx.snapshot.userId,
          occurredAt: new Date(),
        }),
      );
      return { id: updated.id, changedFields };
    }
    await this.audit?.log({
      userId: actor.id,
      action: 'CUSTOMER_PLACEHOLDER_CONTACT_FILLED',
      entity: 'customer',
      entityId: id,
      oldValue: { name: current.name, phone: null },
      newValue: { name: updated.name, phone: updated.phone, nationalIdFilled: !!nationalId },
    });
    // CONTACT_ADDED — ด่าน isChatPlaceholder ข้างบนรับประกันว่าเดิมไม่มีทั้งเบอร์และเลขบัตร จึงนับทุกครั้งที่เติมสำเร็จ
    const filled: ContactField[] = nationalId ? ['phone', 'nationalId'] : ['phone'];
    await this.journey?.recordAfterCommit(
      contactAddedEntry({
        customerId: id,
        fields: filled,
        via: 'FILL_CONTACT',
        actorUserId: actor.id,
        occurredAt: new Date(),
      }),
    );
    return { id: updated.id, name: updated.name, phone: updated.phone as string };
  }
}
