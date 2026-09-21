import { BadRequestException, ConflictException } from '@nestjs/common';
import { Customer, PaymentMethod, Prisma } from '@prisma/client';
import { isChatPlaceholder, type PlaceholderShape } from '../../chat-prospects/chat-placeholder';
import { firstTransferReference, type NormalizedTender } from '../../shop-tenders/shop-tender.util';

/** Must run after lockCreditCustomer, in the same transaction as the credit claim. */
export async function assertCustomerContractPolicy(tx: Prisma.TransactionClient, customerId: string, role: string, override = false) {
  const activeContracts = await tx.contract.findMany({ where: { customerId, deletedAt: null,
    status: { in: ['ACTIVE', 'OVERDUE', 'DEFAULT'] } }, select: { id: true, contractNumber: true, status: true } });
  const canOverride = ['OWNER', 'BRANCH_MANAGER'].includes(role);
  if (activeContracts.length && !(canOverride && override)) throw new ConflictException({
    message: 'ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่ ไม่สามารถเปิดสัญญาใหม่ได้',
    code: 'CUSTOMER_HAS_ACTIVE_CONTRACT', activeContracts, canOverride,
  });
}

export function customerContractSnapshot(customer: Customer): Prisma.InputJsonValue {
  return {
    name: customer.name, prefix: customer.prefix, nickname: customer.nickname, nationalId: customer.nationalId,
    phone: customer.phone, phoneSecondary: customer.phoneSecondary, email: customer.email,
    lineIdFinance: customer.lineIdFinance, lineIdShop: customer.lineIdShop,
    occupation: customer.occupation, salary: customer.salary?.toString() ?? null, workplace: customer.workplace,
    addressIdCard: customer.addressIdCard, addressCurrent: customer.addressCurrent, addressWork: customer.addressWork,
    references: customer.references, birthDate: customer.birthDate, facebookLink: customer.facebookLink,
    facebookName: customer.facebookName, googleMapLink: customer.googleMapLink,
  };
}

/**
 * คอลัมน์รับเงินดาวน์แบบเดิมของสัญญา — ตั้งจากรายการรับเงินที่ผ่าน `normalizeTenders` แล้ว:
 * วิธี = tender แรก (primary ที่ JE ดาวน์ลงเต็มยอด) · เลขอ้างอิง = บรรทัดแรกที่ไม่ใช่เงินสด.
 * ไม่มีเงินที่ต้องรับ = ทุกช่องเป็น null. Never backfill historical contracts.
 */
export function contractDownTender(tenders: NormalizedTender[]) {
  if (!tenders.length) return { downPaymentMethod: null, downPaymentReference: null, downPaymentReceivedAt: null };
  return { downPaymentMethod: tenders[0].method as PaymentMethod, downPaymentReference: firstTransferReference(tenders),
    downPaymentReceivedAt: new Date() };
}

/**
 * ผู้สนใจอัตโนมัติจากแชท (สเปค 2026-09-13-chat-prospects) มี phone = null —
 * เอกสารที่ต้องติดต่อลูกค้าได้ (สัญญา ใบขาย ใบจอง รับซื้อ) ต้องบังคับให้เติมเบอร์ก่อน
 * `action` = คำที่ต่อท้ายข้อความ เช่น 'ทำสัญญา' 'เปิดใบขาย' 'จองสินค้า' 'รับซื้อเครื่อง'
 *
 * A12 — ข้อความชี้ทางที่ทำได้จริงตามชนิดแถว (caller ต้องโหลด acquisitionSource/nationalId มาด้วย —
 * ใช้ PLACEHOLDER_FIELDS_SELECT; endpoint ที่เจอด่านนี้ทั้งหมดเป็น OWNER/BRANCH_MANAGER/SALES):
 *  - ผู้สนใจอัตโนมัติ → ปุ่ม "เติมเบอร์" หน้าลูกค้า (DetailHeader) / "เพิ่มเบอร์/ข้อมูล" การ์ดผู้สนใจในอินบ็อกซ์
 *    = POST /customers/:id/fill-contact (@Roles OWNER/BM/FM/SALES)
 *    R-0: SALES โดน 403 ที่ทางนี้เมื่อห้องแชทของผู้สนใจมีพนักงานคนอื่นดูแล
 *    (CustomerMergeService.assertActorMayAbsorb) ⇒ ข้อความบอกทางสำรอง: คนดูแลห้อง หรือ
 *    OWNER/BM/FM (ข้ามด่านห้องนั้น) — เข้าหน้าลูกค้า/อินบ็อกซ์และเห็นปุ่มได้ทั้งสาม role
 *  - คนอื่น → fill-contact ปฏิเสธ (ไม่ใช่ผู้สนใจอัตโนมัติ) ⇒ เหลือ "แก้ไขข้อมูล" = PATCH /customers/:id
 *    (@Roles OWNER/BM เท่านั้น — SALES ต้องให้เจ้าของ/ผู้จัดการสาขาทำ)
 */
export function assertCustomerHasPhone(customer: PlaceholderShape, action: string): string {
  if (!customer.phone) {
    throw new BadRequestException(
      isChatPlaceholder(customer)
        ? `ผู้สนใจคนนี้ยังไม่มีเบอร์ — กด "เติมเบอร์" ในหน้าลูกค้า หรือ "เพิ่มเบอร์/ข้อมูล" ในการ์ดผู้สนใจที่อินบ็อกซ์ ก่อน${action}` +
          ' (ถ้าห้องแชทของผู้สนใจคนนี้มีพนักงานคนอื่นดูแลอยู่ ให้คนดูแลห้อง หรือเจ้าของ/ผู้จัดการสาขา/ผู้จัดการการเงิน เติมให้)'
        : `ลูกค้ายังไม่มีเบอร์โทร — ให้เจ้าของหรือผู้จัดการสาขากด "แก้ไขข้อมูล" ในหน้าลูกค้าเพื่อเติมเบอร์ก่อน${action}`,
    );
  }
  return customer.phone;
}
