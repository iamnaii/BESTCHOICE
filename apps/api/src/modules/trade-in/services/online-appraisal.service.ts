import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TradeIn } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBuybackService } from '../../shop-buyback/shop-buyback.service';
import { AppraisalPreviewDto, AppraiseOnlineDto, QuickBuyPreviewDto } from '../dto/appraise-online.dto';
import { QuoteAnswerDto } from '../../shop-buyback/dto/quote.dto';

type AppraisalDevice = Pick<TradeIn, 'deviceBrand' | 'deviceModel'> & { deviceStorage?: string | null };
type QuickBuyAssessment = AppraisalDevice & { answers?: QuoteAnswerDto[]; deviceEligibilityConfirmed?: boolean;
  previewToken?: string; agreedPrice: number; deviceCondition?: string };

/**
 * Handshake ยืนยันราคาหน้าร้านของ record ที่มาจาก instant quote (spec §7.4):
 * ข้าม valuation-band ±15% เดิมทั้งหมด — ราคาตรวจสอบได้จาก engine + snapshot
 *  - AS_ANSWERED: สภาพตรงตามตอบ → ใช้ estimatedValue เป๊ะ
 *  - REVISED:     staff แก้คำตอบ → engine คิดใหม่จาก config ปัจจุบัน
 *  - MANUAL:      OWNER + reason (audited) — free-hand
 * Walk-in / legacy records can start with REVISED after reviewing a server preview.
 */
