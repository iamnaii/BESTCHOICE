import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CompanyResolverService } from '../journal/company-resolver.service';
import { ExchangeCancelReversalTemplate } from '../journal/cpa-templates/exchange-cancel-reversal.template';
import { ExchangeCancelPenaltyTemplate } from '../journal/cpa-templates/exchange-cancel-penalty.template';

/** จำนวนวันปฏิทิน BKK ระหว่าง 2 เวลา (0 = วันเดียวกัน) */
export function bkkDayDiff(from: Date, to: Date): number {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Bangkok',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const [fy, fm, fd] = fmt(from).split('-').map(Number);
  const [ty, tm, td] = fmt(to).split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

@Injectable()
export class ExchangeCancelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly companyResolver: CompanyResolverService,
    private readonly reversalTemplate: ExchangeCancelReversalTemplate,
    private readonly penaltyTemplate: ExchangeCancelPenaltyTemplate,
  ) {}

  async cancel(id: string, reason: string, user: { id: string }) {
    return this.prisma.$transaction(async (tx) => {
      const req = await (tx as any).contractExchangeRequest.findUnique({
        where: { id },
        include: { oldContract: true, newContract: true },
      });
      if (!req || req.deletedAt) throw new NotFoundException('ไม่พบคำขอเปลี่ยนเครื่อง');
      if (req.status !== 'APPROVED') {
        throw new BadRequestException(
          `ยกเลิกได้เฉพาะคำขอที่อนุมัติแล้ว (สถานะปัจจุบัน: ${req.status})`,
        );
      }
      const now = new Date();
      const shopCompanyId = await this.companyResolver.getShopCompanyId(tx);
      const financeCompanyId = await this.companyResolver.getFinanceCompanyId(tx);

      // ---------- MEMO: สลับกลับ ไม่มี JE ----------
      if (req.mode === 'MEMO') {
        const days = bkkDayDiff(req.memoAppliedAt ?? req.approvedAt ?? req.createdAt, now);
        if (days > 30) throw new BadRequestException('เกิน 30 วันนับจากวันเปลี่ยน — ยกเลิกไม่ได้');
        const newProd = await tx.product.findUniqueOrThrow({
          where: { id: req.newProductId },
          select: { status: true, ownedByCompanyId: true },
        });
        await tx.contract.update({
          where: { id: req.oldContractId },
          data: { productId: req.oldProductId },
        });
        await tx.product.update({
          where: { id: req.oldProductId },
          data: { status: newProd.status, ownedByCompanyId: newProd.ownedByCompanyId } as any,
        });
        await tx.product.update({
          where: { id: req.newProductId },
          data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
        });
        await this.markCanceled(tx, id, user.id, reason, 'FREE_7D', null, [], now);
        await this.audit.log({
          action: 'EXCHANGE_MEMO_CANCELED',
          entity: 'contract_exchange_request',
          entityId: id,
          userId: user.id,
          newValue: { reason, days },
        });
        return { id, cancelWindow: 'FREE_7D', penaltyAmount: null };
      }

      // ---------- PRE_FINALIZE: อนุมัติแล้วแต่ยังไม่ activate (ไม่มี JE) ----------
      const finalized = !!req.oldContract.exchangedAt && req.newContract?.status === 'ACTIVE';
      if (!finalized) {
        if (req.newContractId) {
          await tx.contract.update({
            where: { id: req.newContractId },
            data: { deletedAt: now },
          });
          await tx.product.update({
            where: { id: req.newProductId },
            data: { status: 'IN_STOCK' } as any,
          });
        }
        await this.markCanceled(tx, id, user.id, reason, 'PRE_FINALIZE', null, [], now);
        await this.audit.log({
          action: 'EXCHANGE_CANCELED',
          entity: 'contract_exchange_request',
          entityId: id,
          userId: user.id,
          newValue: { reason, window: 'PRE_FINALIZE' },
        });
        return { id, cancelWindow: 'PRE_FINALIZE', penaltyAmount: null };
      }

      // ---------- FINALIZED (มี JE แล้ว) ----------
      const exchangedAt: Date = req.oldContract.exchangedAt;
      const days = bkkDayDiff(exchangedAt, now);
      if (days > 30) {
        throw new BadRequestException('เกิน 30 วันนับจากวันเปลี่ยนเครื่อง — ยกเลิกไม่ได้');
      }

      const paid = await tx.payment.findFirst({
        where: {
          contractId: req.newContractId,
          deletedAt: null,
          OR: [{ status: 'PAID' }, { amountPaid: { gt: 0 } }],
        },
        select: { id: true },
      });
      if (paid) {
        throw new BadRequestException(
          'มีการชำระเงินบนสัญญาใหม่แล้ว — ต้อง void ใบเสร็จทั้งหมดก่อนยกเลิก',
        );
      }

      // 1) mirror-reverse ทุก JE (รวม A.5 ECL — GL 11-2102 คืนทันที, ECL cron delta เป็น no-op)
      const jeIds = [req.je1aId, req.je2Id, req.je3Id, req.je4Id, req.eclReversalJeId].filter(
        (x: string | null): x is string => !!x,
      );
      const { reversalJeIds } = await this.reversalTemplate.reverse(
        { jeIds, newContractId: req.newContractId },
        tx,
      );

      // 2) penalty เฉพาะวันที่ 8-30 (workbook Case 3B)
      let penalty: Decimal | null = null;
      let penaltyJeId: string | null = null;
      const window = days <= 7 ? 'FREE_7D' : 'PENALTY_8_30D';
      if (window === 'PENALTY_8_30D') {
        if (!req.depositAccountCode) {
          throw new BadRequestException(
            'คำขอนี้ไม่มีบัญชีเงินสด — ระบุ depositAccountCode ตอน submit',
          );
        }
        const pctRow = await tx.systemConfig.findFirst({
          where: { key: 'exchange_cancel_penalty_pct', deletedAt: null },
          select: { value: true },
        });
        const pct = pctRow && Number.isFinite(parseFloat(pctRow.value)) ? parseFloat(pctRow.value) : 5;
        penalty = new Decimal(req.buybackPrice.toString())
          .times(pct)
          .div(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const pje = await this.penaltyTemplate.execute(
          {
            requestId: id,
            oldContractId: req.oldContractId,
            depositAccountCode: req.depositAccountCode,
            penalty,
          },
          tx,
        );
        penaltyJeId = pje.id;
      }

      // 3) restore states (spec §9 step 3)
      await tx.contract.update({
        where: { id: req.oldContractId },
        data: { status: 'ACTIVE', exchangedAt: null } as any, // overdue cron จัดสถานะจริงต่อ; 2A cron backfill งวดที่พลาดใน tick ถัดไป
      });
      await tx.product.update({
        where: { id: req.oldProductId },
        data: { status: 'SOLD_INSTALLMENT', ownedByCompanyId: financeCompanyId } as any,
      });
      await tx.contract.update({
        where: { id: req.newContractId },
        data: { status: 'CANCELED' } as any,
      });
      await tx.payment.updateMany({
        where: { contractId: req.newContractId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.installmentSchedule.updateMany({
        where: { contractId: req.newContractId, deletedAt: null },
        data: { deletedAt: now },
      });
      await tx.product.update({
        where: { id: req.newProductId },
        data: { status: 'IN_STOCK', ownedByCompanyId: shopCompanyId } as any,
      });

      await this.markCanceled(tx, id, user.id, reason, window, penalty, reversalJeIds, now, penaltyJeId);
      await this.audit.log({
        action: 'EXCHANGE_CANCELED',
        entity: 'contract_exchange_request',
        entityId: id,
        userId: user.id,
        newValue: {
          reason,
          window,
          days,
          penaltyAmount: penalty?.toFixed(2) ?? null,
          reversalCount: reversalJeIds.length,
        },
      });
      return { id, cancelWindow: window, penaltyAmount: penalty?.toFixed(2) ?? null };
    });
  }

  private async markCanceled(
    tx: Prisma.TransactionClient,
    id: string,
    userId: string,
    reason: string,
    window: string,
    penalty: Decimal | null,
    reversalJeIds: string[],
    now: Date,
    penaltyJeId: string | null = null,
  ) {
    const lock = await (tx as any).contractExchangeRequest.updateMany({
      where: { id, status: 'APPROVED', deletedAt: null },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        canceledById: userId,
        cancelReason: reason,
        cancelWindow: window,
        penaltyAmount: penalty,
        penaltyJeId,
        reversalJeIds,
      },
    });
    if (lock.count !== 1) throw new ConflictException('คำขอถูกยกเลิกไปแล้ว หรือสถานะเปลี่ยน');
  }
}
