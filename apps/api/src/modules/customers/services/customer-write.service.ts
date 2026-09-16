import { Injectable, ConflictException, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { FillProspectContactDto } from '../dto/fill-prospect-contact.dto';
import { encryptPII } from '../../../utils/crypto.util';
import { hashPII, encryptReferencesJson } from '../../../utils/pii.util';
import { CustomerPiiService } from '../customer-pii.service';
import { ContactResolverService } from '../../contacts/contact-resolver.service';
import { CustomerQueryService } from './customer-query.service';
import { AuditService } from '../../audit/audit.service';
import { isChatPlaceholder, PLACEHOLDER_FIELDS_SELECT } from '../../chat-prospects/chat-placeholder';
import { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { contactAddedEntry, isBlankContact } from '../../customer-journey/chat-identity-entries';
import type { ContactField } from '../../customer-journey/journey-data-schemas';

/** สัญญาที่ "ยังผ่อนอยู่" — ชุดเดียวกับ assertCustomerContractPolicy / CustomerQueryService.search */
const ACTIVE_CONTRACT_STATUSES: ContractStatus[] = ['ACTIVE', 'OVERDUE', 'DEFAULT'];

/**
 * A7 (mockup บอร์ด 4) — ข้อมูลคนเดิมที่ 409 ข้อมูลซ้ำส่งให้เว็บ: ชื่อ · ลูกค้าตั้งแต่ · ผ่อนอยู่กี่สัญญา
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

type ExistingCustomerRow = Prisma.CustomerGetPayload<{ select: typeof EXISTING_CUSTOMER_REF_SELECT }>;

function toExistingCustomerRef(row: ExistingCustomerRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    activeContracts: row._count.contracts,
  };
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
    private prisma: PrismaService,
    private readonly contactResolver: ContactResolverService,
    private readonly query: CustomerQueryService,
    @Optional() private readonly piiService?: CustomerPiiService,
    @Optional() private readonly audit?: AuditService,
    // การเดินทางของลูกค้า — CONTACT_ADDED (body ใน audit ถูก REDACTED จึงย้อนหาเวลาที่ได้เบอร์ไม่ได้)
    @Optional() private readonly journey?: JourneyEntryWriter,
  ) {}

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
    if (data.guardianAddress !== undefined) out.guardianAddressEncrypted = enc(data.guardianAddress);
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
   * creating more. Strips spaces, dashes, parentheses, and optional +66
   * country prefix, always returning a leading zero. Examples:
   *   "081-234 5678"   → "0812345678"
   *   "+66812345678"   → "0812345678"
   *   "(081) 234 5678" → "0812345678"
   */
  private normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.replace(/[\s()-]/g, '');
    if (trimmed.startsWith('+66')) return '0' + trimmed.slice(3);
    if (trimmed.startsWith('66') && trimmed.length === 11) return '0' + trimmed.slice(2);
    return trimmed;
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
   * T3-C9: application-level dedup for phone + email. Throws ConflictException
   * on collision with a non-soft-deleted record. `ignoreCustomerId` excludes
   * the customer being updated from the search (so update-in-place doesn't
   * collide with itself).
   *
   * R44: ทุก 409 ของ dedup แนบ `field` ('phone' | 'email' | 'nationalId') มาด้วย — ตัวเนื้อหาเดิม
   * ไม่บอกว่าชนที่ช่องไหน เว็บจึงเดาเป็น "เบอร์ซ้ำ" เสมอและเสนอปุ่ม "แก้เบอร์" ให้กับการชนเลขบัตร
   * (ประตูตัน: แก้เบอร์เท่าไรก็ยังชนเลขบัตรเดิม). เพิ่มคีย์อย่างเดียว ไม่แตะ message/existingCustomer
   * A7: existingCustomer มาจาก toExistingCustomerRef ทุกเส้นทาง (id/name เดิม + createdAt/activeContracts)
   */
  private async assertContactNotDuplicate(
    phone: string | null,
    email: string | null,
    ignoreCustomerId?: string,
  ): Promise<void> {
    if (phone) {
      // Phase 5: use phoneHash for lookup (faster, correct post-Phase 6 drop of plaintext)
      const phoneHash = hashPII(phone, this.hashSalt);
      const dupPhone = await this.prisma.customer.findFirst({
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
          existingCustomer: toExistingCustomerRef(dupPhone),
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
      const dupEmail = await this.prisma.customer.findFirst({
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
          existingCustomer: toExistingCustomerRef(dupEmail),
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
   * `create()` ไม่มี `ignoreCustomerId` (แถวใหม่ ไม่มี "ตัวเอง" ให้กันซ้ำ) ⇒ ใช้ `findUnique`
   * เดิมเป๊ะ เพื่อคง call shape ที่ `customers.service.spec.ts` mock/อ่านค่าอยู่ (byte-identical
   * behavior — ห้ามสลับเป็น `findFirst` ที่เส้นทางนั้น). `fillPlaceholderContact` ส่ง
   * `ignoreCustomerId` เพื่อกันชนกับตัวเอง (สมมาตรกับ `assertContactNotDuplicate`) ⇒ ต้องใช้
   * `findFirst` เพราะ `findUnique` รับเฉพาะ where บนคอลัมน์ unique ล้วน ไม่ใส่เงื่อนไขอื่นปนได้.
   * A7: ทั้งสองทาง select ชุดเดียวกัน (EXISTING_CUSTOMER_REF_SELECT + deletedAt) — `findUnique` เดิมไม่มี
   * select (ดึงทั้งแถวรวมคอลัมน์ PII) ทั้งที่ caller ใช้แค่ id/deletedAt; where ยังเป็น nationalIdHash เหมือนเดิม
   */
  private async assertNationalIdNotDuplicate(
    nationalId: string,
    ignoreCustomerId?: string,
  ): Promise<{ id: string; deletedAt: Date | null } | null> {
    const nidHash = hashPII(nationalId, this.hashSalt);
    const select = { ...EXISTING_CUSTOMER_REF_SELECT, deletedAt: true } satisfies Prisma.CustomerSelect;
    const existing = ignoreCustomerId
      ? await this.prisma.customer.findFirst({
          where: { nationalIdHash: nidHash, id: { not: ignoreCustomerId } },
          select,
        })
      : await this.prisma.customer.findUnique({
          where: { nationalIdHash: nidHash },
          select,
        });
    if (existing && !existing.deletedAt) {
      throw new ConflictException({
        message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
        existingCustomer: toExistingCustomerRef(existing),
        field: 'nationalId',
      });
    }
    return existing;
  }

  async create(dto: CreateCustomerDto) {
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
      // (no ignoreCustomerId here → identical findUnique() call shape as before).
      const existing = await this.assertNationalIdNotDuplicate(normalizedNid);
      // Soft-deleted ghost with the same nationalIdHash would otherwise break
      // the create() below with a P2002 on the unique column. Treat it as the
      // same person being re-registered: revive + update with the new form data
      // instead of crashing.
      reviveGhostId = existing?.deletedAt ? existing.id : null;

      // Validate Thai national ID checksum (skip for foreigners)
      if (!dto.isForeigner && !this.validateNationalId(normalizedNid)) {
        throw new ConflictException('เลขบัตรประชาชนไม่ถูกต้อง');
      }
    }

    // T3-C9: reject duplicate phone / email at application level.
    await this.assertContactNotDuplicate(normalizedPhone, normalizedEmail);

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
    const data: Prisma.CustomerCreateInput = {
      ...dataPlaintext,
      ...(piiEncrypted as Partial<Prisma.CustomerCreateInput>),
      references: dto.references !== undefined
        ? (dto.references as Prisma.InputJsonValue)
        : undefined,
    };
    // Task 10 — resolve the party-master Contact and link it in the SAME
    // transaction as the customer write. nationalIdHash is REUSED from
    // piiEncrypted (computed by buildPiiEncryptedFields above) — never hashed
    // twice. Contact stores PLAINTEXT phone/name (it's a lightweight
    // directory, not the PII vault).
    const nationalIdHash = (piiEncrypted.nationalIdHash as string | null | undefined) ?? null;
    return this.prisma.$transaction(async (tx) => {
      const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
        name: dto.name,
        taxId: null,
        nationalIdHash,
        phone: dataPlaintext.phone ?? null,
        role: 'CUSTOMER',
      });
      const contactConnect: Prisma.ContactCreateNestedOneWithoutCustomersInput = {
        connect: { id: contact.id },
      };
      if (reviveGhostId) {
        // Revive path: clear deletedAt and overwrite the row with the new
        // form submission. The admin is creating a customer whose nationalId
        // matches a soft-deleted ghost — Prisma.CustomerCreateInput shares
        // enough fields with UpdateInput to be compatible here.
        return tx.customer.update({
          where: { id: reviveGhostId },
          data: { ...(data as Prisma.CustomerUpdateInput), contact: contactConnect, deletedAt: null },
        });
      }
      // Stub-upgrade guard: ensureRole creates a lightweight Customer stub
      // (phone:'', no phoneHash/nationalIdHash) that is invisible to the
      // normalId/phone dedup checks above. If a proper /customers create is
      // called later for the same person, we must UPGRADE the stub rather than
      // create a second Customer row on the same contact (Customer.contactId
      // is not @unique, so Prisma would silently allow a second row).
      const existingStub = await tx.customer.findFirst({
        where: { contactId: contact.id, deletedAt: null },
        select: { id: true },
      });
      if (existingStub) {
        // Upgrade the stub: overwrite with full create data (including all
        // PII-encrypted fields) — same logic as a regular create, just on
        // an existing row.
        return tx.customer.update({
          where: { id: existingStub.id },
          data: { ...(data as Prisma.CustomerUpdateInput), contact: contactConnect },
        });
      }
      return tx.customer.create({ data: { ...data, contact: contactConnect } });
    });
  }

  async update(id: string, dto: UpdateCustomerDto, actor?: { id: string; role: string }) {
    const before = await this.query.findOne(id);
    // NID is intentionally not in UpdateCustomerDto — customers can't change
    // their ID through this endpoint. If NID needs correction, create a
    // dedicated admin-only flow that writes to an audit log.

    // T3-C9: normalize + dedup phone/email when either is being changed.
    const normalizedPhone = dto.phone !== undefined ? this.normalizePhone(dto.phone) : undefined;
    const normalizedPhoneSecondary =
      dto.phoneSecondary !== undefined ? this.normalizePhone(dto.phoneSecondary) : undefined;
    const normalizedEmail = dto.email !== undefined ? this.normalizeEmail(dto.email) : undefined;

    await this.assertContactNotDuplicate(
      normalizedPhone ?? null,
      normalizedEmail ?? null,
      id,
    );

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

    const data: Prisma.CustomerUpdateInput = {
      ...dto,
      ...(normalizedPhone !== undefined ? { phone: normalizedPhone ?? dto.phone } : {}),
      ...(normalizedPhoneSecondary !== undefined
        ? { phoneSecondary: normalizedPhoneSecondary }
        : {}),
      ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      ...(piiEncrypted as Partial<Prisma.CustomerUpdateInput>),
      references: dto.references !== undefined
        ? (dto.references as Prisma.InputJsonValue)
        : undefined,
    };
    const updated = await this.prisma.customer.update({
      where: { id },
      data,
    });

    // CONTACT_ADDED — เบอร์จากว่าง → มีค่า เทียบในโค้ด ไม่เก็บตัวเบอร์ · เปลี่ยนเบอร์ที่มีอยู่แล้วไม่นับ
    // (nationalId ไม่อยู่ใน UpdateCustomerDto ⇒ ทางนี้ได้แค่เบอร์)
    if (finalPhone !== undefined && !isBlankContact(finalPhone) && isBlankContact(before.phone)) {
      await this.journey?.recordAfterCommit(
        contactAddedEntry({
          customerId: id,
          fields: ['phone'],
          via: 'UPDATE',
          actorUserId: actor?.id ?? null,
          occurredAt: new Date(),
        }),
      );
    }
    return updated;
  }

  async remove(id: string) {
    await this.query.findOne(id);

    const activeContracts = await this.prisma.contract.count({
      where: {
        customerId: id,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
    });
    if (activeContracts > 0) {
      throw new BadRequestException(
        `ไม่สามารถลบลูกค้าได้: มีสัญญาที่ยังเปิดอยู่ ${activeContracts} สัญญา`,
      );
    }

    return this.prisma.customer.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async uploadDocument(id: string, dto: { fileName: string; fileUrl: string; mimeType: string; fileSize: number }) {
    const customer = await this.query.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = [...currentDocs, dto.fileUrl];
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  async deleteDocument(id: string, fileUrl: string) {
    const customer = await this.query.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = currentDocs.filter((doc) => doc !== fileUrl);
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  private validateNationalId(id: string): boolean {
    if (!/^\d{13}$/.test(id)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(id[i]) * (13 - i);
    }
    const check = (11 - (sum % 11)) % 10;
    return check === parseInt(id[12]);
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
  ): Promise<{ id: string; name: string; phone: string }> {
    const current = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true, name: true, ...PLACEHOLDER_FIELDS_SELECT }, // SELECT มี deletedAt อยู่แล้ว
    });
    if (!current || current.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    if (!isChatPlaceholder(current)) {
      // Fix round 1 (Ruling R35) — ข้อความเดิมสมมติว่า "มีเบอร์แล้ว" เสมอ (จริง ๆ อาจมีแค่เลขบัตร)
      // และชี้ไปหน้า PATCH /customers/:id ซึ่ง SALES/FINANCE_MANAGER (roles ของ endpoint นี้) เปิดไม่ได้
      // (@Roles('OWNER','BRANCH_MANAGER') เท่านั้น) — บอกบทบาทที่ทำได้จริงแทน
      throw new ConflictException(
        'เติมเบอร์ได้เฉพาะผู้สนใจอัตโนมัติจากแชทที่ยังไม่มีเบอร์และเลขบัตร — คนนี้มีข้อมูลติดต่อแล้ว ให้เจ้าของหรือผู้จัดการสาขาแก้ที่หน้ารายละเอียดลูกค้า',
      );
    }
    const phone = this.normalizePhone(dto.phone) ?? dto.phone;
    // Fix round 1 (Ruling R34, Finding 1) — normalizeNationalId (ไม่ใช่ trim เฉย ๆ) เพื่อให้
    // เลขที่มีขีด/เว้นวรรคถูกเก็บแบบ normalize เหมือน create() ไม่งั้นค่าที่ไม่ normalize จะมองไม่เห็น
    // จาก nationalIdHash lookup ของทุกจุดอื่นในระบบ
    const nationalId = dto.nationalId ? this.normalizeNationalId(dto.nationalId) : undefined;
    await this.assertContactNotDuplicate(phone, null, id);
    if (nationalId) {
      // ไม่สนใจ soft-deleted ghost ที่ helper คืนมา (ต่างจาก create() ที่ revive) — ปุ่มเติมเบอร์
      // ผู้สนใจไม่ใช่หน้าที่ชุบชีวิตลูกค้าเก่า แค่กันซ้ำกับคนที่ยังไม่ถูกลบ; ghost ที่หลุดผ่านด่านนี้
      // (เช่น race) ให้ P2002 ตอน update ด้านล่างจับแทน
      await this.assertNationalIdNotDuplicate(nationalId, id);
    }

    const piiEncrypted = this.buildPiiEncryptedFields({ phone, ...(nationalId ? { nationalId } : {}) });
    const name = dto.name?.trim() || current.name;
    let updated: { id: string; name: string; phone: string | null };
    try {
      updated = await this.prisma.customer.update({
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
    } catch (err) {
      // Fix round 1 (Ruling R34) — เผื่อแถว soft-deleted ghost ที่ยังถือ nationalIdHash เดิมอยู่
      // หลุดผ่าน assertNationalIdNotDuplicate ข้างบน (race) แล้วชน @unique ตรง ๆ ตอน update
      // (pattern เดียวกับ stock-adjustments.service.ts) — แปลเป็นข้อความไทย ไม่ปล่อย P2002 ดิบเป็น 500
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว', field: 'nationalId' });
      }
      throw err;
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
      contactAddedEntry({ customerId: id, fields: filled, via: 'FILL_CONTACT', actorUserId: actor.id, occurredAt: new Date() }),
    );
    return { id: updated.id, name: updated.name, phone: updated.phone as string };
  }
}
