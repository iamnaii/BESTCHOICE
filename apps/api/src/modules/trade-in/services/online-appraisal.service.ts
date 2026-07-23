import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShopBuybackService } from '../../shop-buyback/shop-buyback.service';
import { AppraiseOnlineDto } from '../dto/appraise-online.dto';

/**
 * Handshake ยืนยันราคาหน้าร้านของ record ที่มาจาก instant quote (spec §7.4):
 * ข้าม valuation-band ±15% เดิมทั้งหมด — ราคาตรวจสอบได้จาก engine + snapshot
 *  - AS_ANSWERED: สภาพตรงตามตอบ → ใช้ estimatedValue เป๊ะ
 *  - REVISED:     staff แก้คำตอบ → engine คิดใหม่จาก config ปัจจุบัน
 *  - MANUAL:      OWNER + reason (audited) — free-hand
 * Record walk-in / online แบบเก่า (ไม่มี quoteBreakdown) → ใช้ appraise() เดิม
 */
@Injectable()
export class OnlineAppraisalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shopBuyback: ShopBuybackService,
  ) {}

  async appraiseOnline(id: string, dto: AppraiseOnlineDto, userId: string, userRole: string) {
    const tradeIn = await this.prisma.tradeIn.findFirst({ where: { id, deletedAt: null } });
    if (!tradeIn) throw new NotFoundException('ไม่พบรายการเทรดอิน');
    if (!tradeIn.quoteBreakdown && dto.mode !== 'MANUAL') {
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
      const recordFlow = tradeIn.flow === 'EXCHANGE' ? ('EXCHANGE' as const) : ('BUYBACK' as const);
      const quote = await this.shopBuyback.quoteForAnswers(
        tradeIn.deviceModel,
        tradeIn.deviceStorage ?? '',
        dto.answers,
        recordFlow,
      );
      if (!quote.available) {
        throw new BadRequestException('รุ่นนี้ไม่มีราคาในตารางแล้ว — แก้ตารางราคากลางก่อน');
      }
      offeredPrice = new Prisma.Decimal(quote.price!);
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
        : { id, deletedAt: null, appraisalLocked: false, status: 'PENDING_APPRAISAL' };

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
