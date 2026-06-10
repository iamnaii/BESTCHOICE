import { BadRequestException, Injectable } from '@nestjs/common';
import { OtherIncomeStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ListOtherIncomeQueryDto } from '../dto/list-other-income-query.dto';
import { OtherIncomeLifecycleService } from './other-income-lifecycle.service';

type Decimal = Prisma.Decimal;
const ZERO = new Prisma.Decimal(0);

/**
 * Read-only reporting for OtherIncome: dailySheet, list, getAuditTrail. Plain
 * class — constructed internally by the OtherIncomeService facade. Injects the
 * Lifecycle service for the canonical findOneOrFail (used by getAuditTrail).
 */
@Injectable()
export class OtherIncomeReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OtherIncomeLifecycleService,
  ) {}

  // -------------------------------------------------------------------------
  // dailySheet(): summary + docs for a date range (inclusive both ends)
  // -------------------------------------------------------------------------

  async dailySheet(startDate: string, endDate: string) {
    // Use BKK day boundaries — NOT server local time. If the API runs on UTC
    // (Cloud Run default), `setHours(0,0,0,0)` would put the day boundary at
    // 00:00 UTC = 07:00 BKK, dropping docs issued 00:00–06:59 BKK into the
    // wrong sheet. This mirrors DocNumberService.getBkkDayBounds().
    const bkkOffsetMs = 7 * 60 * 60 * 1000;
    const toBkkStart = (iso: string): Date => {
      const parts = new Date(iso).toLocaleString('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const [y, m, d] = parts.split('-').map((s) => parseInt(s, 10));
      return new Date(Date.UTC(y, m - 1, d) - bkkOffsetMs);
    };

    const rangeStart = toBkkStart(startDate);
    const rangeEnd = new Date(toBkkStart(endDate).getTime() + 24 * 60 * 60 * 1000); // exclusive upper

    if (rangeEnd <= rangeStart) {
      throw new BadRequestException('endDate ต้อง >= startDate');
    }

    // Cap range at 366 days to bound query cost (one full year + leap-day slack).
    const MAX_RANGE_DAYS = 366;
    const spanDays = (rangeEnd.getTime() - rangeStart.getTime()) / (24 * 60 * 60 * 1000);
    if (spanDays > MAX_RANGE_DAYS) {
      throw new BadRequestException(`ช่วงวันที่ต้องไม่เกิน ${MAX_RANGE_DAYS} วัน`);
    }

    const docs = await this.prisma.otherIncome.findMany({
      where: {
        status: OtherIncomeStatus.POSTED,
        issueDate: { gte: rangeStart, lt: rangeEnd },
        deletedAt: null,
      },
      include: {
        items: { orderBy: { lineNo: 'asc' } },
        adjustments: { orderBy: { lineNo: 'asc' } },
      },
      orderBy: { docNumber: 'asc' },
    });

    // Aggregate summary
    let incomeGross = ZERO;
    let vat = ZERO;
    let wht = ZERO;
    let net = ZERO;

    const byAccountMap = new Map<string, Decimal>();
    const byPaymentMap = new Map<string, Decimal>();

    for (const doc of docs) {
      incomeGross = incomeGross.plus(doc.incomeGross.toString());
      vat = vat.plus(doc.vatAmount.toString());
      wht = wht.plus(doc.whtAmount.toString());
      net = net.plus(doc.netReceived.toString());

      // By income account (from items)
      for (const item of doc.items) {
        const prev = byAccountMap.get(item.accountCode) ?? ZERO;
        byAccountMap.set(item.accountCode, prev.plus(item.amountBeforeVat.toString()));
      }

      // By payment account
      const prevPay = byPaymentMap.get(doc.paymentAccountCode) ?? ZERO;
      byPaymentMap.set(doc.paymentAccountCode, prevPay.plus(doc.amountReceived.toString()));
    }

    // B1: convert Maps to sorted arrays (Maps serialize to {} via JSON.stringify)
    // B3: include name + count per byAccount item
    // B4: include count per byPayment item

    // Gather account names from ChartOfAccount for B3 + W13
    // (Union of income account codes and payment account codes so payment
    // channel rows can show account name beside the code.)
    const allAccountCodes = [
      ...new Set([...byAccountMap.keys(), ...byPaymentMap.keys()]),
    ];
    const coaRows = allAccountCodes.length > 0
      ? await this.prisma.chartOfAccount.findMany({
          where: { code: { in: allAccountCodes } },
          select: { code: true, name: true },
        })
      : [];
    const nameByCode = Object.fromEntries(coaRows.map((r) => [r.code, r.name]));

    // Count per account code (number of distinct docs contributing to each)
    const byAccountCountMap = new Map<string, number>();
    for (const doc of docs) {
      const codesInDoc = new Set(doc.items.map((it) => it.accountCode));
      for (const code of codesInDoc) {
        byAccountCountMap.set(code, (byAccountCountMap.get(code) ?? 0) + 1);
      }
    }

    // Count per payment account code (number of docs per payment channel)
    const byPaymentCountMap = new Map<string, number>();
    for (const doc of docs) {
      byPaymentCountMap.set(
        doc.paymentAccountCode,
        (byPaymentCountMap.get(doc.paymentAccountCode) ?? 0) + 1,
      );
    }

    const byAccount = [...byAccountMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, total]) => ({
        code,
        name: nameByCode[code] ?? code,
        total: total.toFixed(2),
        count: byAccountCountMap.get(code) ?? 0,
      }));

    const byPayment = [...byPaymentMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, total]) => ({
        code,
        // W13 — include account name so Daily Sheet payment-channel table
        // reads "11-1201 ธนาคาร KBank" instead of bare "11-1201".
        name: nameByCode[code] ?? code,
        total: total.toFixed(2),
        count: byPaymentCountMap.get(code) ?? 0,
      }));

    return {
      startDate,
      endDate,
      summary: {
        docCount: docs.length,
        incomeGross: incomeGross.toFixed(2),
        // B2: rename to vat/wht to match frontend DailySheet type
        vat: vat.toFixed(2),
        wht: wht.toFixed(2),
        netReceived: net.toFixed(2),
      },
      docs,
      byAccount,
      byPayment,
    };
  }

  // -------------------------------------------------------------------------
  // list(): paginated with filters
  // -------------------------------------------------------------------------

  async list(query: ListOtherIncomeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    // Parse sort expression — supports `<field>:asc` / `<field>:desc`
    // Allowed fields: createdAt, issueDate (default). Unknown fields fall back to issueDate:desc.
    const ALLOWED_SORT_FIELDS = ['createdAt', 'issueDate'] as const;
    type SortField = (typeof ALLOWED_SORT_FIELDS)[number];
    let sortField: SortField = 'issueDate';
    let sortDir: 'asc' | 'desc' = 'desc';
    if (query.sort) {
      const [rawField, rawDir] = query.sort.split(':');
      if (ALLOWED_SORT_FIELDS.includes(rawField as SortField)) {
        sortField = rawField as SortField;
      }
      if (rawDir === 'asc' || rawDir === 'desc') {
        sortDir = rawDir;
      }
    }

    // statusIn (comma-separated) takes precedence over single `status` —
    // supports "ค้างดำเนินการ" card which filters DRAFT+READY together.
    // W4 — validate each segment against OtherIncomeStatus enum so unknown
    // status strings are dropped (instead of silently casting to bad enum).
    const validStatuses = Object.values(OtherIncomeStatus) as OtherIncomeStatus[];
    const statusInArr = query.statusIn
      ? (query.statusIn
          .split(',')
          .map((s) => s.trim())
          .filter((s): s is OtherIncomeStatus =>
            validStatuses.includes(s as OtherIncomeStatus),
          ))
      : null;
    const where: Prisma.OtherIncomeWhereInput = {
      deletedAt: null,
      ...(statusInArr && statusInArr.length > 0
        ? { status: { in: statusInArr } }
        : query.status
          ? { status: query.status }
          : {}),
      ...(query.startDate || query.endDate
        ? {
            issueDate: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
            },
          }
        : {}),
      ...(query.q
        ? {
            OR: [
              { docNumber: { contains: query.q, mode: 'insensitive' } },
              { counterpartyName: { contains: query.q, mode: 'insensitive' } },
              { receiptNo: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.otherIncome.findMany({
        where,
        include: { items: { orderBy: { lineNo: 'asc' } } },
        orderBy: { [sortField]: sortDir },
        skip,
        take: limit,
      }),
      this.prisma.otherIncome.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  // -------------------------------------------------------------------------
  // getAuditTrail()
  // -------------------------------------------------------------------------

  async getAuditTrail(id: string) {
    // Verify doc exists — throws NotFoundException for unknown id
    await this.lifecycle.findOneOrFail(id);
    return this.prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: 'OtherIncome', entityId: id },
          { entity: 'other_income', entityId: id },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }
}
