import type {
  CustomerContactChangedField,
  CustomerUpdateContactAcknowledgement,
} from '@installment/shared';
import { domainAccessClient } from '../employee-access/access-execution-context';
import {
  AccessPartySourceService,
  partyWriteExecution,
} from '../employee-access/access-party-source.service';
import { JourneyEntryWriter } from '../customer-journey/journey-entry-writer.service';
import { contactAddedEntry, isBlankContact } from '../customer-journey/chat-identity-entries';
import { Injectable, Optional, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCustomerContactDto } from './dto/skip-tracing.dto';
import { CustomerPiiService } from './customer-pii.service';
import { lockCustomerPhone } from './customer-phone-lock';
import { findLivePhoneOwner } from './customer-phone-owner';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';
import { staffLineFinanceChange, unlinkFinanceLine } from '../line-oa/services/finance-line-link';

const THAI_MOBILE_RE = /^0\d{9}$/;
const INVALID_PHONE_MSG = 'เบอร์โทรต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0';

/** เบอร์ใหม่ถูกเก็บลงช่องไหน — null = ไม่ได้ส่งเบอร์มา หรือตรงกับเบอร์หลักเดิม */
export type SkipTracingPhoneStoredAs = 'PRIMARY' | 'SECONDARY' | null;

const CUSTOMER_CONTACT_SELECT = {
  id: true,
  phone: true,
  phoneSecondary: true,
  lineIdFinance: true,
  status: true,
} satisfies Prisma.CustomerSelect;

/**
 * Skip-tracing service (P2 Collections — D6).
 *
 * Updates a customer's reachability data when collectors locate a new phone
 * number / LINE ID, or flags them as LOST when all leads are exhausted.
 *
 * เบอร์ใหม่ (คำตัดสินเจ้าของ 2026-09-17):
 *  - normalize (`normalizeThaiPhone`) แล้วต้องเป็น 10 หลักขึ้นต้น 0
 *  - ทรานแซกชันเดียว: ล็อกเบอร์หลัก (คำสั่งแรก — `.claude/rules/database.md` "ล็อกเบอร์หลักของลูกค้า")
 *    → หาเจ้าของอื่นที่ยังไม่ถูกลบ (`phone` หรือ `phoneHash`) → เขียน
 *  - ไม่มีเจ้าของอื่น → เบอร์หลัก + phoneHash + phoneEncrypted (เดิมเขียนแต่ plaintext ⇒ hash ค้างชี้เบอร์เก่า)
 *  - เป็นของลูกค้าคนอื่น → ไม่แตะเบอร์หลัก เก็บเป็นเบอร์สำรอง (ทับของเดิม — ค่าเก่าอยู่ใน audit)
 *    แล้วบอกผู้ใช้ว่าเป็นเบอร์ของใคร
 *  - ตรงกับเบอร์หลักเดิม → ไม่เปลี่ยนเบอร์ (แต่ซ่อม hash/ciphertext/รูปแบบที่เสียจากบั๊กเดิมในแถวนี้)
 *
 * LINE ID (Task 22 I3): ไม่ตั้ง `line_id_finance` ให้อีก — ผูก LINE การเงินได้ทาง OTP ของลูกค้าเท่านั้น ⇒ ค่าใหม่ = 400 ทั้งคำขอ ·
 * ค่าเดิม = ไม่แตะ · ค่าว่าง = ยกเลิกผูก (`unlinkFinanceLine` แบบ customerId ในทรานแซกชันเดียวกัน)
 *
 * Managed execution joins the owned party transaction for source proof and safe
 * required audit/journey evidence; acknowledgements contain field names only.
 * Legacy calls write a `SKIP_TRACING_UPDATE` audit log entry capturing the old
 * + new contact values + the collector-supplied reason — **หลัง commit**
 * (`AuditService.log` เปิด root-tx ของตัวเอง ห้ามเรียกในทรานแซกชัน).
 */
