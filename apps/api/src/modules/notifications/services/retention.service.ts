import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Data-retention cleanup bodies extracted from the scheduler: weekly contract /
 * token / consent / log retention, monthly ChatMessage soft-delete, and monthly
 * DocumentAuditLog hard-delete. Each step is best-effort + independently
 * try/caught — NOT atomic — and preserved exactly. The owning @Cron handlers
 * stay on SchedulerService (decorated + try/catch + reportCronFailure shell).
 *
 * Plain class (not @Injectable) — constructed internally by SchedulerService.
 */
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Weekly data retention cleanup (the body of handleDataRetention).
   */
  async runDataRetention() {
    const now = new Date();
    const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

    // Soft-delete completed contracts older than 5 years
    const completedAnonymized = await this.prisma.contract.updateMany({
      where: {
        status: { in: ['COMPLETED', 'EARLY_PAYOFF'] },
        updatedAt: { lt: fiveYearsAgo },
        deletedAt: null,
      },
      data: { deletedAt: now },
    });

    // Soft-delete closed bad debt contracts older than 2 years
    const cancelledAnonymized = await this.prisma.contract.updateMany({
      where: {
        status: { in: ['CLOSED_BAD_DEBT', 'EXCHANGED'] },
        updatedAt: { lt: twoYearsAgo },
        deletedAt: null,
      },
      data: { deletedAt: now },
    });

    // Clean expired customer access tokens
    let tokensCleared = 0;
    try {
      const result = await this.prisma.customerAccessToken.deleteMany({
        where: { expiresAt: { lt: now } },
      });
      tokensCleared = result.count;
    } catch {
      // CustomerAccessToken table might not exist yet
    }

    // Clean expired PDPA consents (withdrawn > 1 year)
    let consentsCleared = 0;
    try {
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      const result = await this.prisma.pDPAConsent.updateMany({
        where: { status: 'REVOKED', revokedAt: { lt: oneYearAgo }, deletedAt: null },
        data: { deletedAt: now },
      });
      consentsCleared = result.count;
    } catch {
      // PDPAConsent table might not exist yet
    }

    // ─── Append-only log retention (audit + notifications) ────────────
    // PDPA: ลูกค้ามีสิทธิ์ขอให้ลบข้อมูลส่วนตัว — append-only logs ที่
    // โตแบบไม่มีหยุดเป็น compliance risk + ทำให้ DB ช้า. นโยบาย:
    //   - AuditLog:        เก็บ 7 ปี (Thai Revenue Code + financial industry
    //                      standard). Soft-archive via archivedAt instead of
    //                      DELETE — a DB trigger also rejects DELETE so this
    //                      logic cannot be weaponised by a malicious path.
    //   - NotificationLog (finance: DUNNING/REMINDER/TRANSACTIONAL):
    //                      เก็บ 5 ปี — พ.ร.บ.ทวงถามหนี้ มาตรา 16 + Revenue Code
    //                      (ต้องเก็บ delivery proof สำหรับ debt collection audit)
    //   - NotificationLog (STAFF/MARKETING/legacy null):
    //                      เก็บ 1 ปี (delivery report ไม่ต้องเก็บนาน)
    const sevenYearsAgo = new Date(
      now.getFullYear() - 7,
      now.getMonth(),
      now.getDate(),
    );
    const oneYearAgoLogs = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const fiveYearsAgoLogs = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());

    let auditLogsArchived = 0;
    try {
      const result = await this.prisma.auditLog.updateMany({
        where: { createdAt: { lt: sevenYearsAgo }, archivedAt: null },
        data: { archivedAt: now },
      });
      auditLogsArchived = result.count;
    } catch (err) {
      this.logger.warn(`AuditLog archive failed: ${err instanceof Error ? err.message : err}`);
    }

    // Finance categories — 5 year retention (พ.ร.บ.ทวงถามหนี้ มาตรา 16)
    let financeLogsCleared = 0;
    try {
      const result = await this.prisma.notificationLog.deleteMany({
        where: {
          category: { in: ['DUNNING', 'REMINDER', 'TRANSACTIONAL'] },
          createdAt: { lt: fiveYearsAgoLogs },
        },
      });
      financeLogsCleared = result.count;
    } catch (err) {
      this.logger.warn(
        `NotificationLog finance cleanup failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Non-finance / legacy — 1 year retention
    let otherLogsCleared = 0;
    try {
      const result = await this.prisma.notificationLog.deleteMany({
        where: {
          OR: [{ category: { in: ['STAFF', 'MARKETING'] } }, { category: null }],
          createdAt: { lt: oneYearAgoLogs },
        },
      });
      otherLogsCleared = result.count;
    } catch (err) {
      this.logger.warn(
        `NotificationLog other cleanup failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    this.logger.log(
      `Data retention complete: ${completedAnonymized.count} completed, ${cancelledAnonymized.count} cancelled soft-deleted, ` +
      `${tokensCleared} expired tokens, ${consentsCleared} withdrawn consents, ` +
      `${auditLogsArchived} audit logs archived, ` +
      `${financeLogsCleared} finance notification logs (>5y) + ${otherLogsCleared} other (>1y) cleared`,
    );
  }

  /**
   * Monthly ChatMessage retention cleanup (the body of handleChatMessageRetention).
   */
  async runChatMessageRetention() {
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());

    const result = await this.prisma.chatMessage.updateMany({
      where: {
        createdAt: { lt: sixMonthsAgo },
        deletedAt: null,
      },
      data: { deletedAt: now },
    });

    this.logger.log(`ChatMessage retention complete: ${result.count} messages soft-deleted (older than 6 months)`);
  }

  /**
   * Monthly DocumentAuditLog retention cleanup (the body of handleDocumentAuditLogRetention).
   */
  async runDocumentAuditLogRetention() {
    const now = new Date();
    const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());

    const result = await this.prisma.documentAuditLog.deleteMany({
      where: { createdAt: { lt: twoYearsAgo } },
    });

    this.logger.log(`DocumentAuditLog retention complete: ${result.count} entries hard-deleted (older than 2 years)`);
  }
}
