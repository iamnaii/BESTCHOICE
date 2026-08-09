import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../prisma/prisma.service';
import { calcBcInstallment } from '../../../utils/installment-calc.util';
import { resolveBcConfigForCategory } from '../../../utils/bc-installment-config.util';
import { shopBaseUrl } from '../../../utils/shop-base-url.util';
import { DEMO_NAME_PREFIX } from '../../../utils/product-readiness.util';

export const CALCULATE_INSTALLMENT_TOOL = {
  name: 'calculate_installment',
  description:
    'คำนวณค่างวดจริงของเครื่องที่ระบุ ด้วยเครื่องคิดตัวเดียวกับที่ใช้ทำสัญญา (รวมค่าคอม/VAT ตาม InterestConfig). ' +
    'ต้องมี productId จากผลลัพธ์ search_products ก่อนเสมอ — ห้ามเดา id. ' +
    'downPct เป็นเปอร์เซ็นต์ 0-100 ถ้าไม่ส่งจะใช้ดาวน์ขั้นต่ำตามที่ตั้งค่าไว้. ' +
    'error=rate_not_configured แปลว่าจำนวนงวดนี้ไม่มีในตาราง ให้เสนอจำนวนงวดอื่นหรือส่งต่อพนักงาน. ' +
    'ห้าม quote ตัวเลขใด ๆ ที่ไม่ได้มาจากผลลัพธ์นี้.',
  input_schema: {
    type: 'object',
    properties: {
      productId: { type: 'string', description: 'id ของเครื่องจาก search_products' },
      downPct: { type: 'number', description: 'เปอร์เซ็นต์เงินดาวน์ 0-100' },
      tenureMonths: { type: 'integer', description: 'จำนวนงวด เช่น 6, 10, 12' },
    },
    required: ['productId', 'tenureMonths'],
  },
};

@Injectable()
export class CalculateInstallmentTool {
  constructor(private readonly prisma: PrismaService) {}

  async run(input: { productId: string; downPct?: number; tenureMonths: number }) {
    const product = await this.prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: {
        id: true,
        name: true,
        category: true,
        cashPrice: true,
        installmentPrice: true,
        gallery: true,
        prices: { where: { deletedAt: null }, select: { label: true, amount: true } },
      },
    });
    if (!product) return { error: 'product_not_found' };

    // ลำดับเดียวกับ installment-preview.service.ts:39-43 เป๊ะ — คอลัมน์ก่อน
    // แล้วค่อย fallback label (ระหว่างที่ B0 ยังไล่ backfill ราคาไม่ครบ)
    const baseRaw =
      product.installmentPrice ??
      product.prices.find((p) => p.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      product.prices.find((p) => p.label.startsWith('ราคาผ่อน'))?.amount ??
      null;
    if (baseRaw == null) return { error: 'price_not_configured' };
    const installmentPrice = new Decimal(baseRaw.toString());

    const resolved = await resolveBcConfigForCategory(this.prisma, product.category);
    if (!resolved.found || !resolved.config) return { error: 'rate_not_configured' };
    const config = resolved.config;

    // schema ของ tool รับเป็นเปอร์เซ็นต์ (0-100) แต่ calcBcInstallment กินเศษส่วน
    const downPctFraction =
      input.downPct !== undefined && Number.isFinite(input.downPct)
        ? new Decimal(input.downPct).div(100)
        : config.minDownPct;

    // งวดที่ไม่มีในตาราง = ตอบ rate_not_configured เหมือนพฤติกรรมเดิม (#1335)
    // ไม่ปล่อยเป็น invalid_installment เพราะ persona มี flow แยกไว้แล้ว
    if (!config.allowedMonths.includes(input.tenureMonths)) {
      return { error: 'rate_not_configured' };
    }

    const result = calcBcInstallment({
      installmentPrice,
      months: input.tenureMonths,
      downPct: downPctFraction,
      config,
    });
    if (!result.isValid) {
      return { error: 'invalid_installment', reasons: result.errors };
    }

    const base = shopBaseUrl();
    return {
      productId: product.id,
      // final-review D1: ห้ามให้ prefix [DEMO] หลุดถึงลูกค้า — เว็บไม่เคยโชว์ Product.name
      // ดิบ และ search_products ก็ไม่ emit name; tool นี้เป็นจุดเดียวที่ปล่อยชื่อออก
      productName: product.name.startsWith(DEMO_NAME_PREFIX)
        ? product.name.slice(DEMO_NAME_PREFIX.length).trimStart()
        : product.name,
      cashPriceThb: product.cashPrice != null ? Number(product.cashPrice) : null,
      priceThb: installmentPrice.toNumber(),
      downPct: result.downPct.mul(100).toNumber(),
      downAmountThb: result.downAmount.toNumber(),
      financedThb: result.financedAmount.toNumber(),
      tenureMonths: input.tenureMonths,
      ratePct: result.interestPct.mul(100).toNumber(),
      monthlyThb: result.monthlyPayment.toNumber(),
      totalPaidThb: result.downAmount.add(result.totalWithVat).toNumber(),
      photoUrl: product.gallery[0] ?? null,
      webUrl: base ? `${base}/api/shop/share/${product.id}` : null,
    };
  }
}
