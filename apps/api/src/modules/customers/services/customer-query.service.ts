import { assertExportRowCount, EXPORT_ROW_LIMIT, readExportSnapshot } from '../../../common/helpers/export-snapshot';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CreditCheckStatus, CustomerCreditCheckStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { paginatedResponse } from '../../../common/helpers/pagination.helper';
import { decryptPII, isEncrypted } from '../../../utils/crypto.util';
import { decryptReferencesJson } from '../../../utils/pii.util';
import { CustomerTierService } from '../customer-tier.service';
import { CustomerPiiService } from '../customer-pii.service';

/** อ่านจาก enum ที่ Prisma generate — เพิ่มค่าใน schema แล้วรายการนี้ตามเองโดยไม่ต้องแก้ */
const CREDIT_CHECK_STATUSES = Object.values(CreditCheckStatus) as string[];
const CUSTOMER_CREDIT_CHECK_STATUSES = Object.values(CustomerCreditCheckStatus) as string[];

function assertEnumValue(value: string, allowed: string[], label: string): void {
  if (allowed.includes(value)) return;
  throw new BadRequestException(`${label}ไม่ถูกต้อง: "${value}" (ค่าที่รับได้: ${allowed.join(', ')})`);
}

/**
 * Read-path slice of the decomposed CustomersService.
 *
 * Owns the list/detail/search read aggregations + the read-path PII decrypt
 * helpers (decryptCustomerPII / decryptCustomerList), the piiKey/hashSalt
 * getters, and the inline decrypt fallback that keeps working when
 * piiService is NOT injected (legacy spec DI omits it on purpose to exercise
 * this path). `findOne` here is the shared existence-guard used by the write
 * + analytics slices.
 */
