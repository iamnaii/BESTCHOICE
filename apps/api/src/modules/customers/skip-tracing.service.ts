import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateCustomerContactDto } from './dto/skip-tracing.dto';
import { CustomerPiiService } from './customer-pii.service';
import { lockCustomerPhone } from './customer-phone-lock';
import { normalizeThaiPhone } from '../../utils/thai-phone.util';

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
 *  - ตรงกับเบอร์หลักเดิม → ไม่เปลี่ยนเบอร์
 *
 * Each call writes a `SKIP_TRACING_UPDATE` audit log entry capturing the old
 * + new contact values + the collector-supplied reason — **หลัง commit**
 * (`AuditService.log` เปิด root-tx ของตัวเอง ห้ามเรียกในทรานแซกชัน).
 */
@Injectable()
export class SkipTracingService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private pii: CustomerPiiService,
  ) {}

  async updateContact(
    customerId: string,
    dto: UpdateCustomerContactDto,
    actor: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    if (
      dto.newPhone === undefined &&
      dto.newLineId === undefined &&
      !dto.markAsLost
    ) {
      throw new BadRequestException(
        'ต้องระบุเบอร์ใหม่ LINE ID ใหม่ หรือทำเครื่องหมาย "สูญหาย" อย่างน้อยหนึ่งอย่าง',
      );
    }

    let newPhone: string | undefined;
    if (dto.newPhone !== undefined) {
      newPhone = normalizeThaiPhone(dto.newPhone) ?? '';
      if (!THAI_MOBILE_RE.test(newPhone)) {
        throw new BadRequestException(INVALID_PHONE_MSG);
      }
    }

    const { existing, updated, phoneStoredAs, phoneOwner } = await this.prisma.$transaction(
      async (tx) => {
        // ล็อกเบอร์ก่อนอ่านอะไรทั้งสิ้น — การตรวจเจ้าของหลังได้ล็อกจะเห็นแถวที่ผู้ถือล็อกก่อนหน้า commit แล้ว
        if (newPhone) await lockCustomerPhone(tx, this.pii, newPhone);

        const current = await tx.customer.findFirst({
          where: { id: customerId, deletedAt: null },
          select: { ...CUSTOMER_CONTACT_SELECT, phoneHash: true },
        });
        if (!current) {
          throw new NotFoundException('ไม่พบลูกค้า');
        }

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

          if (!sameAsPrimary) {
            owner = await this.findOtherOwner(tx, customerId, newPhone, newHash);
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
        if (dto.newLineId !== undefined) data.lineIdFinance = dto.newLineId;
        if (dto.markAsLost) data.status = 'LOST';

        const row = await tx.customer.update({
          where: { id: customerId },
          data,
          select: CUSTOMER_CONTACT_SELECT,
        });

        return { existing: current, updated: row, phoneStoredAs: storedAs, phoneOwner: owner };
      },
    );

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

  /**
   * ลูกค้าคนอื่นที่ยังไม่ถูกลบซึ่งถือเบอร์นี้เป็นเบอร์หลัก (เก่าสุดก่อน) · แถวที่ hash ชี้เบอร์นี้แต่ plaintext
   * เป็นเบอร์อื่น = hash ค้างจากบั๊กเดิม ไม่ใช่เจ้าของจริง ⇒ ข้าม
   */
  private async findOtherOwner(
    tx: Prisma.TransactionClient,
    customerId: string,
    phone: string,
    phoneHash: string | null,
  ): Promise<{ id: string; name: string } | null> {
    const candidates = await tx.customer.findMany({
      where: {
        deletedAt: null,
        id: { not: customerId },
        OR: [{ phone }, ...(phoneHash ? [{ phoneHash }] : [])],
      },
      select: { id: true, name: true, phone: true, phoneHash: true },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    const owner = candidates.find((c) => {
      const plain = normalizeThaiPhone(c.phone);
      return plain ? plain === phone : !!phoneHash && c.phoneHash === phoneHash;
    });
    return owner ? { id: owner.id, name: owner.name } : null;
  }
}
