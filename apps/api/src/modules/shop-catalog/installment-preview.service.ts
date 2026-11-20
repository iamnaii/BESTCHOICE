import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { ProductCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  calcBcInstallment,
  calcGfinInstallment,
  findGfinMapping,
  findGfinOverpriceRule,
  resolveGfinDownPct,
} from '../../utils/installment-calc.util';
import { productReadinessWhere } from '../../utils/product-readiness.util';
import { readBoolFlag } from '../../utils/config.util';
import { resolveBcConfigForCategory } from '../../utils/bc-installment-config.util';
import { commissionPctForCategory, loadGfinSettings } from '../gfin-config/gfin-settings.util';
import { isInstallmentPriceLabel } from '../../utils/product-price-sync.util';
import { loadTemplateTerms } from '../../utils/pricing-template-terms.util';
import { InstallmentPreviewDto } from './dto/installment-preview.dto';

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

/** งวดตั้งต้นที่ใช้ได้จริง: ตรงในรายการ → ใช้เลย · ไม่ตรง → งวดมากสุดที่ไม่เกิน · ไม่มีเลย → งวดแรก */
function pickDefaultMonths(wanted: number, allowed: number[]): number {
  if (allowed.length === 0 || allowed.includes(wanted)) return wanted;
  const below = allowed.filter((m) => m <= wanted);
  return below.length > 0 ? below[below.length - 1] : allowed[0];
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
    // เรทของ GFIN ขึ้นกับ (จำนวนงวด, %คอมที่ร้านเลือก) — เว็บร้านใช้คอมตั้งต้นตามหมวด (มือถือ 15 · iPad 5)
    const settings = await loadGfinSettings(this.prisma);
    const commissionPct = commissionPctForCategory(settings, product.category);
    const gfinCategory =
      product.category === 'TABLET'
        ? 'TABLET'
        : product.category === 'PHONE_NEW'
          ? 'PHONE_NEW'
          : 'PHONE_USED';

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

    const mappingObjects = mappings.map((m) => ({
      id: m.id,
      gfinSeries: m.gfinSeries,
      gfinVariant: m.gfinVariant,
      storage: m.storage,
      condition: m.condition as 'HAND_1' | 'HAND_2',
      maxPrice: new Decimal(m.maxPrice.toString()),
      modelMatchPattern: m.modelMatchPattern,
      isActive: m.isActive,
    }));

    const mapping = findGfinMapping(
      {
        brand: product.brand ?? '',
        model: product.model,
        storage: product.storage ?? '',
        category: gfinCategory,
      },
      mappingObjects,
    );
    if (!mapping) return { available: false, reason: 'no_gfin_mapping' };

    const ruleObjects = rules.map((r) => ({
      id: r.id,
      label: r.label,
      seriesPattern: r.seriesPattern,
      condition: r.condition as 'HAND_1' | 'HAND_2',
      allowance: new Decimal(r.allowance.toString()),
      maxMonths: r.maxMonths ?? null,
      minDownPct: r.minDownPct ?? null,
      isActive: r.isActive,
    }));

    const rule = findGfinOverpriceRule(mapping, ruleObjects);
    // สเปก 2026-11-20 §4: มีราคาแต่ไม่มีเงื่อนไขของรุ่น = ยังคิดไม่ได้ (เว็บ shop ไม่โชว์ GFIN)
    if (!rule) return { available: false, reason: 'no_gfin_rule' };

    // งวดของ GFIN มาจากฝั่ง GFIN (ไม่ใช่งวดของตั้งค่าดอกเบี้ย BC): งวดที่มีเรทของคอมหมวดนี้ ไม่เกินเพดานกติกา OVER
    // งวดตั้งต้น = งวดเรท 2 ของราคากลาง ไม่มีแล้วเพดานกติกา OVER (สูตรเดียวกับ buildModelQuote — หน้า "ราคาและเรทผ่อน" / บอท / สติกเกอร์)
    const allowedMonths = [...new Set(factorMonths.map((f) => f.months))]
      .filter((m) => rule.maxMonths == null || m <= rule.maxMonths)
      .sort((a, b) => a - b);
    const terms = (
      await loadTemplateTerms(this.prisma, [{ ...product, brand: product.brand ?? '' }])
    ).get(product.id);
    const templateMonths = terms?.rate2TermMonths && terms.rate2TermMonths > 0 ? terms.rate2TermMonths : null;
    const defaultMonths = pickDefaultMonths(templateMonths ?? rule.maxMonths ?? 12, allowedMonths);
    const months = dto.months ?? defaultMonths;
    const termInfo = { allowedMonths, defaultMonths };

    // ผ่อนได้สูงสุดต่อซีรีส์/สภาพตามตารางราคา GFIN (12 series = 10 · 13-15 = 12 · 16-17 = 15)
    if (rule.maxMonths != null && months > rule.maxMonths) {
      return { available: false, reason: 'months_over_max', ...termInfo };
    }

    const factor = await this.prisma.gfinRateFactor.findFirst({
      where: { months, shopCommissionPct: commissionPct, deletedAt: null, isActive: true },
    });
    if (!factor) return { available: false, reason: 'no_rate_factor', ...termInfo };

    // ดาวน์ขั้นต่ำ: กติกา OVER ของรุ่นก่อน ไม่มีแล้วใช้ค่าตั้ง gfin.minDownPct (สเปค price-master-retire 3.3)
    // เว็บ shop ส่ง % เดียวกับเรท 1 มาด้วย (ค่าเริ่ม 15%) — GFIN ไม่รับดาวน์ต่ำกว่าขั้นต่ำ จึงยกขึ้นเป็นขั้นต่ำ
    const minDownPct = resolveGfinDownPct(rule, new Decimal(settings.minDownPct).div(100));
    const downPct =
      dto.downPct !== undefined ? Decimal.max(new Decimal(dto.downPct), minDownPct) : minDownPct;

    const result = calcGfinInstallment({
      installmentPrice,
      product: {
        brand: product.brand ?? '',
        model: product.model,
        storage: product.storage ?? '',
        category: gfinCategory,
      },
      months,
      downPct,
      shopCommissionPct: new Decimal(commissionPct),
      contractFee: new Decimal(settings.contractFee),
      mapping,
      overpriceRule: rule,
      // GFIN ให้ OVER เต็มเฉพาะเครื่องไทย — เครื่องนอก/ยังไม่ระบุได้ครึ่งเดียว
      deviceOrigin: product.deviceOrigin,
      rateFactor: {
        months: factor.months,
        shopCommissionPct: factor.shopCommissionPct,
        factor: new Decimal(factor.factor.toString()),
        feePerInstallment: new Decimal(factor.feePerInstallment.toString()),
        isActive: factor.isActive,
      },
    });

    if (!result.isValid) {
      return { available: false, reason: 'invalid', errors: result.errors, ...termInfo };
    }

    return {
      available: true,
      provider: 'GFIN',
      monthlyPayment: result.monthlyPayment.toNumber(),
      downAmount: result.downAmountActual.toNumber(),
      financedAmount: result.financedAmount.toNumber(),
      months,
      ...termInfo,
      // ราคาส่ง GFIN / ส่วนลดดาวน์ไม่ออกเว็บร้าน (กติการวม — ราคาส่ง − ส่วนลด = ราคาขาย GFIN ของเครื่อง)
    };
  }
}