@Injectable()
export class CustomerQueryService {
  constructor(
    private prisma: PrismaService,
    private readonly tierService: CustomerTierService,
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
    db: Prisma.TransactionClient = this.prisma,
    asOf = new Date(),
  ) {
    const where: Record<string, unknown> = { deletedAt: null };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { nationalId: { contains: search } },
      ];
    }

    // Contract status and branch must constrain the same matching contract.
    if (hasOverdue || contractStatus || branchId) {
      where.contracts = { some: { deletedAt: null,
        ...(hasOverdue ? { status: { in: ['OVERDUE', 'DEFAULT'] } } : contractStatus ? { status: contractStatus } : {}),
        ...(branchId ? { branchId } : {}),
      } };
    }

    // สองตัวกรองนี้อ่านคนละฟิลด์และคนละ enum — ห้ามสลับกัน:
    //   creditStatus      → CreditCheck.status        (PENDING/APPROVED/REJECTED/MANUAL_REVIEW)
    //   creditCheckStatus → Customer.creditCheckStatus (NONE/PRE_CHECK_PASSED/
    //                                                   FULL_CHECK_PASSED/REJECTED/UNDER_REVIEW)
    // ค่าที่ไม่ใช่สมาชิกของ enum ปลายทางทำให้ Prisma โยน validation error = HTTP 500
    // (ก่อนหน้านี้หน้าจอลูกค้าส่ง APPROVED/PENDING/MANUAL_REVIEW เข้า `creditCheckStatus`
    // ซึ่งเป็นสมาชิกของ CreditCheckStatus ไม่ใช่ CustomerCreditCheckStatus) — ตรวจก่อน
    // เพื่อให้ได้ 400 พร้อมข้อความไทยแทน
    if (creditStatus) {
      assertEnumValue(creditStatus, CREDIT_CHECK_STATUSES, 'สถานะใบตรวจเครดิต');
      where.creditChecks = { some: { status: creditStatus, deletedAt: null } };
    }

    if (creditCheckStatus) {
      assertEnumValue(creditCheckStatus, CUSTOMER_CREDIT_CHECK_STATUSES, 'สถานะเครดิตของลูกค้า');
      where.creditCheckStatus = creditCheckStatus;
    }

    if (limit > 200) assertExportRowCount(await db.customer.count({ where }));

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
    // Derived filters must be resolved before pagination. Fetch only IDs/scores
    // here; PII and full customer rows remain bounded to the requested page.
    let matchedIds: string[] | undefined;
    let tierById: Awaited<ReturnType<CustomerTierService['getCustomerTiers']>> | undefined;
    if (tier || sortBy === 'creditScore') {
      if (tier && !['GOLD', 'GOOD', 'NEW', 'RISKY', 'BLACKLIST'].includes(tier)) {
        throw new BadRequestException('ระดับลูกค้าไม่ถูกต้อง');
      }
      const candidates = await db.customer.findMany({
        where, orderBy: [orderBy, { id: 'asc' }],
        select: { id: true, creditChecks: { where: { deletedAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { aiScore: true } } },
      });
      if (tier) tierById = await this.tierService.getCustomerTiers(candidates.map(customer => customer.id), db, asOf);
      const matching = tier ? candidates.filter(customer => tierById!.get(customer.id)?.tier === tier) : candidates;
      if (sortBy === 'creditScore') matching.sort((a, b) => {
        const aScore = a.creditChecks[0]?.aiScore, bScore = b.creditChecks[0]?.aiScore;
        if (aScore == null && bScore != null) return 1;
        if (bScore == null && aScore != null) return -1;
        const delta = aScore == null || bScore == null ? 0 : aScore - bScore;
        return (order === 'asc' ? delta : -delta) || a.id.localeCompare(b.id);
      });
      matchedIds = matching.map(customer => customer.id);
    }
    const selectedIds = matchedIds?.slice((page - 1) * limit, page * limit);


    const [data, total, withActiveContract, withOverdue, newThisMonth] = await Promise.all([
      db.customer.findMany({
        where: selectedIds ? { AND: [where, { id: { in: selectedIds } }] } : where,
        orderBy: [orderBy, { id: 'asc' }],
        skip: selectedIds ? 0 : (page - 1) * limit,
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
            where: { deletedAt: null },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: { status: true, aiScore: true },
          },
        },
      }),
      matchedIds ? Promise.resolve(matchedIds.length) : db.customer.count({ where }),
      db.customer.count({
        // "มีสัญญาผ่อน" = ยังไม่จบ (รวม ACTIVE + OVERDUE + DEFAULT) — พอร์ตสัญญาที่ business ใส่ใจ
        where: {
          deletedAt: null,
          contracts: { some: { status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] }, deletedAt: null } },
        },
      }),
      db.customer.count({
        where: { deletedAt: null, contracts: { some: { status: { in: ['OVERDUE', 'DEFAULT'] }, deletedAt: null } } },
      }),
      (() => {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return db.customer.count({
          where: { deletedAt: null, createdAt: { gte: startOfMonth } },
        });
      })(),
    ]);

    // Phase 3 SP4 — strict mode resolved once per request; null piiService
    // (legacy spec injection) treats as non-strict.
    const strict = this.piiService ? await this.piiService.isStrictMode(db) : false;

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
        latestCreditScore: latestCredit?.aiScore ?? null,
      };
    });

    if (selectedIds) {
      const position = new Map(selectedIds.map((id, index) => [id, index]));
      enriched.sort((a, b) => position.get(a.id)! - position.get(b.id)!);
    }
    const pageTiers = tierById ?? await this.tierService.getCustomerTiers(enriched.map(customer => customer.id), db, asOf);
    const withTier = enriched.map(customer => ({ ...customer, tier: pageTiers.get(customer.id)?.tier ?? 'NEW' }));

    const totalCustomers = await db.customer.count({ where: { deletedAt: null } });

    const summary = {
      totalCustomers,
      withActiveContract,
      withOverdue,
      newThisMonth,
    };

    return { ...paginatedResponse(withTier, total, page, limit), summary };
  }

  exportRows(...args: Parameters<CustomerQueryService['findAll']>) {
    return readExportSnapshot(this.prisma, (tx, asOf) => {
      args[1] = 1; args[2] = EXPORT_ROW_LIMIT + 1; args[11] = tx; args[12] = asOf;
      return this.findAll(...args);
    });
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
        // ประวัติการซื้อที่ **ไม่ผ่านสัญญาผ่อน** (ขายสด / ไฟแนนซ์นอก) — ก่อนหน้านี้ไม่มี
        // ที่ไหนแสดงเลย ลูกค้าเงินสดจึงเปิดโปรไฟล์มาเห็น "สัญญา (0)" เหมือนไม่เคยซื้ออะไร
        // ทั้งที่แถว Sale มีอยู่ (คำสั่งเจ้าของ 2026-08-27 "เก็บประวัติไว้")
        // กรอง contractId: null กันใบขายของสัญญาผ่อนโผล่ซ้ำกับแท็บสัญญา
        sales: {
          where: { contractId: null, deletedAt: null },
          select: {
            id: true,
            saleNumber: true,
            saleType: true,
            netAmount: true,
            createdAt: true,
            shopWarrantyEndDate: true,
            product: { select: { id: true, brand: true, model: true, imeiSerial: true } },
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

  private get piiKey(): string {
    return process.env.PII_ENCRYPTION_KEY || '';
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
}
