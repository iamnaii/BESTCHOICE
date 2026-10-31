import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { findShopLiffCustomerId } from './services/otp-verified-customer';
import { detectWarrantyStatus } from '../repair-tickets/utils/detect-warranty-status';

export interface LiffWarrantyDevice {
  /** ชื่อรุ่นที่ลูกค้าอ่านรู้เรื่อง เช่น "Samsung A16 128GB" */
  title: string;
  imeiSerial: string | null;
  purchasedAt: string | null;
  /** ประกันร้าน — null = ไม่มี (เช่น เครื่องใหม่ที่ใช้ประกันศูนย์อย่างเดียว) */
  shopWarrantyEndDate: string | null;
  shopWarrantyDaysLeft: number | null;
  /** ประกันศูนย์จากผู้ผลิต */
  manufacturerWarrantyEndDate: string | null;
  manufacturerWarrantyDaysLeft: number | null;
  /** สรุปให้ลูกค้าอ่าน — มาจาก detectWarrantyStatus ตัวเดียวกับที่หน้าร้านใช้ */
  status: 'IN_SHOP_WARRANTY' | 'IN_MANUFACTURER' | 'EXPIRED';
}

export interface LiffWarrantyResponse {
  linked: boolean;
  customerName: string | null;
  devices: LiffWarrantyDevice[];
}

/** วันที่เหลือแบบปัดขึ้นเป็นวันปฏิทิน — ติดลบให้เป็น null (หมดแล้ว) */
function daysLeft(end: Date | null | undefined): number | null {
  if (!end) return null;
  const diff = Math.ceil((end.getTime() - Date.now()) / 86_400_000);
  return diff > 0 ? diff : null;
}

/**
 * "ประกันของฉัน" สำหรับลูกค้าที่เปิดจาก LINE OA ร้าน (ช่อง SHOP)
 *
 * รวมเครื่องจาก **ทั้งสองเส้นทาง** ที่ลูกค้าอาจได้เครื่องไป:
 *   - ใบขาย (`Sale`) — ขายสด / ไฟแนนซ์นอก ประกันร้านอยู่บนใบขายเอง
 *   - สัญญาผ่อน (`Contract`) — ประกันร้านอยู่บนสัญญา (ของเดิม)
 * ใบขายของสัญญาผ่อนจะถูกกรองออก (`contractId: null`) ไม่งั้นเครื่องเดียวโผล่สองแถว
 *
 * ตัวตนลูกค้า (Task 22 — ทางเลือก ก): แถว OTP ช่อง FINANCE ของ LINE เดียวกัน (`findShopLiffCustomerId`) ·
 * `customer.lineIdShop` เป็นทางสำรองเฉพาะค่าที่เขียนก่อน Task 20 — คอลัมน์นี้ยังมีผู้เขียนที่ไม่ผ่าน OTP (พนักงาน, บอทขาย)
 * ⇒ ไม่ใช่หลักฐานตัวตน · ดู `.claude/rules/security.md` หัวข้อ "LINE — ตัวตนลูกค้า · OTP · redirect"
 */
@Injectable()
export class LiffWarrantyService {
  private readonly logger = new Logger(LiffWarrantyService.name);

  constructor(private prisma: PrismaService) {}

  async getMyWarranties(lineUserId: string): Promise<LiffWarrantyResponse> {
    const customerId = await findShopLiffCustomerId(this.prisma, lineUserId);
    const customer = customerId
      ? await this.prisma.customer.findFirst({
          where: { id: customerId, deletedAt: null },
          select: { id: true, name: true },
        })
      : null;

    // ยังไม่ยืนยันตัวตน — หน้าจอบอกวิธี (พิมพ์ "ลงทะเบียน" ในแชท → ลิงก์ยืนยันด้วย OTP) ไม่ใช่ error
    if (!customer) return { linked: false, customerName: null, devices: [] };

    const [sales, contracts] = await Promise.all([
      this.prisma.sale.findMany({
        where: { customerId: customer.id, contractId: null, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          shopWarrantyEndDate: true,
          product: {
            select: { brand: true, model: true, storage: true, imeiSerial: true, warrantyExpireDate: true },
          },
        },
      }),
      this.prisma.contract.findMany({
        where: { customerId: customer.id, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          deviceReceivedAt: true,
          shopWarrantyEndDate: true,
          product: {
            select: { brand: true, model: true, storage: true, imeiSerial: true, warrantyExpireDate: true },
          },
        },
      }),
    ]);

    const devices: LiffWarrantyDevice[] = [
      ...sales.map((s) =>
        this.toDevice(s.product, s.createdAt, { sale: { shopWarrantyEndDate: s.shopWarrantyEndDate } }),
      ),
      ...contracts.map((c) =>
        this.toDevice(c.product, c.deviceReceivedAt ?? c.createdAt, {
          contract: { deviceReceivedAt: c.deviceReceivedAt, shopWarrantyEndDate: c.shopWarrantyEndDate },
        }),
      ),
    ].filter((d): d is LiffWarrantyDevice => d !== null);

    return { linked: true, customerName: customer.name, devices };
  }

  private toDevice(
    product: {
      brand: string;
      model: string;
      storage: string | null;
      imeiSerial: string | null;
      warrantyExpireDate: Date | null;
    } | null,
    purchasedAt: Date | null,
    source:
      | { sale: { shopWarrantyEndDate: Date | null } }
      | { contract: { deviceReceivedAt: Date | null; shopWarrantyEndDate: Date | null } },
  ): LiffWarrantyDevice | null {
    if (!product) return null;

    const shopEnd =
      'sale' in source ? source.sale.shopWarrantyEndDate : source.contract.shopWarrantyEndDate;

    // ใช้ตัวตัดสินเดียวกับหน้าร้าน/ใบซ่อม — ห้ามเขียนสูตรที่สองที่นี่ ไม่งั้นลูกค้าเห็น
    // "ยังอยู่ในประกัน" ในไลน์ แต่หน้าร้านบอกว่าหมดแล้ว
    const raw = detectWarrantyStatus({ ...source, product });
    const status: LiffWarrantyDevice['status'] =
      raw === 'IN_SHOP_WARRANTY' || raw === 'IN_7DAY_DEFECT'
        ? 'IN_SHOP_WARRANTY'
        : raw === 'IN_MANUFACTURER'
          ? 'IN_MANUFACTURER'
          : 'EXPIRED';

    return {
      title: [product.brand, product.model, product.storage].filter(Boolean).join(' '),
      imeiSerial: product.imeiSerial,
      purchasedAt: purchasedAt?.toISOString() ?? null,
      shopWarrantyEndDate: shopEnd?.toISOString() ?? null,
      shopWarrantyDaysLeft: daysLeft(shopEnd),
      manufacturerWarrantyEndDate: product.warrantyExpireDate?.toISOString() ?? null,
      manufacturerWarrantyDaysLeft: daysLeft(product.warrantyExpireDate),
      status,
    };
  }
}
