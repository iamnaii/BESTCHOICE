import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { calcBcInstallment } from '../../utils/installment-calc.util';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';
import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';
import { commissionPctForCategory, loadGfinSettings } from '../gfin-config/gfin-settings.util';
import { isInstallmentPriceLabel } from '../../utils/product-price-sync.util';
import { loadTemplateTerms } from '../../utils/pricing-template-terms.util';
import { InstallmentPreviewDto } from './dto/installment-preview.dto';
import {
  computeShopGfinQuote,
  resolveShopGfinPlan,
  toGfinFactorRow,
  toGfinMappingRows,
  toGfinRuleRows,
} from './shop-gfin-quote.util';

export interface PreviewResult {
  available: boolean;
  reason?: string;
  errors?: string[];
  provider?: 'BC' | 'GFIN';
  monthlyPayment?: number;
  downAmount?: number;
  totalWithVat?: number;
  financedAmount?: number;
  months?: number;
  /** BC only — the minimum down payment, in percent. */
  minDownPct?: number;
  /**
   * งวดที่เลือกได้ของผู้ให้ผ่อนนั้น (ตัวเลือกจำนวนงวดของเว็บ shop) — BC: งวดที่ตั้งค่าดอกเบี้ยมีอัตรา ·
   * GFIN: งวดที่มีเรท GFIN ของคอมหมวดนี้ ไม่เกินเพดานงวดของกติกา OVER (แค่จำนวนงวด ไม่มีเรท/เพดานราคา)
   */
  allowedMonths?: number[];
  /** GFIN only — งวดตั้งต้นของเครื่อง: งวดเรท 2 ของราคากลาง ไม่มีแล้วเพดานกติกา OVER (ตัวเดียวกับใบเสนอราคาพนักงาน) */
  defaultMonths?: number;
}

/**
 * ผลที่ส่งออก storefront (HTTP) — เรท 2 (GFIN) ไม่ส่งยอดจัด/ยอดรวม: คำตอบเดียวก็ได้
 * financedAmount ÷ (1 − ดาวน์%) = ราคาที่ส่งไฟแนนซ์ · ผลของ service เองไม่ถูกแก้ (ผู้เรียกในระบบได้ครบ) ·
 * BC / ไม่พร้อม คงเดิมทุกฟิลด์
 *
 * ยังไม่ปิดทั้งหมด: ผู้เรียกที่ขอเรท 2 สองครั้งด้วยดาวน์ % ต่างกันยังคำนวณราคานั้นกลับได้จากเงินดาวน์สองค่า —
 * ปิดได้ด้วยการจำกัดดาวน์ % ของเรท 2 ซึ่งเปลี่ยนพฤติกรรมเครื่องคิด (รอเจ้าของตัดสิน)
 */
export function toStorefrontPreview(result: PreviewResult): PreviewResult {
  if (result.provider !== 'GFIN') return result;
  const safe = { ...result };
  delete safe.financedAmount;
  delete safe.totalWithVat;
  return safe;
}

@Injectable()
export class InstallmentPreviewService {
  constructor(private prisma: PrismaService) {}

  async preview(dto: InstallmentPreviewDto): Promise<PreviewResult> {
    // Fix round 1/5 (Important): preview ต้องกัน [DEMO] เหมือน catalog/reserve/bot — เดิม
    // excludeDemo ตายตัว false ทำให้เปิด flag แล้ว catalog ซ่อน + reserve ปฏิเสธ แต่ preview
    // ยัง quote ได้ (รูรั่ว PII surface ที่ brief เตือนไว้ — ลูกค้าขอใบเสนอราคาเครื่อง [DEMO] ได้)
    const excludeDemo = await readBoolFlag(this.prisma, 'shop_hide_demo_products', false);
    const product = await this.prisma.product.findFirst({
      // B0 §2.3: quote ได้เฉพาะเครื่องที่พร้อมขายบนเว็บจริง (เดิมเช็คแค่ deletedAt)
      where: { id: dto.productId, ...productReadinessWhere({ excludeDemo }) },
      include: { prices: { where: { deletedAt: null } } },
    });
    if (!product) {
      return { available: false, reason: 'product_not_found' };
    }

    const installmentPriceRaw =
      product.installmentPrice ??
      product.prices.find((p) => p.label === 'ราคาผ่อน BESTCHOICE')?.amount ??
      product.prices.find((p) => isInstallmentPriceLabel(p.label))?.amount ??
      null;

    if (dto.provider === 'BC') {
      if (!installmentPriceRaw) return { available: false, reason: 'no_installment_price' };
      if (dto.months === undefined) return { available: false, reason: 'months_required' };
      return this.previewBc(product, new Decimal(installmentPriceRaw.toString()), { ...dto, months: dto.months });
    }

    // สเปค 2026-11-19 ข้อ 3.2: เรท 2 คิดจากราคาขาย GFIN ของเครื่อง · ว่าง = ราคาผ่อน BESTCHOICE (พฤติกรรมเดิม)
    // ราคานี้เป็นแค่ input ของการคำนวณฝั่ง server — ไม่ถูกส่งกลับในผลลัพธ์
    const gfinSaleRaw =
      product.financePrice != null && product.financePrice.gt(0)
        ? product.financePrice
        : installmentPriceRaw;
    if (!gfinSaleRaw) return { available: false, reason: 'no_installment_price' };
    return this.previewGfin(product, new Decimal(gfinSaleRaw.toString()), dto);
  }

