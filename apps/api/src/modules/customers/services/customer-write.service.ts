import { Injectable, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from '../dto/customer.dto';
import { encryptPII } from '../../../utils/crypto.util';
import { hashPII, encryptReferencesJson } from '../../../utils/pii.util';
import { CustomerPiiService } from '../customer-pii.service';
import { ContactResolverService } from '../../contacts/contact-resolver.service';
import { CustomerQueryService } from './customer-query.service';

/**
 * Write-path slice of the decomposed CustomersService.
 *
 * Owns create / findOrCreatePrecheckCustomer (both hold a $transaction —
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
        select: { id: true, name: true },
      });
      if (dupPhone) {
        throw new ConflictException({
          message: 'ลูกค้าที่มีเบอร์โทรนี้มีอยู่แล้ว',
          existingCustomer: dupPhone,
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
        select: { id: true, name: true },
      });
      if (dupEmail) {
        throw new ConflictException({
          message: 'ลูกค้าที่มีอีเมลนี้มีอยู่แล้ว',
          existingCustomer: dupEmail,
        });
      }
    }
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
      const nidHash = hashPII(normalizedNid, this.hashSalt);
      const existing = await this.prisma.customer.findUnique({
        where: { nationalIdHash: nidHash },
      });
      if (existing && !existing.deletedAt) {
        throw new ConflictException({
          message: 'ลูกค้าที่มีเลขบัตรประชาชนนี้มีอยู่แล้ว',
          existingCustomer: { id: existing.id, name: existing.name },
        });
      }
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

  /**
   * Find-or-create the lightweight "pre-check" placeholder Customer, keyed on
   * national ID, using the SAME PII pipeline + Contact resolution as create().
   *
   * Why this exists: the credit pre-check intake (CustomerPreCheckService) used
   * to look up + create on PLAINTEXT nationalId only — no nationalIdHash, no
   * encrypted columns, no party-master Contact. create() dedups exclusively on
   * nationalIdHash + contactId, so a pre-check customer was invisible to it and
   * the same person got a SECOND duplicate Customer row when they later
   * completed registration (splitting contracts/payments across two identities).
   * Routing both paths through this one helper keeps them from drifting, and is
   * required anyway once Phase 6 drops the plaintext national_id column.
   *
   * Returns the customer id + whether a new row was created. A non-deleted
   * existing customer is returned as-is; a soft-deleted ghost is revived.
   */
  async findOrCreatePrecheckCustomer(input: {
    nationalId: string;
    phone: string;
  }): Promise<{ id: string; isNew: boolean }> {
    const PLACEHOLDER_NAME = 'ลูกค้าใหม่ (Pre-check)';
    const normalizedNid = this.normalizeNationalId(input.nationalId);
    const normalizedPhone = this.normalizePhone(input.phone) ?? input.phone;
    const nidHash = hashPII(normalizedNid, this.hashSalt);

    // Dedup on nationalIdHash (the @unique column create() uses) — finds the row
    // even if soft-deleted, so we revive rather than hit a P2002.
    const existing = await this.prisma.customer.findUnique({
      where: { nationalIdHash: nidHash },
      select: { id: true, deletedAt: true },
    });
    if (existing && !existing.deletedAt) {
      return { id: existing.id, isNew: false };
    }

    const piiEncrypted = this.buildPiiEncryptedFields({
      nationalId: normalizedNid,
      phone: normalizedPhone,
    });
    const nationalIdHash = (piiEncrypted.nationalIdHash as string | null | undefined) ?? null;

    if (existing?.deletedAt) {
      // Same person re-entering — revive the ghost + refresh PII/phone/status.
      await this.prisma.customer.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          nationalId: normalizedNid,
          phone: normalizedPhone,
          ...(piiEncrypted as Partial<Prisma.CustomerUpdateInput>),
          creditCheckStatus: 'UNDER_REVIEW',
        },
      });
      return { id: existing.id, isNew: false };
    }

    return this.prisma.$transaction(async (tx) => {
      const contact = await this.contactResolver.findOrCreateByNaturalKey(tx, {
        name: PLACEHOLDER_NAME,
        taxId: null,
        nationalIdHash,
        phone: normalizedPhone,
        role: 'CUSTOMER',
      });
      const data = {
        nationalId: normalizedNid,
        name: PLACEHOLDER_NAME,
        phone: normalizedPhone,
        ...(piiEncrypted as Partial<Prisma.CustomerCreateInput>),
        creditCheckStatus: 'UNDER_REVIEW' as const,
      };
      // Stub-upgrade guard (mirrors create()): a prior ensureRole stub on this
      // contact must be UPGRADED, not duplicated (Customer.contactId not @unique).
      const existingStub = await tx.customer.findFirst({
        where: { contactId: contact.id, deletedAt: null },
        select: { id: true },
      });
      if (existingStub) {
        await tx.customer.update({
          where: { id: existingStub.id },
          data: {
            ...(data as Prisma.CustomerUpdateInput),
            contact: { connect: { id: contact.id } },
          },
        });
        return { id: existingStub.id, isNew: false };
      }
      const created = await tx.customer.create({
        data: {
          ...(data as Prisma.CustomerCreateInput),
          contact: { connect: { id: contact.id } },
        },
        select: { id: true },
      });
      return { id: created.id, isNew: true };
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.query.findOne(id);
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
    return this.prisma.customer.update({
      where: { id },
      data,
    });
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
}
