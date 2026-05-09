import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface StuckContractRow {
  contractId: string;
  contractNumber: string;
  customerName: string;
  customerPhone: string | null;
  branchName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  daysIdle: number;
  outstanding: number;
}

interface RawRow {
  id: string;
  contract_number: string;
  customer_name: string;
  customer_phone: string | null;
  branch_name: string;
  assigned_to_id: string | null;
  assigned_to_name: string | null;
  last_activity: Date | null;
  outstanding: number | string | null;
}

@Injectable()
export class StuckContractsService {
  private readonly logger = new Logger(StuckContractsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Returns active overdue contracts that have had no audit log, no call log,
   * and no dunning action in the past `days` days. These are at risk of being
   * "forgotten" — a collector should reach out or the contract should be
   * reassigned.
   *
   * Threshold: takes the MAX of (last call_log, last dunning_action,
   * contract.last_contact_date). If that timestamp is older than `days` days
   * ago (or null entirely), the contract is "stuck".
   */
  async getStuckContracts(params: { days: number }): Promise<StuckContractRow[]> {
    const days = Math.max(1, Math.min(params.days, 365));
    try {
      const rows = await this.prisma.$queryRawUnsafe<RawRow[]>(
        `
        WITH last_activity AS (
          SELECT
            c.id AS contract_id,
            GREATEST(
              COALESCE(MAX(cl.called_at), '1970-01-01'::timestamp),
              COALESCE(MAX(da.created_at), '1970-01-01'::timestamp),
              COALESCE(c.last_contact_date, '1970-01-01'::timestamp)
            ) AS last_activity
          FROM contracts c
          LEFT JOIN call_logs cl ON cl.contract_id = c.id AND cl.deleted_at IS NULL
          LEFT JOIN dunning_actions da
            ON da.contract_id = c.id AND da.deleted_at IS NULL
          WHERE c.deleted_at IS NULL
            AND c.status IN ('OVERDUE', 'DEFAULT', 'TERMINATED')
          GROUP BY c.id, c.last_contact_date
        ),
        outstanding AS (
          SELECT
            p.contract_id,
            SUM((p.amount_due - p.amount_paid + p.late_fee))::numeric AS amt
          FROM payments p
          WHERE p.deleted_at IS NULL
            AND p.status IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID')
          GROUP BY p.contract_id
        )
        SELECT
          c.id,
          c.contract_number,
          cu.name AS customer_name,
          cu.phone AS customer_phone,
          b.name AS branch_name,
          c.assigned_to_id,
          u.name AS assigned_to_name,
          la.last_activity,
          COALESCE(o.amt, 0) AS outstanding
        FROM contracts c
        INNER JOIN customers cu ON cu.id = c.customer_id
        INNER JOIN branches b ON b.id = c.branch_id
        LEFT JOIN users u ON u.id = c.assigned_to_id
        INNER JOIN last_activity la ON la.contract_id = c.id
        LEFT JOIN outstanding o ON o.contract_id = c.id
        WHERE c.deleted_at IS NULL
          AND c.status IN ('OVERDUE', 'DEFAULT', 'TERMINATED')
          AND la.last_activity < NOW() - ($1::int * INTERVAL '1 day')
        ORDER BY la.last_activity ASC
        LIMIT 200
        `,
        days,
      );

      const now = Date.now();
      return rows.map((r) => {
        const lastMs = r.last_activity ? r.last_activity.getTime() : 0;
        const idleMs = Math.max(0, now - lastMs);
        return {
          contractId: r.id,
          contractNumber: r.contract_number,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          branchName: r.branch_name,
          assignedToId: r.assigned_to_id,
          assignedToName: r.assigned_to_name,
          daysIdle: Math.floor(idleMs / 86400000),
          outstanding: r.outstanding == null ? 0 : Number(r.outstanding),
        };
      });
    } catch (err) {
      this.logger.error('stuck contracts query failed', err);
      return [];
    }
  }
}
