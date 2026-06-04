import { Injectable, NotFoundException, ConflictException, BadRequestException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { paginatedResponse } from '../../common/helpers/pagination.helper';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { encryptPII, decryptPII, isEncrypted } from '../../utils/crypto.util';
import { hashPII, encryptReferencesJson, decryptReferencesJson } from '../../utils/pii.util';
import { CustomerTierService } from './customer-tier.service';
import { CustomerPiiService } from './customer-pii.service';
import { ContactResolverService } from '../contacts/contact-resolver.service';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    private readonly tierService: CustomerTierService,
    // Task 10 — unified contact party-master. REQUIRED dependency (matches
    // suppliers / trade-in / external-finance). create() always resolves the
    // Contact and links it in the SAME transaction as the customer write.
    // Production wires the real provider via CustomersModule importing
    // ContactsModule; specs provide a mock.
    private readonly contactResolver: ContactResolverService,
    // Optional so legacy spec tests that construct CustomersService with
    // only PrismaService + CustomerTierService keep working. Production
    // wires the real provider through CustomersModule.
    @Optional() private readonly piiService?: CustomerPiiService,
  ) {}

  async findAll(
    search?: string,
    page = 1,
    limit = 50,
    contractStatus?: string,
    hasOverdue?: boolean,
    creditStatus?: string,
    branchId?: string,
    sortBy?: string,
    sortOrder?: string,
    tier?: string,
    creditCheckStatus?: string,
  ) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { nationalId: { contains: search } },
      ];
    }

    // Contract status filters
    if (hasOverdue) {
      where.contracts = { some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null } };
    } else if (contractStatus) {
      where.contracts = { some: { status: contractStatus, deletedAt: null } };
    } else if (branchId) {
      where.contracts = { some: { branchId, deletedAt: null } };
    }

    // Credit status filter (on CreditCheck relation)
    if (creditStatus) {
      where.creditChecks = { some: { status: creditStatus } };
    }

    // Phase 3 credit check status filter (on Customer.creditCheckStatus field)
    if (creditCheckStatus) {
      where.creditCheckStatus = creditCheckStatus;
    }

    // Determine sort order
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    let orderBy: Prisma.CustomerOrderByWithRelationInput = { createdAt: 'desc' };

    if (sortBy === 'name') {
      orderBy = { name: order };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: order };
    } else if (sortBy === 'contractCount') {
      orderBy = { contracts: { _count: order } };
    }
    // For creditScore, we'll sort in-memory after fetching

    const [data, total, withActiveContract, withOverdue, newThisMonth] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nationalId: true,
          nationalIdEncrypted: true,
          name: true,
          nickname: true,
          phone: true,
          phoneEncrypted: true,
          occupation: true,
          salary: true,
          lineIdFinance: true,
          lineIdShop: true,
          createdAt: true,
          _count: { select: { contracts: true } },
          contracts: {
            where: { deletedAt: null },
            select: { status: true },
          },
          creditChecks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, aiScore: true },
          },
        },
      }),
      this.prisma.customer.count({ where }),
      this.prisma.customer.count({
        // "มีสัญญาผ่อน" = ยังไม่จบ (รวม ACTIVE + OVERDUE + DEFAULT) — พอร์ตสัญญาที่ business ใส่ใจ
        where: {
          deletedAt: null,
          contracts: { some: { status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] }, deletedAt: null } },
        },
      }),
      this.prisma.customer.count({
        where: { deletedAt: null, contracts: { some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null } } },
      }),
      (() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return this.prisma.customer.count({
          where: { deletedAt: null, createdAt: { gte: startOfMonth } },
        });
      })(),
    ]);

    // Phase 3 SP4 — strict mode resolved once per request; null piiService
    // (legacy spec injection) treats as non-strict.
    const strict = this.piiService ? await this.piiService.isStrictMode() : false;

    const enriched = data.map((c) => {
      const activeContracts = c.contracts.filter((ct) => ct.status === 'ACTIVE').length;
      const overdueContracts = c.contracts.filter((ct) => ['OVERDUE', 'DEFAULT'].includes(ct.status)).length;
      const latestCredit = c.creditChecks[0] || null;
      const { contracts, creditChecks, ...rest } = c;
      // Phase 5: decrypt PII fields, then strip encrypted columns from response
      const decrypted = this.decryptCustomerPII(rest as Record<string, unknown>, { strict });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { nationalIdEncrypted: _ne, phoneEncrypted: _pe, ...clean } =
        decrypted as typeof rest & { nationalIdEncrypted?: unknown; phoneEncrypted?: unknown };
      return {
        ...clean,
        activeContracts,
        overdueContracts,
        latestCreditStatus: latestCredit?.status || null,
        latestCreditScore: latestCredit?.aiScore || null,
      };
    });

    // In-memory sort for creditScore
    if (sortBy === 'creditScore') {
      enriched.sort((a, b) => {
        const scoreA = a.latestCreditScore || -1;
        const scoreB = b.latestCreditScore || -1;
        return order === 'asc' ? scoreA - scoreB : scoreB - scoreA;
      });
    }

    // Compute tier for each customer in parallel (bounded by page limit)
    const withTier = await Promise.all(
      enriched.map(async (c) => {
        try {
          const t = await this.tierService.getCustomerTier(c.id);
          return { ...c, tier: t.tier };
        } catch {
          return { ...c, tier: 'NEW' as const };
        }
      }),
    );

    // Apply tier filter after compute (in-memory — valid for small shops)
    const filtered = tier ? withTier.filter((c) => c.tier === tier) : withTier;

    const totalCustomers = await this.prisma.customer.count({ where: { deletedAt: null } });

    const summary = {
      totalCustomers,
      withActiveContract,
      withOverdue,
      newThisMonth,
    };

    return { ...paginatedResponse(filtered, total, page, limit), summary };
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        contracts: {
          select: {
            id: true,
            contractNumber: true,
            status: true,
            sellingPrice: true,
            monthlyPayment: true,
            totalMonths: true,
            createdAt: true,
            product: { select: { id: true, name: true, brand: true, model: true } },
            branch: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: { select: { contracts: true, referrals: true } },
        referredBy: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!customer || customer.deletedAt) throw new NotFoundException('ไม่พบลูกค้า');
    // Phase 5: decrypt PII before returning. Phase 3 SP4 also enforces
    // strict-mode rejection — if PDPA_STRICT_MODE=true and the row hasn't
    // been backfilled, BadRequestException is thrown with a clear message.
    const strict = this.piiService ? await this.piiService.isStrictMode() : false;
    return this.decryptCustomerPII(customer as unknown as Record<string, unknown>, { strict }) as typeof customer;
  }

  async getReferrals(id: string) {
    await this.findOne(id);
    const referrals = await this.prisma.customer.findMany({
      where: { referredById: id, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        _count: { select: { contracts: true } },
        contracts: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      total: referrals.length,
      referrals: referrals.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        createdAt: r.createdAt,
        contractCount: r._count.contracts,
        hasActiveContract: r.contracts.some((c) => c.status === 'ACTIVE'),
      })),
    };
  }

  async getReferralStats(limit = 10) {
    const rows = await this.prisma.$queryRaw<
      { referrerId: string; referrerName: string; referrerPhone: string; referralCount: number }[]
    >(Prisma.sql`
      SELECT
        ref.id AS "referrerId",
        ref.name AS "referrerName",
        ref.phone AS "referrerPhone",
        COUNT(c.id) AS "referralCount"
      FROM customers ref
      JOIN customers c ON c.referred_by_id = ref.id AND c.deleted_at IS NULL
      WHERE ref.deleted_at IS NULL
      GROUP BY ref.id, ref.name, ref.phone
      ORDER BY "referralCount" DESC
      LIMIT ${limit}
    `);

    return {
      total: rows.length,
      topReferrers: rows.map((r) => ({
        referrerId: r.referrerId,
        referrerName: r.referrerName,
        referrerPhone: r.referrerPhone,
        referralCount: Number(r.referralCount),
      })),
    };
  }

  async search(q: string) {
    const rows = await this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { nationalId: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        phoneEncrypted: true,
        nationalId: true,
        nationalIdEncrypted: true,
        _count: { select: { contracts: true } },
        contracts: {
          where: {
            deletedAt: null,
            status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
          },
          select: { id: true },
        },
      },
      take: 10,
      orderBy: { name: 'asc' },
    });
    // Phase 5: decrypt PII, then project only the fields callers expect
    const strict = this.piiService ? await this.piiService.isStrictMode() : false;
    return this.decryptCustomerList(rows as unknown as Record<string, unknown>[], { strict }).map((r) => ({
      id: r['id'],
      name: r['name'],
      phone: r['phone'],
      nationalId: r['nationalId'],
      _count: r['_count'],
      activeContractCount: (r['contracts'] as unknown[]).length,
    }));
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
    if (data.guardianAddress !== undefined) out.guardianAddressEncrypted = enc(data.guardianAddress);
    if (data.references !== undefined) {
      out.referencesEncrypted =
        key && data.references ? encryptReferencesJson(data.references, key) : data.references;
    }

    return out;
  }

  /**
   * Phase 5 read-path: decrypt PII columns into the legacy field names.
   * After backfill (Phase 3 production step), every encrypted column should
   * be populated. We still gracefully fall back to the legacy plaintext
   * column if encrypted is NULL — supports rolling deploy + rollback safety.
   */
  private decryptCustomerPII<T extends Record<string, unknown>>(c: T | null, opts: { strict?: boolean } = {}): T | null {
    // Phase 3 SP4 — delegate to CustomerPiiService when injected (also
    // surfaces strict-mode rejection). Falls back to inline logic so legacy
    // tests that construct CustomersService without the new dependency
    // continue to work.
    if (this.piiService) {
      return this.piiService.decryptCustomerFields(c, opts);
    }
    if (!c) return c;
    const key = this.piiKey;
    if (!key) return c;

    const dec = (encField: string, legacyField: string): string | null | undefined => {
      const enc = c[encField] as string | null | undefined;
      if (enc && typeof enc === 'string' && isEncrypted(enc)) {
        return decryptPII(enc, key);
      }
      return c[legacyField] as string | null | undefined;
    };

    return {
      ...c,
      nationalId: dec('nationalIdEncrypted', 'nationalId'),
      phone: dec('phoneEncrypted', 'phone'),
      phoneSecondary: dec('phoneSecondaryEncrypted', 'phoneSecondary'),
      email: dec('emailEncrypted', 'email'),
      addressIdCard: dec('addressIdCardEncrypted', 'addressIdCard'),
      addressCurrent: dec('addressCurrentEncrypted', 'addressCurrent'),
      addressWork: dec('addressWorkEncrypted', 'addressWork'),
      guardianNationalId: dec('guardianNationalIdEncrypted', 'guardianNationalId'),
      guardianPhone: dec('guardianPhoneEncrypted', 'guardianPhone'),
      guardianAddress: dec('guardianAddressEncrypted', 'guardianAddress'),
      references: c['referencesEncrypted']
        ? decryptReferencesJson(c['referencesEncrypted'], key)
        : c['references'],
    } as T;
  }

  /**
   * Decrypt a list of customer rows.
   */
  private decryptCustomerList<T extends Record<string, unknown>>(rows: T[], opts: { strict?: boolean } = {}): T[] {
    return rows.map((r) => this.decryptCustomerPII(r, opts) as T);
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

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
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
    await this.findOne(id);

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

  async getContracts(id: string) {
    await this.findOne(id);
    return this.prisma.contract.findMany({
      where: { customerId: id, deletedAt: null },
      include: {
        product: { select: { id: true, name: true, brand: true, model: true } },
        branch: { select: { id: true, name: true } },
        _count: { select: { payments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getRiskFlag(id: string) {
    const overdueContracts = await this.prisma.contract.findMany({
      where: {
        customerId: id,
        status: { in: ['OVERDUE', 'DEFAULT'] },
        deletedAt: null,
      },
      select: {
        id: true,
        contractNumber: true,
        status: true,
      },
    });

    return {
      hasRisk: overdueContracts.length > 0,
      riskLevel: overdueContracts.some((c) => c.status === 'DEFAULT') ? 'HIGH' : overdueContracts.length > 0 ? 'MEDIUM' : 'NONE',
      overdueContracts,
    };
  }

  async uploadDocument(id: string, dto: { fileName: string; fileUrl: string; mimeType: string; fileSize: number }) {
    const customer = await this.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = [...currentDocs, dto.fileUrl];
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  async deleteDocument(id: string, fileUrl: string) {
    const customer = await this.findOne(id);
    const currentDocs = customer.documents || [];
    const updatedDocs = currentDocs.filter((doc) => doc !== fileUrl);
    return this.prisma.customer.update({
      where: { id },
      data: { documents: updatedDocs },
    });
  }

  async getUpsellCandidates(branchId?: string, limit = 20) {
    // Use raw SQL to compute paid ratio (paidInstallments / totalMonths)
    // Prisma ORM cannot HAVING on aggregate counts directly
    const branchFilter = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        contractId: string;
        contractNumber: string;
        customerId: string;
        customerName: string;
        customerPhone: string;
        totalMonths: number;
        paidCount: number;
        paidRatio: number;
        contractStatus: string;
        hasExchangeHistory: boolean;
        productModel: string | null;
        monthlyPayment: number;
      }[]
    >(Prisma.sql`
      SELECT
        c.id AS "contractId",
        c.contract_number AS "contractNumber",
        cu.id AS "customerId",
        cu.name AS "customerName",
        cu.phone AS "customerPhone",
        c.total_months AS "totalMonths",
        COUNT(p.id) FILTER (WHERE p.status = 'PAID') AS "paidCount",
        ROUND(COUNT(p.id) FILTER (WHERE p.status = 'PAID')::numeric / NULLIF(c.total_months, 0), 3) AS "paidRatio",
        c.status AS "contractStatus",
        (c.parent_contract_id IS NOT NULL) AS "hasExchangeHistory",
        pr.model AS "productModel",
        c.monthly_payment AS "monthlyPayment"
      FROM contracts c
      JOIN customers cu ON cu.id = c.customer_id
      LEFT JOIN payments p ON p.contract_id = c.id
      LEFT JOIN products pr ON pr.id = c.product_id
      WHERE c.deleted_at IS NULL
        AND cu.deleted_at IS NULL
        AND c.status IN ('ACTIVE', 'COMPLETED')
        AND c.dunning_stage = 'NONE'
        ${branchFilter}
      GROUP BY c.id, cu.id, pr.model
      HAVING
        c.status = 'COMPLETED'
        OR (c.parent_contract_id IS NOT NULL)
        OR (
          COUNT(p.id) FILTER (WHERE p.status = 'PAID')::numeric / NULLIF(c.total_months, 0) >= 0.7
        )
      ORDER BY "paidRatio" DESC NULLS LAST, c.created_at DESC
      LIMIT ${limit}
    `);

    return {
      total: rows.length,
      candidates: rows.map((r) => ({
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        totalMonths: Number(r.totalMonths),
        paidCount: Number(r.paidCount),
        paidRatio: Number(r.paidRatio),
        contractStatus: r.contractStatus,
        hasExchangeHistory: r.hasExchangeHistory,
        productModel: r.productModel,
        monthlyPayment: Number(r.monthlyPayment),
        reason:
          r.contractStatus === 'COMPLETED'
            ? 'ปิดสัญญาแล้ว'
            : r.hasExchangeHistory
              ? 'มีประวัติเปลี่ยนเครื่อง'
              : `ผ่อนแล้ว ${Math.round(Number(r.paidRatio) * 100)}%`,
      })),
    };
  }

  async getWatchList(branchId?: string, limit = 30) {
    const branchFilter = branchId ? Prisma.sql`AND c.branch_id = ${branchId}` : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      {
        customerId: string;
        customerName: string;
        customerPhone: string;
        contractId: string;
        contractNumber: string;
        latePaymentCount: number;
        partialPaymentCount: number;
        hadDunningReset: boolean;
        dunningStage: string;
        totalMonths: number;
        paidCount: number;
        nextDueDate: Date | null;
        nextAmountDue: number | null;
      }[]
    >(Prisma.sql`
      SELECT
        cu.id AS "customerId",
        cu.name AS "customerName",
        cu.phone AS "customerPhone",
        c.id AS "contractId",
        c.contract_number AS "contractNumber",
        COUNT(p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) AS "latePaymentCount",
        COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') AS "partialPaymentCount",
        (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE') AS "hadDunningReset",
        c.dunning_stage AS "dunningStage",
        c.total_months AS "totalMonths",
        COUNT(p.id) FILTER (WHERE p.status = 'PAID') AS "paidCount",
        MIN(p2.due_date) AS "nextDueDate",
        MIN(p2.amount_due) AS "nextAmountDue"
      FROM customers cu
      JOIN contracts c ON c.customer_id = cu.id AND c.deleted_at IS NULL
      LEFT JOIN payments p ON p.contract_id = c.id
      LEFT JOIN payments p2 ON p2.contract_id = c.id AND p2.status IN ('PENDING', 'OVERDUE')
      WHERE cu.deleted_at IS NULL
        AND c.status = 'ACTIVE'
        ${branchFilter}
      GROUP BY cu.id, c.id
      HAVING
        COUNT(p.id) FILTER (
          WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
        ) >= 2
        OR COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') >= 1
        OR (c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE')
      ORDER BY
        (
          LEAST(COUNT(p.id) FILTER (
            WHERE p.paid_date IS NOT NULL AND p.paid_date::date > p.due_date::date
          ), 5)
          + COUNT(p.id) FILTER (WHERE p.status = 'PARTIALLY_PAID') * 2
          + CASE WHEN c.dunning_last_action_at IS NOT NULL AND c.dunning_stage = 'NONE' THEN 3 ELSE 0 END
        ) DESC
      LIMIT ${limit}
    `);

    const candidates = rows.map((r) => {
      const late = Number(r.latePaymentCount);
      const partial = Number(r.partialPaymentCount);
      const dunningReset = Boolean(r.hadDunningReset);
      const score = Math.min(late, 5) + partial * 2 + (dunningReset ? 3 : 0);
      const riskLevel: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 5 ? 'HIGH' : score >= 3 ? 'MEDIUM' : 'LOW';

      const reasons: string[] = [];
      if (late >= 2) reasons.push(`ชำระล่าช้า ${late} ครั้ง`);
      if (partial >= 1) reasons.push(`จ่ายไม่ครบ ${partial} ครั้ง`);
      if (dunningReset) reasons.push('เคยถูกติดตามหนี้แล้ว reset');

      return {
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        contractId: r.contractId,
        contractNumber: r.contractNumber,
        riskScore: score,
        riskLevel,
        reasons,
        latePaymentCount: late,
        partialPaymentCount: partial,
        hadDunningReset: dunningReset,
        totalMonths: Number(r.totalMonths),
        paidCount: Number(r.paidCount),
        nextDueDate: r.nextDueDate,
        nextAmountDue: r.nextAmountDue ? Number(r.nextAmountDue) : null,
      };
    });

    return {
      total: candidates.length,
      watchList: candidates,
    };
  }

  async getChatSummary(customerId: string) {
    // Verify customer exists
    await this.findOne(customerId);

    // 1. Recent installments grouped from the last 5 distinct paymentIds with
    //    a non-voided receipt. Returns each installment with all of its
    //    non-voided receipts so the UI can show partial-payment breakdowns
    //    (1 งวด → N partials).
    const recentReceipts = await this.prisma.receipt.findMany({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        isVoided: false,
        paymentId: { not: null },
      },
      orderBy: { paidDate: 'desc' },
      take: 30, // over-fetch so grouping yields up to 5 distinct installments
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        paidDate: true,
        paymentMethod: true,
        installmentNo: true,
        paymentId: true,
        contract: { select: { contractNumber: true } },
      },
    });

    const paymentIds = Array.from(
      new Set(recentReceipts.map((r) => r.paymentId).filter((id): id is string => !!id)),
    ).slice(0, 5);

    const payments = paymentIds.length
      ? await this.prisma.payment.findMany({
          where: { id: { in: paymentIds } },
          select: {
            id: true,
            installmentNo: true,
            amountDue: true,
            amountPaid: true,
            status: true,
            contract: { select: { contractNumber: true } },
          },
        })
      : [];
    const paymentMap = new Map(payments.map((p) => [p.id, p]));

    const recentPayments = paymentIds
      .map((pid) => {
        const p = paymentMap.get(pid);
        if (!p) return null;
        const partials = recentReceipts
          .filter((r) => r.paymentId === pid)
          .map((r) => ({
            id: r.id,
            receiptNumber: r.receiptNumber,
            amount: r.amount,
            paidDate: r.paidDate,
            paymentMethod: r.paymentMethod,
          }));
        return {
          id: p.id,
          installmentNo: p.installmentNo,
          amountDue: p.amountDue,
          amountPaid: p.amountPaid,
          status: p.status,
          contract: p.contract,
          partials,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // 2. Overdue summary
    const overduePayments = await this.prisma.payment.count({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: new Date() },
      },
    });

    const totalOutstanding = await this.prisma.payment.aggregate({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE'] },
      },
      _sum: { amountDue: true },
    });

    // 3. Active contracts with product info
    const activeContracts = await this.prisma.contract.findMany({
      where: { customerId, deletedAt: null, status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        monthlyPayment: true,
        totalMonths: true,
        product: { select: { name: true, brand: true, model: true, serialNumber: true } },
        payments: {
          where: { deletedAt: null },
          select: { status: true, dueDate: true },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    // Compute per-contract paid/total/next due
    const contractSummaries = activeContracts.map((c) => {
      const paid = c.payments.filter((p) => p.status === 'PAID').length;
      const nextDue = c.payments.find((p) => p.status !== 'PAID');
      return {
        id: c.id,
        contractNumber: c.contractNumber,
        status: c.status,
        monthlyPayment: c.monthlyPayment,
        product: c.product,
        paidInstallments: paid,
        totalInstallments: c.totalMonths,
        nextDueDate: nextDue?.dueDate ?? null,
        serialNumber: c.product?.serialNumber ?? null,
      };
    });

    // 4. Call logs across all contracts (last 5)
    const callLogs = await this.prisma.callLog.findMany({
      where: {
        contract: { customerId, deletedAt: null },
      },
      orderBy: { calledAt: 'desc' },
      take: 5,
      select: {
        id: true,
        calledAt: true,
        result: true,
        notes: true,
        caller: { select: { name: true } },
        contract: { select: { contractNumber: true } },
      },
    });

    // 5. Previous chat rooms (all channels)
    const chatRooms = await this.prisma.chatRoom.findMany({
      where: { customerId, deletedAt: null },
      orderBy: { lastMessageAt: 'desc' },
      take: 10,
      select: {
        id: true,
        channel: true,
        status: true,
        totalMessages: true,
        lastMessageAt: true,
        createdAt: true,
        assignedTo: { select: { name: true } },
      },
    });

    return {
      recentPayments,
      overdueCount: overduePayments,
      totalOutstanding: totalOutstanding._sum.amountDue ?? 0,
      activeContracts: contractSummaries,
      callLogs,
      chatRooms,
    };
  }

  /**
   * Compact summary for chat inbox assistant sidebar.
   * Returns name, phone, and lightweight counts (active contracts,
   * overdue installments, total outstanding). Cheaper than
   * `getChatSummary`, which pulls full payment/call/chat history.
   */
  async getSummary(customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) {
      throw new NotFoundException('ไม่พบข้อมูลลูกค้า');
    }

    const activeContracts = await this.prisma.contract.count({
      where: {
        customerId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] },
      },
    });

    const overdueCount = await this.prisma.payment.count({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: 'OVERDUE',
      },
    });

    const outstanding = await this.prisma.payment.aggregate({
      where: {
        contract: { customerId, deletedAt: null },
        deletedAt: null,
        status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
      },
      _sum: { amountDue: true },
    });

    return {
      id: customer.id,
      name: customer.name,
      phone: customer.phone ?? null,
      activeContracts,
      overdueCount,
      totalOutstandingThb: Number(outstanding._sum.amountDue ?? 0),
    };
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