@Injectable()
export class SkipTracingService {
  constructor(
    private readonly basePrisma: PrismaService,
    private audit: AuditService,
    private pii: CustomerPiiService,
    @Optional() private readonly parties?: AccessPartySourceService,
    @Optional() private readonly journey?: JourneyEntryWriter,
  ) {}

  private get prisma(): PrismaService {
    return domainAccessClient(this.basePrisma);
  }

  async updateContact(
    customerId: string,
    dto: UpdateCustomerContactDto,
    actor: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (dto.newPhone === undefined && dto.newLineId === undefined && !dto.markAsLost) {
      throw new BadRequestException(
        'ต้องระบุเบอร์ใหม่ หรือทำเครื่องหมาย "สูญหาย" อย่างน้อยหนึ่งอย่าง',
      );
    }

    let newPhone: string | undefined;
    if (dto.newPhone !== undefined) {
      newPhone = normalizeThaiPhone(dto.newPhone) ?? '';
      if (!THAI_MOBILE_RE.test(newPhone)) {
        throw new BadRequestException(INVALID_PHONE_MSG);
      }
    }

    const ctx = partyWriteExecution();
    if (ctx) {
      if (actor.userId !== ctx.snapshot.userId) throw new Error('Customer actor mismatch');
      if (!this.parties || !this.journey || !this.pii || !this.audit)
        throw new Error('Required customer enrichment providers unavailable');
    }
    const { existing, updated, phoneStoredAs, phoneOwner, acknowledgement } =
      await this.prisma.$transaction(async (tx) => {
        // ล็อกเบอร์ก่อนอ่านอะไรทั้งสิ้น — การตรวจเจ้าของหลังได้ล็อกจะเห็นแถวที่ผู้ถือล็อกก่อนหน้า commit แล้ว
        if (newPhone) await lockCustomerPhone(tx, this.pii, newPhone);
        if (ctx) await this.parties!.mutation(tx, 'customer', customerId, 'customers.update');

        const current = await tx.customer.findFirst({
          where: { id: customerId, deletedAt: null },
          select: {
            ...CUSTOMER_CONTACT_SELECT,
            phoneHash: true,
            phoneEncrypted: true,
            ...(ctx ? { phoneSecondaryEncrypted: true } : {}),
          },
        });
        if (!current) {
          throw new NotFoundException('ไม่พบลูกค้า');
        }

        // Task 22 I3 — LINE ID ใหม่ไม่ลง line_id_finance อีก (ช่องที่ระบบใช้ส่งข้อความ/อนุญาตหน้า LIFF — ผูกได้ทาง OTP เท่านั้น):
        // ค่าใหม่ = 400 ทั้งคำขอ · ค่าเดิม = ไม่แตะ · ว่าง = ยกเลิกผูก (ตรวจหลังด่านสิทธิ์ของ managed execution ด้านบน)
        const lineFinance = staffLineFinanceChange(dto.newLineId, current.lineIdFinance);

        const canonical = ctx
          ? this.pii.decryptCustomerFields(current, {
              strict: await this.pii.isStrictMode(ctx.client),
            })!
          : current;
        const data: Prisma.CustomerUpdateInput = {};
        let storedAs: SkipTracingPhoneStoredAs = null;
        let owner: { id: string; name: string } | null = null;

        if (newPhone) {
          const newHash = this.pii.hash(newPhone);
          const currentPhone = normalizeThaiPhone(current.phone);
          // plaintext ว่าง (strict mode) = เทียบด้วย hash · มี plaintext = เชื่อ plaintext (hash อาจค้างจากบั๊กเดิม)
          const sameAsPrimary = currentPhone
            ? currentPhone === newPhone
            : !!newHash && current.phoneHash === newHash;

          if (sameAsPrimary) {
            // เบอร์เดิม — แต่แถวที่เสียจากบั๊กเดิม (hash ค้าง/ไม่มี ciphertext) ซ่อมตรงนี้เลย (ถือล็อกอยู่แล้ว)
            // ยังรายงาน phoneStoredAs = null เพราะเบอร์ไม่ได้เปลี่ยน
            if (
              currentPhone &&
              (current.phoneHash !== newHash ||
                !current.phoneEncrypted ||
                current.phone !== newPhone)
            ) {
              const enc = this.pii.encryptCustomerFields({ phone: newPhone });
              data.phone = newPhone;
              data.phoneHash = enc.phoneHash;
              data.phoneEncrypted = enc.phoneEncrypted;
            }
          } else {
            owner = await findLivePhoneOwner(tx, newPhone, newHash, [customerId]);
            if (owner) {
              storedAs = 'SECONDARY';
              const enc = this.pii.encryptCustomerFields({ phoneSecondary: newPhone });
              data.phoneSecondary = newPhone;
              data.phoneSecondaryEncrypted = enc.phoneSecondaryEncrypted;
            } else {
              storedAs = 'PRIMARY';
              const enc = this.pii.encryptCustomerFields({ phone: newPhone });
              data.phone = newPhone;
              data.phoneHash = enc.phoneHash;
              data.phoneEncrypted = enc.phoneEncrypted;
            }
          }
        }
        if (dto.markAsLost) data.status = 'LOST';

        // ยกเลิกผูกก่อนเขียน ⇒ แถวที่คืน (และ audit ค่าใหม่) เป็นค่าหลังล้าง
        if (lineFinance === 'clear') await unlinkFinanceLine(tx, { customerId });
        const row = await tx.customer.update({
          where: { id: customerId },
          data,
          select: CUSTOMER_CONTACT_SELECT,
        });

        if (ctx) {
          const changedFields: CustomerContactChangedField[] = [];
          // A same-primary repair is an actual field write even when its value is unchanged.
          if (data.phone !== undefined) changedFields.push('phone');
          if (data.phoneSecondary !== undefined) changedFields.push('phoneSecondary');
          if (lineFinance === 'clear') changedFields.push('lineIdFinance');
          if (dto.markAsLost && current.status !== 'LOST') changedFields.push('status');
          await this.audit.log(
            {
              userId: ctx.snapshot.userId,
              action: 'SKIP_TRACING_UPDATE',
              entity: 'customer',
              entityId: customerId,
              oldValue: { status: current.status },
              newValue: {
                changedFields,
                status: row.status,
                phoneStoredAs: storedAs,
                reasonProvided: true,
              },
              ipAddress: actor.ipAddress,
              userAgent: actor.userAgent,
            },
            ctx.client,
          );
          // Shared CONTACT_ADDED means the first genuine primary phone only.
          if (storedAs === 'PRIMARY' && isBlankContact(canonical.phone) && !current.phoneHash) {
            await this.journey!.recordInTx(
              ctx.client,
              contactAddedEntry({
                customerId,
                fields: ['phone'],
                via: 'UPDATE',
                actorUserId: ctx.snapshot.userId,
                occurredAt: new Date(),
              }),
            );
          }
          const acknowledgement: CustomerUpdateContactAcknowledgement = {
            id: customerId,
            changedFields,
            phoneStoredAs: storedAs,
          };
          return {
            existing: current,
            updated: row,
            phoneStoredAs: storedAs,
            phoneOwner: null,
            acknowledgement,
          };
        }
        return {
          existing: current,
          updated: row,
          phoneStoredAs: storedAs,
          phoneOwner: owner,
          acknowledgement: undefined,
        };
      });

    if (ctx) return acknowledgement!;

    // Audit trail — old + new values for tamper-evident review (หลัง commit เสมอ)
    await this.audit.log({
      userId: actor.userId,
      action: 'SKIP_TRACING_UPDATE',
      entity: 'customer',
      entityId: customerId,
      oldValue: {
        phone: existing.phone,
        phoneSecondary: existing.phoneSecondary,
        lineIdFinance: existing.lineIdFinance,
        status: existing.status,
      },
      newValue: {
        phone: updated.phone,
        phoneSecondary: updated.phoneSecondary,
        lineIdFinance: updated.lineIdFinance,
        status: updated.status,
        phoneStoredAs,
        phoneOwnerId: phoneOwner?.id ?? null,
        reason: dto.reason,
      },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });

    return { ...updated, phoneStoredAs, phoneOwner };
  }
}