@Injectable()
export class OnlineAppraisalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopBuyback: ShopBuybackService,
  ) {}

  referenceCatalog() {
    return this.shopBuyback.referenceCatalog();
  }

  quickBuyCatalog() {
    return this.shopBuyback.getCatalog();
  }

  async quickBuyQuestions(model: string, storage: string) {
    const device = this.deviceInput({ deviceBrand: 'Apple', deviceModel: model, deviceStorage: storage });
    const result = await this.shopBuyback.getQuestions(device.model, device.storage);
    if (!result.questions.length) throw new BadRequestException('ยังไม่มีแบบประเมินที่เปิดใช้งาน กรุณาตั้งค่าแบบประเมินก่อน');
    return result;
  }

  async quickBuyPreview(dto: QuickBuyPreviewDto) {
    const quote = await this.quoteDevice(dto, dto.answers, 'BUYBACK', dto.deviceEligibilityConfirmed);
    const previewToken = createHash('sha256').update(JSON.stringify({ version: 1, purpose: 'quick-buy', deviceBrand: 'Apple',
      deviceModel: quote.model, deviceStorage: quote.storage, quote })).digest('hex');
    return { ...quote, previewToken };
  }

  async prepareQuickBuy(dto: QuickBuyAssessment, userId: string) {
    if (!dto.answers?.length || !dto.deviceStorage || !dto.previewToken) {
      throw new BadRequestException('กรุณาประเมินสภาพและดูราคาก่อนยืนยันรับซื้อ');
    }
    const quote = await this.quickBuyPreview({ ...dto, deviceStorage: dto.deviceStorage, answers: dto.answers });
    if (quote.previewToken !== dto.previewToken) throw new ConflictException({ code: 'QUICK_BUY_QUOTE_CHANGED',
      message: 'ราคาหรือเงื่อนไขประเมินเปลี่ยนแล้ว กรุณาดูราคาใหม่ก่อนรับซื้อ' });
    const price = new Prisma.Decimal(quote.cashPrice);
    if (!price.isFinite() || !price.gt(0)) throw new BadRequestException('ผลประเมินนี้ไม่มีมูลค่ารับซื้อ');
    if (!Number.isFinite(dto.agreedPrice) || !price.eq(dto.agreedPrice) || (dto.deviceCondition !== undefined && dto.deviceCondition !== quote.grade)) {
      throw new ConflictException({ code: 'QUICK_BUY_QUOTE_CHANGED',
        message: 'ราคาหรือเกรดเครื่องไม่ตรงกับผลประเมิน กรุณาดูราคาใหม่ก่อนรับซื้อ' });
    }
    return { device: { deviceBrand: 'Apple', deviceModel: quote.model, deviceStorage: quote.storage }, data: {
      offeredPrice: price, estimatedValue: price, deviceCondition: quote.grade, basePriceAtAppraisal: new Prisma.Decimal(quote.maxPrice),
      quoteBreakdown: quote.breakdown as unknown as Prisma.InputJsonValue,
      conditionAnswers: this.confirmEligibility(quote.conditionAnswers, quote.breakdown, userId),
    } };
  }

  async questions(tradeInId?: string, userRole = 'OWNER', userBranchId: string | null = null) {
    const device = tradeInId ? this.deviceInput(await this.loadItem(tradeInId, userRole, userBranchId)) : null;
    const result = await this.shopBuyback.getQuestions(device?.model, device?.storage);
    if (!result.questions.length) throw new BadRequestException('ยังไม่มีแบบประเมินที่เปิดใช้งาน กรุณาตั้งค่าแบบประเมินก่อน');
    return result;
  }

  private async loadItem(id: string, userRole: string, userBranchId: string | null) {
    const tradeIn = await this.prisma.tradeIn.findFirst({ where: { id, deletedAt: null } });
    if (!tradeIn) throw new NotFoundException('ไม่พบรายการเทรดอิน');
    if (!['OWNER', 'BRANCH_MANAGER'].includes(userRole)) throw new ForbiddenException('ไม่มีสิทธิ์ประเมินราคา');
    if (userRole === 'BRANCH_MANAGER' && (!userBranchId || (tradeIn.branchId
      ? tradeIn.branchId !== userBranchId
      : tradeIn.submissionSource !== 'ONLINE'))) {
      throw new ForbiddenException('ไม่สามารถประเมินรายการของสาขาอื่นหรือรายการหน้าร้านที่ยังไม่มีสาขา');
    }
    return tradeIn;
  }

  private deviceInput(tradeIn: AppraisalDevice) {
    if (typeof tradeIn.deviceBrand !== 'string' || typeof tradeIn.deviceModel !== 'string'
      || tradeIn.deviceBrand.trim().toLowerCase() !== 'apple' || !/^iphone\b/i.test(tradeIn.deviceModel.trim())) {
      throw new BadRequestException('แบบประเมินนี้รองรับเฉพาะ Apple iPhone');
    }
    if (typeof tradeIn.deviceStorage !== 'string' || !tradeIn.deviceStorage.trim()) throw new BadRequestException('รายการนี้ยังไม่ระบุความจุเครื่อง กรุณาระบุข้อมูลเครื่องให้ครบก่อน');
    return { model: tradeIn.deviceModel.trim(), storage: tradeIn.deviceStorage.trim() };
  }

  private async quoteItem(tradeIn: TradeIn, answers: QuoteAnswerDto[], deviceEligibilityConfirmed?: boolean) {
    return this.quoteDevice(tradeIn, answers, tradeIn.flow === 'EXCHANGE' ? 'EXCHANGE' : 'BUYBACK', deviceEligibilityConfirmed);
  }

  private async quoteDevice(input: AppraisalDevice, answers: QuoteAnswerDto[], flow: 'BUYBACK' | 'EXCHANGE', deviceEligibilityConfirmed?: boolean) {
    const device = this.deviceInput(input);
    const quote = await this.shopBuyback.quoteForAnswers(device.model, device.storage, answers,
      flow, { requireCompleteQuestionnaire: true,
        ...(deviceEligibilityConfirmed === undefined ? {} : { deviceEligibilityConfirmed }) });
    if (!quote.available) throw new BadRequestException('รุ่นหรือความจุนี้ไม่มีราคาในตาราง — แก้ตารางราคากลางก่อน');
    return quote;
  }

  private confirmEligibility(answers: unknown, quote: { eligibilityRequired?: unknown; eligibilityText?: unknown;
    source?: unknown; capturedAt?: unknown; profileId?: unknown }, userId: string): Prisma.InputJsonValue {
    const existingAnswers = Array.isArray(answers) ? answers : [];
    if (quote.eligibilityRequired !== true) return existingAnswers as Prisma.InputJsonValue;
    return [...existingAnswers.filter((answer) => !answer || typeof answer !== 'object'
      || (answer as Record<string, unknown>).questionKey !== '__device_eligibility'), {
      questionKey: '__device_eligibility', title: quote.eligibilityText,
      selectType: 'SINGLE', choices: [{ choiceId: 'confirmed', label: 'ยืนยันว่าผ่านเงื่อนไขรับซื้อ', deductType: 'FIXED', deductValue: '0' }],
      confirmed: true, source: quote.source, capturedAt: quote.capturedAt, profileId: quote.profileId,
      verifiedById: userId, verifiedAt: new Date().toISOString(),
    }] as Prisma.InputJsonValue;
  }

  private fingerprint(tradeIn: TradeIn, quote: Awaited<ReturnType<OnlineAppraisalService['quoteItem']>>) {
    return createHash('sha256').update(JSON.stringify({ version: 1, id: tradeIn.id, updatedAt: tradeIn.updatedAt,
      brand: tradeIn.deviceBrand, model: tradeIn.deviceModel, storage: tradeIn.deviceStorage, flow: tradeIn.flow,
      branchId: tradeIn.branchId, status: tradeIn.status, appraisalLocked: tradeIn.appraisalLocked, quote })).digest('hex');
  }

  async preview(id: string, dto: AppraisalPreviewDto, userRole: string, userBranchId: string | null) {
    const tradeIn = await this.loadItem(id, userRole, userBranchId);
    if (tradeIn.appraisalLocked || tradeIn.status !== 'PENDING_APPRAISAL') {
      throw new BadRequestException('รายการนี้ไม่อยู่ในสถานะรอประเมิน กรุณาโหลดข้อมูลใหม่');
    }
    const quote = await this.quoteItem(tradeIn, dto.answers, dto.deviceEligibilityConfirmed);
    return { ...quote, previewToken: this.fingerprint(tradeIn, quote) };
  }

  async appraiseOnline(id: string, dto: AppraiseOnlineDto, userId: string, userRole: string, userBranchId: string | null = null) {
    const tradeIn = await this.loadItem(id, userRole, userBranchId);
    const eligibility = tradeIn.quoteBreakdown as Record<string, unknown> | null;
    if (eligibility?.eligibilityRequired === true && dto.deviceEligibilityConfirmed !== true) {
      throw new BadRequestException('กรุณายืนยันว่าเครื่องผ่านเงื่อนไขรับซื้อก่อนยืนยันราคา');
    }
    if (dto.mode !== 'MANUAL' && dto.offeredPrice !== undefined) {
      throw new BadRequestException('ราคาประเมินต้องคำนวณจากแบบประเมิน ไม่สามารถส่งราคามาเองได้');
    }
    if (!tradeIn.quoteBreakdown && dto.mode === 'AS_ANSWERED') {
      throw new BadRequestException(
        'รายการนี้ไม่ได้มาจากใบเสนอราคาออนไลน์ — ใช้การประเมินราคาแบบปกติ',
      );
    }
    if (tradeIn.appraisalLocked && dto.mode !== 'MANUAL') {
      throw new ForbiddenException(
        'รายการนี้ถูกตีราคาไปแล้ว — แก้ราคาได้เฉพาะเจ้าของร้านแบบระบุเหตุผล (MANUAL)',
      );
    }
    if (!tradeIn.appraisalLocked && tradeIn.status !== 'PENDING_APPRAISAL') {
      throw new BadRequestException('รายการนี้ไม่อยู่ในสถานะรอประเมิน');
    }
    // MANUAL ข้าม lock-check ข้างบน (OWNER แก้ record ที่ล็อคแล้วได้) แต่ต้องไม่ให้ย้อน
    // record ที่จบ lifecycle ไปแล้ว (ACCEPTED/COMPLETED/REJECTED ฯลฯ) กลับมาเป็น APPRAISED —
    // ไม่งั้น accept() ครั้งที่ 2 จะสร้าง Product ซ้อนได้
    if (
      dto.mode === 'MANUAL' &&
      tradeIn.status !== 'PENDING_APPRAISAL' &&
      tradeIn.status !== 'APPRAISED'
    ) {
      throw new BadRequestException(
        `รายการนี้จบขั้นตอนไปแล้ว (สถานะ ${tradeIn.status}) — ไม่สามารถแก้ราคาได้`,
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const breakdown = tradeIn.quoteBreakdown as any;
    const maxPrice = breakdown ? new Prisma.Decimal(breakdown.maxPrice ?? 0) : new Prisma.Decimal(0);

    let offeredPrice: Prisma.Decimal;
    // AS_ANSWERED/MANUAL เทียบกับ breakdown เดิมของ record; REVISED เขียนทับด้านล่าง
    // ด้วย breakdown "ใหม่" ที่เพิ่งคิดจาก engine (แก้บั๊ก desync — เดิม snapshot ราคาฐาน
    // เก่าคู่กับ quoteBreakdown ใหม่ ทำให้เทียบ deviation ผิด)
    let basePriceAtAppraisal = maxPrice;
    let extraData: Record<string, unknown> = {};

    if (dto.mode === 'AS_ANSWERED') {
      if (tradeIn.estimatedValue === null) {
        throw new BadRequestException('รายการนี้ไม่มีราคาที่เสนอออนไลน์');
      }
      if (dto.useCashPrice) {
        // ลูกค้าเทิร์นแต่ไม่ซื้อเครื่อง → ถอยเป็นราคาเงินสด + flip flow (spec /sell §7.2)
        if (tradeIn.flow !== 'EXCHANGE') {
          throw new BadRequestException('ใช้ราคาเงินสดได้เฉพาะรายการเทิร์น');
        }
        const cash = breakdown.cashPrice;
        if (!cash) {
          throw new BadRequestException('รายการนี้ไม่มีราคาเงินสดในใบเสนอ');
        }
        offeredPrice = new Prisma.Decimal(cash);
        extraData = {
          flow: 'BUYBACK',
          estimatedValue: new Prisma.Decimal(cash),
          quoteBreakdown: {
            ...breakdown,
            price: cash,
            chosenFlow: 'BUYBACK',
          } as Prisma.InputJsonValue,
        };
      } else {
        offeredPrice = new Prisma.Decimal(tradeIn.estimatedValue);
      }
    } else if (dto.mode === 'REVISED') {
      if (!dto.answers || dto.answers.length === 0) {
        throw new BadRequestException('กรุณาส่งคำตอบแบบประเมินชุดใหม่');
      }
      const quote = await this.quoteItem(tradeIn, dto.answers, dto.deviceEligibilityConfirmed);
      if ((!tradeIn.quoteBreakdown || dto.previewToken) && dto.previewToken !== this.fingerprint(tradeIn, quote)) {
        throw new ConflictException('ข้อมูลเครื่องหรือราคาประเมินเปลี่ยนแล้ว กรุณาดูราคาใหม่ก่อนยืนยัน');
      }
      offeredPrice = new Prisma.Decimal(quote.price!);
      if (!offeredPrice.isFinite() || !offeredPrice.gt(0)) {
        throw new BadRequestException('ผลประเมินนี้ไม่มีมูลค่ารับซื้อ กรุณาตรวจสภาพและคำตอบอีกครั้ง');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newBreakdown = quote.breakdown as any;
      basePriceAtAppraisal = new Prisma.Decimal(newBreakdown?.maxPrice ?? quote.maxPrice ?? 0);
      extraData = {
        deviceCondition: quote.grade,
        estimatedValue: new Prisma.Decimal(quote.price!),
        conditionAnswers: quote.conditionAnswers as Prisma.InputJsonValue,
        quoteBreakdown: quote.breakdown as unknown as Prisma.InputJsonValue,
      };
    } else {
      // MANUAL
      if (userRole !== 'OWNER') {
        throw new ForbiddenException('ราคานอกระบบประเมิน — เฉพาะเจ้าของร้าน (OWNER) เท่านั้น');
      }
      if (dto.offeredPrice === undefined || dto.offeredPrice <= 0) {
        throw new BadRequestException('กรุณาระบุราคาที่เสนอ');
      }
      if (!dto.reason || dto.reason.trim().length < 3) {
        throw new BadRequestException('ต้องระบุเหตุผล (อย่างน้อย 3 ตัวอักษร)');
      }
      offeredPrice = new Prisma.Decimal(dto.offeredPrice);

      // Re-stamp ราคาลง estimatedValue + breakdown ให้ invariant
      // price == estimatedValue == offeredPrice กลับมาถูกทุกหน้าจอ (รวมหน้า status
      // ลูกค้า) หลัง OWNER แก้ราคามือ — ก่อนหน้านี้ MANUAL ไม่แตะ breakdown เลย
      // ทำให้ลูกค้าเห็นราคาเก่าค้าง
      const oldBreakdown = tradeIn.quoteBreakdown as Record<string, unknown> | null;
      if (oldBreakdown) {
        const newBreakdown: Record<string, unknown> = {
          ...oldBreakdown,
          price: offeredPrice.toFixed(2),
        };
        if (tradeIn.flow === 'EXCHANGE') {
          // ราคาเครดิตที่ตกลงกับลูกค้าคือตัวจริง — inverse หา cashPrice จาก snapshot
          // bonusPct (ไม่ใช่ config ปัจจุบัน); floor to tens เหมือน pricing เดิม
          // label "+X%" จึงคลาดได้ ~1% บน record ที่แก้มือ (ยอมรับตาม spec launch-wave §4)
          newBreakdown.exchangePrice = offeredPrice.toFixed(2);
          const pctRaw = oldBreakdown.bonusPct;
          const bonusPct =
            typeof pctRaw === 'string' || typeof pctRaw === 'number'
              ? new Prisma.Decimal(pctRaw)
              : null;
          if (bonusPct && bonusPct.gt(0)) {
            const HUNDRED = new Prisma.Decimal(100);
            const rawCash = offeredPrice.mul(HUNDRED).div(HUNDRED.plus(bonusPct));
            newBreakdown.cashPrice = rawCash.div(10).floor().mul(10).toFixed(2);
          } else {
            // record เก่าก่อน dual-price ไม่มีโบนัส
            newBreakdown.cashPrice = offeredPrice.toFixed(2);
          }
        } else {
          newBreakdown.cashPrice = offeredPrice.toFixed(2);
        }
        extraData = {
          estimatedValue: offeredPrice,
          quoteBreakdown: newBreakdown as Prisma.InputJsonValue,
        };
      } else {
        extraData = { estimatedValue: offeredPrice };
      }
    }

    const savedQuote = (extraData.quoteBreakdown ?? tradeIn.quoteBreakdown) as Record<string, unknown> | null;
    if (savedQuote?.eligibilityRequired === true) {
      const answers = extraData.conditionAnswers ?? tradeIn.conditionAnswers;
      extraData.conditionAnswers = this.confirmEligibility(answers, savedQuote, userId);
    }

    // Compare-and-set: findFirst ข้างบนอ่านแบบ dirty read — ระหว่างนี้ staff คนอื่นอาจ
    // appraise record เดียวกันไปแล้ว ใช้ updateMany + WHERE conditional (เห็น state ที่อ่านมา)
    // กัน race แทน update({where:{id}}) ธรรมดาที่ตัวชนะ/แพ้ overwrite กันเงียบๆ ได้เสมอ
    // (ตาม pattern paysolutions-webhook.service.ts / contract-lifecycle.service.ts)
    // MANUAL ไม่มี appraisalLocked/status เพียงพอจะกัน race กันเอง — สอง OWNER เรียก MANUAL
    // พร้อมกันบน record เดิม (ทั้งคู่ status ใน [PENDING_APPRAISAL, APPRAISED]) ก็จะยังผ่าน WHERE
    // เดิมทั้งคู่ (last write wins เงียบๆ) จึง CAS เพิ่มบน offeredPrice ที่อ่านมา ณ ตอน fetch —
    // ใครก็ตามที่ record เปลี่ยน offeredPrice ไปแล้ว (ไม่ว่าจาก MANUAL หรือโหมดอื่น) จะ match ไม่ได้
    // (รองรับ null ด้วย — Prisma แปลง `offeredPrice: null` เป็น IS NULL)
    const whereGuard: Prisma.TradeInWhereInput =
      dto.mode === 'MANUAL'
        ? {
            id,
            deletedAt: null,
            status: { in: ['PENDING_APPRAISAL', 'APPRAISED'] },
            offeredPrice: tradeIn.offeredPrice,
          }
        : { id, deletedAt: null, appraisalLocked: false, status: 'PENDING_APPRAISAL', updatedAt: tradeIn.updatedAt };

    const result = await this.prisma.tradeIn.updateMany({
      where: whereGuard,
      data: {
        offeredPrice,
        notes: dto.notes ?? tradeIn.notes,
        appraisedById: userId,
        status: 'APPRAISED',
        basePriceAtAppraisal, // deviation analytics เทียบกับ "ราคาสูงสุด" ของใบเสนอ
        appraisalLocked: true,
        firstAppraisedAt: tradeIn.firstAppraisedAt ?? new Date(),
        ...extraData,
      },
    });

    if (result.count === 0) {
      throw new BadRequestException('รายการนี้เพิ่งถูกประเมินโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ');
    }

    // MANUAL: เขียน audit หลัง CAS สำเร็จเท่านั้น — race-loser ต้องไม่ทิ้ง audit
    // ของราคาที่ไม่เคยเกิดจริง (hardening ตาม spec launch-wave §4)
    if (dto.mode === 'MANUAL') {
      await this.prisma.auditLog.create({
        data: {
          userId,
          action: 'TRADE_IN_ONLINE_MANUAL_PRICE',
          entity: 'trade_in',
          entityId: id,
          oldValue: {
            estimatedValue: tradeIn.estimatedValue?.toString() ?? null,
            offeredPrice: tradeIn.offeredPrice?.toString() ?? null,
          },
          newValue: { offeredPrice: dto.offeredPrice, reason: dto.reason },
        },
      });
    }

    return this.prisma.tradeIn.findUnique({ where: { id } });
  }
}
