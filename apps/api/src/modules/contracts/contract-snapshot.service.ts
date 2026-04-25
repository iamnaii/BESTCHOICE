import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hasCrossBranchAccess } from '../auth/branch-access.util';

export interface BranchAccessUser {
  id: string;
  role: string;
  branchId: string | null;
}

/**
 * Lightweight snapshot payload returned by `GET /contracts/:id/snapshot`.
 *
 * Designed for the Customer 360 hover/long-press preview card on the
 * collections page. Targets sub-100ms latency by avoiding the full
 * timeline payload — only aggregates that fit in a single render.
 */
export interface ContractSnapshot {
  contractId: string;
  contractNumber: string;
  status: string;
  customer: {
    id: string;
    name: string;
    phone: string;
  };
  product: {
    name: string;
  };
  totals: {
    totalAmount: number;
    outstanding: number;
    installmentsTotal: number;
    installmentsRemaining: number;
  };
  lastPromise: {
    settlementDate: string;
    result: string;
    notes: string | null;
  } | null;
  lastLine: {
    timestamp: string;
    read: boolean;
  } | null;
  lastCollectorComment: {
    text: string;
    truncated: boolean;
    by: string | null;
    at: string;
  } | null;
}

const COMMENT_TRUNCATE_AT = 100;

@Injectable()
export class ContractSnapshotService {
  constructor(private prisma: PrismaService) {}

  /**
   * Build the lightweight snapshot for the Customer 360 preview card.
   *
   * Five small parallel queries — much faster than the full Customer 360
   * timeline because we never load the full payment / dunning / audit
   * history. Branch-access enforced identically to ContractsService.findOne().
   */
  async getSnapshot(id: string, user?: BranchAccessUser): Promise<ContractSnapshot> {
    const contract = await this.prisma.contract.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        branchId: true,
        customerId: true,
        totalMonths: true,
        monthlyPayment: true,
        sellingPrice: true,
        downPayment: true,
        interestTotal: true,
        storeCommission: true,
        vatAmount: true,
        collectionNotes: true,
        updatedAt: true,
        customer: {
          select: { id: true, name: true, phone: true },
        },
        product: { select: { name: true } },
      },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    if (user && !hasCrossBranchAccess(user)) {
      if (user.branchId && contract.branchId !== user.branchId) {
        throw new ForbiddenException('ไม่สามารถเข้าถึงสัญญาข้ามสาขาได้');
      }
    }

    const [paymentAgg, paidCountAgg, lastPromise, lastLine] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { contractId: id, deletedAt: null },
        _sum: { amountDue: true, amountPaid: true },
      }),
      this.prisma.payment.count({
        where: { contractId: id, deletedAt: null, status: 'PAID' },
      }),
      this.prisma.callLog.findFirst({
        where: {
          contractId: id,
          deletedAt: null,
          settlementDate: { not: null },
        },
        orderBy: { calledAt: 'desc' },
        select: {
          settlementDate: true,
          result: true,
          settlementNotes: true,
          notes: true,
          brokenAt: true,
        },
      }),
      // Latest LINE message for the customer's chat room (LINE_FINANCE channel
      // only — collections context). We pick the most recent INBOUND OR
      // OUTBOUND message and surface delivered/read state when available.
      this.prisma.chatMessage.findFirst({
        where: {
          deletedAt: null,
          room: {
            customerId: contract.customerId,
            channel: 'LINE_FINANCE',
          },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          readAt: true,
          deliveredAt: true,
        },
      }),
    ]);

    const totalAmount = Number(paymentAgg._sum.amountDue ?? 0);
    const outstanding = Math.max(
      0,
      totalAmount - Number(paymentAgg._sum.amountPaid ?? 0),
    );
    const installmentsRemaining = Math.max(0, contract.totalMonths - paidCountAgg);

    // Truncate the most recent collection note. We do not have a per-comment
    // table, so the snapshot reads from Contract.collectionNotes (single
    // free-text field updated by ContactLogDialog). Truncated at 100 chars.
    const noteRaw = (contract.collectionNotes ?? '').trim();
    const truncated = noteRaw.length > COMMENT_TRUNCATE_AT;
    const lastCollectorComment = noteRaw.length
      ? {
          text: truncated ? `${noteRaw.slice(0, COMMENT_TRUNCATE_AT)}…` : noteRaw,
          truncated,
          by: null,
          at: contract.updatedAt.toISOString(),
        }
      : null;

    return {
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      status: contract.status,
      customer: {
        id: contract.customer.id,
        name: contract.customer.name,
        phone: contract.customer.phone,
      },
      product: { name: contract.product?.name ?? '—' },
      totals: {
        totalAmount,
        outstanding,
        installmentsTotal: contract.totalMonths,
        installmentsRemaining,
      },
      lastPromise: lastPromise?.settlementDate
        ? {
            settlementDate: lastPromise.settlementDate.toISOString(),
            result: lastPromise.brokenAt ? 'BROKEN' : lastPromise.result,
            notes: lastPromise.settlementNotes ?? lastPromise.notes ?? null,
          }
        : null,
      lastLine: lastLine
        ? {
            timestamp: lastLine.createdAt.toISOString(),
            read: !!lastLine.readAt,
          }
        : null,
      lastCollectorComment,
    };
  }
}
