import { readFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { CUSTOMER_BOUGHT_CONTRACT_STATUSES, CUSTOMER_BOUGHT_SALE_TYPES } from '@installment/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { BOUGHT_WHERE } from '../customers/services/customer-query.service';

const RECOMPUTE_BATCH = 500;
/** ไฟล์ SQL ถูกคัดลอกเข้า dist ผ่าน nest-cli.json assets และตรวจใน verify:assets */
const loadSql = (name: string) => readFileSync(join(__dirname, 'sql', name), 'utf8');

/**
 * แคช customer_journey_states — คำนวณได้ใหม่ทั้งหมดจากตารางต้นทาง ห้ามแก้มือ
 * ผู้เรียก: CustomerMergeService หลัง commit (Task 4) · JourneySummaryService ในคำขอ + CustomerJourneyCron (Task 9) · CLI backfill (Task 10)
 * สัญญา: ลูกค้าที่ deleted_at ไม่ว่าง (รวมผู้สนใจที่ถูกรวมแล้ว) ไม่มีแคชของตัวเองเสมอ · contactedAt/firstChannel/firstSource/firstAdCampaignId
 * เลื่อนได้เฉพาะไปค่าที่เก่ากว่า (ON CONFLICT ใน journey-state.sql)
 */
@Injectable()
export class JourneyStateService {
  private readonly stateSql = loadSql('journey-state.sql');
  private readonly probeSql = loadSql('journey-activity-probe.sql');
  private readonly activeSinceSql = loadSql('journey-active-since.sql');

  constructor(private readonly prisma: PrismaService) {}

  async recompute(customerIds: string[]): Promise<void> {
    const ids = [...new Set(customerIds.filter(Boolean))];
    const computedAt = new Date().toISOString();
    for (let i = 0; i < ids.length; i += RECOMPUTE_BATCH) {
      const batch = ids.slice(i, i + RECOMPUTE_BATCH);
      await this.prisma.$executeRawUnsafe(
        this.stateSql,
        batch,
        [...CUSTOMER_BOUGHT_CONTRACT_STATUSES],
        [...CUSTOMER_BOUGHT_SALE_TYPES],
        computedAt,
      );
      // placeholder ที่รวมแล้ว / ลูกค้าที่ถูกลบ ไม่มีแคชของตัวเอง
      await this.prisma.customerJourneyState.deleteMany({
        where: { customerId: { in: batch }, customer: { deletedAt: { not: null } } },
      });
    }
  }

  /** ทุกลูกค้าที่ยังไม่ถูกลบ ทีละ 500 (keyset ตาม id) — cron วันอาทิตย์ */
  async recomputeAll(): Promise<number> {
    let total = 0;
    let cursor: string | undefined;
    let more = true;
    while (more) {
      const rows = await this.prisma.customer.findMany({
        where: { deletedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: 'asc' },
        take: RECOMPUTE_BATCH,
        select: { id: true },
      });
      if (rows.length > 0) {
        await this.recompute(rows.map((row) => row.id));
        total += rows.length;
        cursor = rows[rows.length - 1].id;
      }
      more = rows.length === RECOMPUTE_BATCH;
    }
    return total;
  }

  /** ด่านความถูกต้อง: แคช PURCHASED ต้องเท่ากับจำนวนลูกค้าที่ BOUGHT_WHERE เป็นจริง */
  async purchasedParity(): Promise<{ purchasedStates: number; bought: number }> {
    const [purchasedStates, bought] = await Promise.all([
      this.prisma.customerJourneyState.count({ where: { stage: 'PURCHASED', customer: { deletedAt: null } } }),
      this.prisma.customer.count({ where: { AND: [{ deletedAt: null }, BOUGHT_WHERE] } }),
    ]);
    return { purchasedStates, bought };
  }

  /** familyIds = ลูกค้า + placeholder ที่ merged_into_id ชี้มา — summary ใช้ตัดสินว่าแคชที่เก่ากว่า 15 นาทีต้องคำนวณใหม่ไหม */
  async hasActivitySince(familyIds: string[], since: Date): Promise<boolean> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ active: boolean }>>(this.probeSql, familyIds, since.toISOString());
    return rows[0]?.active === true;
  }

  /** id ลูกค้าปัจจุบัน (placeholder ที่รวมแล้วชี้ไปคนจริง) ที่ขยับตั้งแต่ since — cron journey:recompute */
  async activeCustomerIdsSince(since: Date): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ customer_id: string }>>(this.activeSinceSql, since.toISOString());
    return rows.map((row) => row.customer_id);
  }

  /** ใบขาย INSTALLMENT ถูกสร้างใน tx เดียวกับ activate — สัญญาที่ไม่มี entry CONTRACT_ACTIVATED (Task 5) = hook หลุด */
  async contractsMissingActivationEntry(range: { gte: Date; lt: Date }): Promise<string[]> {
    const sales = await this.prisma.sale.findMany({
      where: { saleType: 'INSTALLMENT', deletedAt: null, contractId: { not: null }, createdAt: range },
      select: { contractId: true },
    });
    const contractIds = sales.map((row) => row.contractId).filter((id): id is string => id !== null);
    if (contractIds.length === 0) return [];
    const entries = await this.prisma.customerJourneyEntry.findMany({
      where: { kind: 'CONTRACT_ACTIVATED', refId: { in: contractIds } },
      select: { refId: true },
    });
    const seen = new Set(entries.map((row) => row.refId));
    return contractIds.filter((id) => !seen.has(id)).sort();
  }
}