  private async previewBc(
    product: { category: string },
    installmentPrice: Decimal,
    dto: InstallmentPreviewDto & { months: number },
  ): Promise<PreviewResult> {
    const resolved = await resolveBcConfigForCategory(this.prisma, product.category);
    if (!resolved.found) return { available: false, reason: 'no_interest_config' };

    const result = calcBcInstallment({
      installmentPrice,
      months: dto.months,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
      customDownAmount:
        dto.customDownAmount !== undefined ? new Decimal(dto.customDownAmount) : undefined,
      config: resolved.config!,
    });

    // The floor travels with every BC answer — valid or not — so the UI can
    // enforce it in the input instead of hardcoding a percentage that silently
    // goes stale the day the owner edits the rate table.
    const minDownPct = resolved.config!.minDownPct.mul(100).toNumber();
    const allowedMonths = [...resolved.config!.allowedMonths];

    if (!result.isValid) {
      return { available: false, reason: 'invalid', errors: result.errors, minDownPct, allowedMonths };
    }

    return {
      available: true,
      provider: 'BC',
      minDownPct,
      allowedMonths,
      monthlyPayment: result.monthlyPayment.toNumber(),
      downAmount: result.downAmount.toNumber(),
      totalWithVat: result.totalWithVat.toNumber(),
      financedAmount: result.financedAmount.toNumber(),
      months: dto.months,
    };
  }

  private async previewGfin(
    product: {
      id: string;
      brand: string | null;
      model: string;
      storage: string | null;
      category: ProductCategory;
      deviceOrigin: 'THAI' | 'IMPORTED' | null;
      warrantyExpired: boolean | null;
      warrantyExpireDate: Date | null;
    },
    installmentPrice: Decimal,
    dto: InstallmentPreviewDto,
  ): Promise<PreviewResult> {
    // เรท 2 ขึ้นกับ (จำนวนงวด, %คอมที่ร้านเลือก) — เว็บร้านใช้คอมตั้งต้นตามหมวด (มือถือ 15 · iPad 5)
    const settings = await loadGfinSettings(this.prisma);
    const commissionPct = commissionPctForCategory(settings, product.category);

    const [mappings, rules, factorMonths] = await Promise.all([
      this.prisma.gfinModelMapping.findMany({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.gfinOverpriceRule.findMany({
        where: { deletedAt: null, isActive: true },
      }),
      this.prisma.gfinRateFactor.findMany({
        where: { shopCommissionPct: commissionPct, deletedAt: null, isActive: true },
        select: { months: true },
      }),
    ]);

    // งวดตั้งต้น = งวดเรท 2 ของราคากลาง ไม่มีแล้วเพดานของรุ่น (สูตรเดียวกับหน้า "ราคาและเรทผ่อน" / บอท / สติกเกอร์)
    const terms = (
      await loadTemplateTerms(this.prisma, [{ ...product, brand: product.brand ?? '' }])
    ).get(product.id);
    const templateMonths =
      terms?.rate2TermMonths && terms.rate2TermMonths > 0 ? terms.rate2TermMonths : null;

    const plan = resolveShopGfinPlan({
      product,
      settings,
      mappings: toGfinMappingRows(mappings),
      rules: toGfinRuleRows(rules),
      factorMonths: factorMonths.map((f) => f.months),
      templateMonths,
      requestedMonths: dto.months,
    });
    if (!plan.ok) {
      return plan.allowedMonths
        ? {
            available: false,
            reason: plan.reason,
            allowedMonths: plan.allowedMonths,
            defaultMonths: plan.defaultMonths,
          }
        : { available: false, reason: plan.reason };
    }
    const termInfo = { allowedMonths: plan.allowedMonths, defaultMonths: plan.defaultMonths };

    const factor = await this.prisma.gfinRateFactor.findFirst({
      where: { months: plan.months, shopCommissionPct: commissionPct, deletedAt: null, isActive: true },
    });

    // เว็บ shop ส่ง % เดียวกับเรท 1 มาได้ — เรท 2 ไม่รับดาวน์ต่ำกว่าขั้นต่ำ จึงยกขึ้นเป็นขั้นต่ำ (ใน computeShopGfinQuote)
    const quote = computeShopGfinQuote(plan, {
      product,
      salePrice: installmentPrice,
      settings,
      factor: factor ? toGfinFactorRow(factor) : null,
      downPct: dto.downPct !== undefined ? new Decimal(dto.downPct) : undefined,
    });
    if (!quote.ok) {
      return quote.errors
        ? { available: false, reason: quote.reason, errors: quote.errors, ...termInfo }
        : { available: false, reason: quote.reason, ...termInfo };
    }

    return {
      available: true,
      provider: 'GFIN',
      monthlyPayment: quote.monthlyPayment,
      downAmount: quote.downAmount,
      financedAmount: quote.financedAmount,
      months: quote.months,
      ...termInfo,
      // ราคาส่ง / ส่วนลดดาวน์ไม่ออกเว็บร้าน
    };
  }
}
