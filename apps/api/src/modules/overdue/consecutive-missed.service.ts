import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Client = Prisma.TransactionClient | PrismaService;

@Injectable()
export class ConsecutiveMissedService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single source of truth for the consecutive-missed streak (moved VERBATIM
   * from overdue-lifecycle-cron's inline CTE, then parameterised). Returns
   * `contractId -> max run of consecutive unpaid-overdue installments`.
   * "Unpaid-overdue" = status IN (PENDING, OVERDUE, PARTIALLY_PAID) AND due_date < asOf.
   * Only contracts with a run >= 1 appear in the map.
   */
  async getStreaks(
    opts: { contractIds?: string[]; statuses?: string[] },
    asOf: Date,
    client: Client = this.prisma,
  ): Promise<Map<string, number>> {
    if (opts.contractIds && opts.contractIds.length === 0) return new Map();

    const statusFilter = opts.statuses?.length
      ? Prisma.sql`AND c."status"::text IN (${Prisma.join(opts.statuses)})`
      : Prisma.empty;
    const idFilter = opts.contractIds?.length
      ? Prisma.sql`AND p."contract_id" IN (${Prisma.join(opts.contractIds)})`
      : Prisma.empty;

    const rows = await (client as any).$queryRaw(Prisma.sql`
      WITH payment_streaks AS (
        SELECT
          p."contract_id",
          p."installment_no",
          p."status",
          p."due_date",
          ROW_NUMBER() OVER (PARTITION BY p."contract_id" ORDER BY p."installment_no") -
          ROW_NUMBER() OVER (PARTITION BY p."contract_id",
            CASE WHEN p."status" IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID') AND p."due_date" < ${asOf}
                 THEN 1 ELSE 0 END
            ORDER BY p."installment_no") AS grp
        FROM "payments" p
        JOIN "contracts" c ON c."id" = p."contract_id"
        WHERE c."deleted_at" IS NULL AND p."deleted_at" IS NULL ${statusFilter} ${idFilter}
      ),
      max_consecutive AS (
        SELECT "contract_id" AS id, MAX(cnt) AS consecutive
        FROM (
          SELECT "contract_id", grp, COUNT(*) AS cnt
          FROM payment_streaks
          WHERE "status" IN ('PENDING', 'OVERDUE', 'PARTIALLY_PAID') AND "due_date" < ${asOf}
          GROUP BY "contract_id", grp
        ) sub
        GROUP BY "contract_id"
      )
      SELECT id, consecutive::int FROM max_consecutive WHERE consecutive >= 1
    `) as { id: string; consecutive: number }[];

    return new Map(rows.map((r) => [r.id, r.consecutive]));
  }
}
