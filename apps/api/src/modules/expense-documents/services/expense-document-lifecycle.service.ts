import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { Prisma, DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { getApproversList } from '../approval-config.util';
import { readBoolFlag } from '../../../utils/config.util';

/**
 * Phase 2 of the transactional-core decompose: the document LIFECYCLE methods of
 * ExpenseDocumentsService, extracted VERBATIM. The facade delegates to this
 * service so the public contract (controller + callers) is unchanged.
 *
 * Phase 2a (this slice) moves the 3 lowest-risk members: submitForApproval,
 * notifyApprovers (private), softDelete — plus a verbatim COPY of the private
 * readBoolFlag wrapper they need. Later slices 2b/2c ADD post/approve/
 * executePostBody/voidDocument to THIS service.
 *
 * This service OWNS the notifications dependency (the facade sheds it) — the
 * trailing-optional `notifications?` ctor param preserves notifyApprovers'
 * early-return behavior when notifications is not wired (tests can omit it).
 *
 * Behavior-preserving — method bodies are byte-identical to the pre-extraction
 * facade; only import paths were adjusted for the deeper directory.
 */
@Injectable()
export class ExpenseDocumentLifecycleService {
  private readonly logger = new Logger(ExpenseDocumentLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications?: NotificationsService,
  ) {}

  // ─── Submit for approval (DRAFT → PENDING_APPROVAL) ─────────────────
  // D1.2.1.1 — entry point of the Approval Workflow. Only callable when
  // SystemConfig `approval_enabled` is true. Without that flag set the
  // legacy lifecycle (DRAFT → POSTED) applies and there's no reason to
  // visit PENDING_APPROVAL.
  //
  // NOTE: this references the new enum values `PENDING_APPROVAL` and
  // `APPROVED` which land on the schema in D1.2.1.6 (sibling PR). Until
  // that migrates, this PR uses `as unknown as DocumentStatus` casts. At
  // merge time accept the conflict on `schema.prisma` from 1.6.
  async submitForApproval(id: string, userId: string) {
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `post:${id}`);

      const approvalEnabled = await this.readBoolFlag(tx, 'approval_enabled', false);
      if (!approvalEnabled) {
        throw new BadRequestException(
          'ฟีเจอร์ขออนุมัติยังไม่เปิดใช้งาน — กรุณาเปิด SystemConfig `approval_enabled` ก่อน',
        );
      }

      const doc = await tx.expenseDocument.findUniqueOrThrow({ where: { id } });
      if (doc.deletedAt) throw new NotFoundException('เอกสารถูกลบแล้ว');
      if (doc.status !== 'DRAFT') {
        throw new BadRequestException(
          `ส่งขออนุมัติได้เฉพาะเอกสาร DRAFT — สถานะปัจจุบัน ${doc.status}`,
        );
      }

      const PENDING_APPROVAL = 'PENDING_APPROVAL' as unknown as DocumentStatus;
      const result = await tx.expenseDocument.update({
        where: { id },
        data: { status: PENDING_APPROVAL },
      });

      // D1.2.1.5 — APPROVAL_REQUESTED audit log. Atomic with the status flip.
      // PII-safe payload: documentNumber + totalAmount + documentType only.
      // Salary lines, employee tax IDs, etc. NEVER captured here per PDPA.
      await tx.auditLog.create({
        data: {
          action: 'APPROVAL_REQUESTED',
          entity: 'expense_document',
          entityId: id,
          userId,
          oldValue: { status: 'DRAFT' },
          newValue: {
            status: 'PENDING_APPROVAL',
            documentNumber: result.number,
            documentType: result.documentType,
            totalAmount: result.totalAmount.toString(),
            requesterUserId: userId,
          },
        },
      });

      return result;
    });

    // D1.2.1.5 — fan out notifications OUTSIDE the tx. A notification failure
    // must never roll back the status flip already persisted.
    await this.notifyApprovers({
      id: updated.id,
      documentNumber: updated.number,
      documentType: updated.documentType,
      totalAmount: updated.totalAmount,
    });

    return updated;
  }

  /**
   * D1.2.1.5 — Fan out IN_APP notifications to configured approvers when
   * a doc enters PENDING_APPROVAL. Runs OUTSIDE the parent transaction —
   * a notification failure NEVER rolls back the status flip.
   *
   * - Reads `notification_on_pending` (default true) — opt-out per OWNER.
   * - Reads + validates `approvers_list` against the User table.
   * - Falls back to OWNER users when the list is empty (root-of-trust).
   * - Uses `Promise.allSettled` so one bad recipient never blocks the rest.
   * - Errors are logged + swallowed (no rethrow).
   */
  private async notifyApprovers(doc: {
    id: string;
    documentNumber: string;
    documentType: string;
    totalAmount: Prisma.Decimal | string | number;
  }): Promise<void> {
    try {
      const enabled = await this.readBoolFlag(
        this.prisma,
        'notification_on_pending',
        true,
      );
      if (!enabled) return;
      if (!this.notifications) return;

      // Resolve recipients: approvers_list → fallback to OWNER users.
      let recipients = await getApproversList(this.prisma);
      if (recipients.length === 0) {
        const owners = await this.prisma.user.findMany({
          where: { role: 'OWNER', isActive: true, deletedAt: null },
          select: { id: true },
        });
        recipients = owners.map((u) => u.id);
      }
      if (recipients.length === 0) return;

      const totalStr = new Prisma.Decimal(doc.totalAmount.toString()).toFixed(2);
      const message =
        `เอกสาร ${doc.documentNumber} (${doc.documentType}) ` +
        `ยอด ${totalStr} บาท รออนุมัติ`;

      await Promise.allSettled(
        recipients.map((userId) =>
          this.notifications!.send({
            channel: 'IN_APP',
            recipient: userId,
            subject: 'มีเอกสารรออนุมัติ',
            message,
            relatedId: doc.id,
          }),
        ),
      );
    } catch (err) {
      // Log and swallow — notification failure must NOT roll back the
      // status flip already persisted in the parent transaction.
      this.logger.warn(
        `notifyApprovers(${doc.id}) failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── Soft delete (DRAFT only) ────────────────────────────────────────
  async softDelete(id: string, _userId: string) {
    const existing = await this.prisma.expenseDocument.findUniqueOrThrow({ where: { id } });
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('ลบได้เฉพาะเอกสาร DRAFT — เอกสารที่ post ไปแล้ว ใช้ void แทน');
    }
    if (existing.deletedAt) {
      throw new BadRequestException('เอกสารถูกลบไปแล้ว');
    }
    return this.prisma.expenseDocument.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── D1.* — Service-side SystemConfig flag readers ─────────────────────
  // Delegates to shared `readBoolFlag` in utils/config.util
  // so every service uses identical parsing + defensive try/catch semantics.
  // Kept as private wrappers for ergonomic (this.readBoolFlag) call sites.
  // Spec-defined defaults flow through `fallback` and preserve first-boot
  // behaviour when the SystemConfig row is missing.
  private async readBoolFlag(
    tx: Prisma.TransactionClient | PrismaService,
    key: string,
    fallback: boolean,
  ): Promise<boolean> {
    return readBoolFlag(tx, key, fallback);
  }
}
