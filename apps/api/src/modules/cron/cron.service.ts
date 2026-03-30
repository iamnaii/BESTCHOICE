import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { OverdueService } from '../overdue/overdue.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../prisma/prisma.service';
import { LineOaService } from '../line-oa/line-oa.service';
import { buildOverdueNoticeFlex } from '../line-oa/flex-messages/overdue-notice.flex';

@Injectable()
export class CronService {
  private readonly logger = new Logger(CronService.name);

  constructor(
    private readonly overdueService: OverdueService,
    private readonly notificationsService: NotificationsService,
    private readonly prisma: PrismaService,
    private readonly lineOaService: LineOaService,
  ) {}

  /**
   * ทุกวันตี 1: คำนวณ late fees สำหรับ payments ที่เลยกำหนดชำระ
   * - ใช้ bulk SQL UPDATE (ไม่มี N+1)
   * - อ่านค่า late_fee_per_day, late_fee_cap จาก systemConfig
   * - ข้าม payments ที่ตั้ง late_fee_waived = true
   */
  @Cron('0 1 * * *')
  async handleLateFeeCalculation() {
    this.logger.log('Starting daily late fee calculation...');
    try {
      const result = await this.overdueService.calculateLateFees();
      this.logger.log(`Late fee calculation complete: ${result.updated} payments updated`);
    } catch (error) {
      this.logger.error(
        `Late fee calculation failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * ทุกวันตี 2: อัปเดตสถานะสัญญา
   * - ACTIVE → OVERDUE: ค้างชำระเกิน overdue_days_threshold วัน (default 7)
   * - OVERDUE → DEFAULT: ค้างชำระติดต่อกัน ≥2 งวด
   * - สร้าง audit log สำหรับทุกสัญญาที่เปลี่ยนสถานะ
   * - ส่ง LINE notification ให้ลูกค้าที่สถานะเปลี่ยน
   */
  @Cron('0 2 * * *')
  async handleContractStatusUpdate() {
    this.logger.log('Starting daily contract status update...');
    try {
      const result = await this.overdueService.updateContractStatuses();
      this.logger.log(
        `Contract status update complete: ${result.overdueUpdated} → OVERDUE, ${result.defaultUpdated} → DEFAULT`,
      );

      // Send LINE notifications to customers whose contracts changed status
      const changedIds = [...result.overdueIds, ...result.defaultIds];
      if (changedIds.length > 0) {
        await this.notifyStatusChangedCustomers(changedIds);
      }
    } catch (error) {
      this.logger.error(
        `Contract status update failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * ทุกวันตี 3: escalate dunning stage อัตโนมัติตามจำนวนวัน overdue
   * - 1-7 วัน   → REMINDER
   * - 8-30 วัน  → NOTICE
   * - 31-60 วัน → FINAL_WARNING
   * - >60 วัน   → LEGAL_ACTION
   * ไม่มี de-escalate — ขยับขึ้นอย่างเดียว
   * ส่ง LINE notification ตามระดับ dunning stage
   */
  @Cron('0 3 * * *')
  async handleDunningEscalation() {
    this.logger.log('Starting daily dunning escalation...');
    try {
      const result = await this.overdueService.escalateDunningStages();

      // Send stage-specific LINE notifications
      let notified = 0;
      for (const esc of result.escalated) {
        try {
          const contract = await this.prisma.contract.findUnique({
            where: { id: esc.contractId },
            include: {
              customer: { select: { name: true, lineId: true, phone: true } },
              payments: {
                where: {
                  status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
                  dueDate: { lt: new Date() },
                },
                orderBy: { installmentNo: 'asc' },
              },
            },
          });
          if (!contract?.customer?.lineId) continue;

          const totalOverdue = contract.payments.reduce(
            (sum, p) => sum.add(new Prisma.Decimal(p.amountDue)).sub(new Prisma.Decimal(p.amountPaid)).add(new Prisma.Decimal(p.lateFee)),
            new Prisma.Decimal(0),
          ).toNumber();

          const stageMessages: Record<string, string> = {
            REMINDER: `แจ้งเตือน: คุณ${contract.customer.name} มียอดค้างชำระ ${totalOverdue.toLocaleString()} บาท สัญญา ${esc.contractNumber} กรุณาชำระโดยเร็ว`,
            NOTICE: `แจ้งค้างชำระ: คุณ${contract.customer.name} มียอดค้างชำระ ${totalOverdue.toLocaleString()} บาท ค้างชำระ ${esc.daysOverdue} วัน กรุณาติดต่อชำระเงินทันที`,
            FINAL_WARNING: `เตือนครั้งสุดท้าย: คุณ${contract.customer.name} ค้างชำระ ${esc.daysOverdue} วัน ยอด ${totalOverdue.toLocaleString()} บาท หากไม่ชำระภายใน 30 วัน จะดำเนินการตามกฎหมาย`,
            LEGAL_ACTION: `แจ้งดำเนินการ: สัญญา ${esc.contractNumber} ค้างชำระเกิน 60 วัน ทางร้านจะดำเนินการยึดคืนสินค้า กรุณาติดต่อร้านทันที`,
          };

          const message = stageMessages[esc.to];
          if (message) {
            await this.notificationsService.send({
              channel: 'LINE',
              recipient: contract.customer.lineId,
              subject: `Dunning: ${esc.to}`,
              message,
              relatedId: esc.contractId,
              fallbackPhone: contract.customer.phone || undefined,
            });
            notified++;
          }
        } catch (err) {
          this.logger.warn(
            `Failed to send dunning notification for ${esc.contractNumber}: ${err}`,
          );
        }
      }

      this.logger.log(
        `Dunning escalation complete: ${result.escalated.length} escalated, ${notified} notified`,
      );
    } catch (error) {
      this.logger.error(
        `Dunning escalation failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Send LINE overdue/default notice to customers whose contracts just changed status
   */
  private async notifyStatusChangedCustomers(contractIds: string[]) {
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: contractIds } },
      include: {
        customer: { select: { name: true, lineId: true, phone: true } },
        payments: {
          where: {
            status: { in: ['PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
            dueDate: { lt: new Date() },
          },
          orderBy: { installmentNo: 'asc' },
        },
      },
    });

    let sent = 0;
    for (const contract of contracts) {
      const lineId = contract.customer?.lineId;
      if (!lineId) continue;

      try {
        const totalOverdue = contract.payments.reduce(
          (sum, p) => sum.add(new Prisma.Decimal(p.amountDue)).sub(new Prisma.Decimal(p.amountPaid)).add(new Prisma.Decimal(p.lateFee)),
          new Prisma.Decimal(0),
        ).toNumber();
        const oldestDue = contract.payments[0]?.dueDate;
        const daysOverdue = oldestDue
          ? Math.floor((Date.now() - oldestDue.getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        const lateFee = contract.payments.reduce((sum, p) => sum.add(new Prisma.Decimal(p.lateFee)), new Prisma.Decimal(0)).toNumber();
        const flex = buildOverdueNoticeFlex({
          customerName: contract.customer?.name || '-',
          contractNumber: contract.contractNumber,
          installmentNo: contract.payments[0]?.installmentNo || 0,
          totalInstallments: contract.totalMonths,
          amountDue: totalOverdue,
          lateFee,
          totalOutstanding: totalOverdue,
          dueDate: oldestDue?.toLocaleDateString('th-TH') || '-',
          daysOverdue,
        });

        await this.lineOaService.sendFlexMessage(lineId, flex);
        sent++;
      } catch (err) {
        this.logger.warn(
          `Failed to notify customer for contract ${contract.contractNumber}: ${err}`,
        );
      }
    }

    this.logger.log(
      `Status change LINE notifications: ${sent} sent out of ${contracts.length} contracts`,
    );
  }
}
