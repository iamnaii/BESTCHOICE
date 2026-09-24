import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { VisionService } from '../../chatbot-finance/services/vision.service';
import { FinanceConfigService } from '../../chatbot-finance/services/finance-config.service';
import {
  EVIDENCE_IMAGE_MAX_BYTES,
  evidenceImageExtension,
  isEvidenceImage,
} from '../../../utils/upload-image.util';
import { bangkokDateString } from '../../../utils/date.util';
import { ContractPaymentService, type SlipMatchAuthorization } from '../contract-payment.service';
import { EarlyPayoffSlipConfirmDto } from '../dto/early-payoff-slip.dto';
import {
  evaluateSlipChecks,
  slipFingerprint,
  slipPaymentDate,
  type SlipCheck,
  type SlipReading,
} from './slip-checks';

/** อายุตั๋ว — พอให้พนักงานอ่านผลแล้วกดยืนยัน ไม่พอให้ยอดปิดขยับข้ามวัน */
const TICKET_TTL_MS = 15 * 60 * 1000;
const TICKET_VERSION = 1;
/** ธนาคารรับปิดยอดตรงเข้า FINANCE = กสิกรเท่านั้น (กติกาเจ้าของ 2026-07-08) */
const PAYOFF_DEPOSIT_ACCOUNT = '11-1201';

export interface EarlyPayoffSlipVerifyResult {
  /** เครื่องยนต์ที่อ่านสลิป — วันนี้ OCR (Claude) · สลับเป็น SCB/บริการกลางได้โดยหน้าจอไม่เปลี่ยน */
  engine: 'OCR';
  /** false = อ่านไม่ได้/ไม่พร้อม (ไม่มี key, เครดิตหมด, รูปไม่ใช่สลิป) */
  available: boolean;
  imageKey: string;
  slipUrl: string;
  reading: SlipReading | null;
  expectedAmount: number;
  discountPct: number;
  checks: SlipCheck[];
  matched: boolean;
  /** วันที่รับเงินที่จะใช้ถ้ายืนยัน (YYYY-MM-DD เวลาไทย) */
  paymentDate: string;
  /** มีเฉพาะเมื่อ matched — ส่งกลับมาที่ slip-confirm */
  ticket: string | null;
}

interface SlipTicket {
  v: number;
  contractId: string;
  actorId: string;
  imageKey: string;
  slipUrl: string;
  hash: string;
  amount: number;
  refNo: string | null;
  bankName: string | null;
  date: string | null;
  confidence: number;
  expectedAmount: number;
  discountPct: number;
  paymentDate: string;
  exp: number;
}

/**
 * ปิดสัญญาก่อนกำหนดด้วยสลิป (mockup 69ezDjY8 กระดาน 1–6): แนบ → อ่าน → ตรวจ 5 ข้อ → ตั๋ว → ยืนยัน
 *
 * ทำไมเป็น "ตั๋วเซ็น" ไม่ใช่แถวในฐาน: ผลอ่าน OCR ไม่ deterministic — ถ้าอ่านซ้ำตอนยืนยันอาจได้ตัวเลข
 * ไม่ตรงกับที่โชว์ให้พนักงานดู; และไม่มีตารางเก็บผลอ่านที่ยังไม่ผูกใบเสร็จ (PaymentEvidence ไม่มี json)
 * ⇒ เซ็น HMAC ผลที่ตรวจแล้วส่งให้ client ถือ 15 นาที ตอนยืนยันตรวจลายเซ็น + ยอดปิดสด + ลายนิ้วมือสลิป
 * (unique) ในทรานแซกชันเดียวกับ JE (ContractPaymentService.earlyPayoff ทาง slipMatch)
 */
@Injectable()
export class EarlyPayoffSlipService {
  private readonly logger = new Logger(EarlyPayoffSlipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly vision: VisionService,
    private readonly financeConfig: FinanceConfigService,
    private readonly contractPayment: ContractPaymentService,
    private readonly config: ConfigService,
  ) {}

  async verify(
    contractId: string,
    file: Express.Multer.File | undefined,
    discountPctRaw: string | number | undefined,
    actorId: string,
  ): Promise<EarlyPayoffSlipVerifyResult> {
    if (!file || !isEvidenceImage(file)) {
      throw new BadRequestException('กรุณาแนบรูปสลิป (JPG/PNG/WEBP)');
    }
    if (file.size > EVIDENCE_IMAGE_MAX_BYTES) {
      throw new BadRequestException('ไฟล์สลิปมีขนาดเกิน 5MB');
    }
    const discountPct = this.parseDiscount(discountPctRaw);

    // ยอดปิดสด (โยน 400 เองถ้าสัญญาไม่อยู่ในสถานะปิดได้) — คำนวณก่อนอัปโหลด กันเก็บรูปของสัญญาที่ปิดไม่ได้
    const quote = await this.contractPayment.getEarlyPayoffQuote(
      contractId,
      discountPct,
      PAYOFF_DEPOSIT_ACCOUNT,
    );

    const key = `early-payoff-slips/${contractId}/${Date.now()}-${randomUUID()}.${evidenceImageExtension(file.mimetype)}`;
    await this.storage.upload(key, file.buffer, file.mimetype);
    const slipUrl = this.storage.getPublicUrl(key);

    let reading: SlipReading | null = null;
    try {
      reading = await this.vision.extractSlip(file.buffer, file.mimetype);
    } catch (err) {
      this.logger.warn(
        `[early-payoff-slip] OCR failed for contract ${contractId}: ${err instanceof Error ? err.message : err}`,
      );
      reading = null;
    }

    const hash = reading ? slipFingerprint(reading, key) : null;
    const reused = hash
      ? !!(await this.prisma.slipFingerprint.findUnique({ where: { hash }, select: { id: true } }))
      : false;

    const now = new Date();
    const checks = evaluateSlipChecks({
      reading,
      expectedAmount: quote.totalPayoff,
      isCompanyAccount: (acct) => this.financeConfig.isCompanyBankAccount(acct),
      reused,
      now,
    });
    const matched = checks.every((c) => c.ok);
    const paymentDate = bangkokDateString(slipPaymentDate(reading, now));

    const ticket =
      matched && reading && hash
        ? this.sign({
            v: TICKET_VERSION,
            contractId,
            actorId,
            imageKey: key,
            slipUrl,
            hash,
            amount: reading.amount as number,
            refNo: reading.refNo ?? null,
            bankName: reading.bankName ?? null,
            date: reading.date ?? null,
            confidence: reading.confidence,
            expectedAmount: quote.totalPayoff,
            discountPct,
            paymentDate,
            exp: now.getTime() + TICKET_TTL_MS,
          })
        : null;

    return {
      engine: 'OCR',
      available: reading !== null,
      imageKey: key,
      slipUrl,
      reading,
      expectedAmount: quote.totalPayoff,
      discountPct,
      checks,
      matched,
      paymentDate,
      ticket,
    };
  }

  /** ยืนยันปิดสัญญาด้วยตั๋วที่ verify() ออกให้ — ตั๋วต้องเป็นของสัญญานี้และผู้กดคนเดิม */
  async confirm(contractId: string, userId: string, dto: EarlyPayoffSlipConfirmDto) {
    const t = this.parseTicket(dto.ticket, contractId, userId);
    const slipMatch: SlipMatchAuthorization = {
      imageKey: t.imageKey,
      hash: t.hash,
      amount: t.amount,
      refNo: t.refNo,
      bankName: t.bankName,
      date: t.date,
      confidence: t.confidence,
    };
    return this.contractPayment.earlyPayoff(
      contractId,
      userId,
      {
        paymentMethod: 'BANK_TRANSFER',
        discountPct: t.discountPct,
        depositAccountCode: PAYOFF_DEPOSIT_ACCOUNT,
        paymentDate: t.paymentDate,
        slipUrl: t.slipUrl,
        referenceNo: t.refNo ?? undefined,
        notes: dto.notes,
      },
      undefined,
      slipMatch,
    );
  }

  private parseDiscount(raw: string | number | undefined): number {
    if (raw === undefined || raw === null || raw === '') return 50;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new BadRequestException('ส่วนลดต้องอยู่ระหว่าง 0 ถึง 100');
    }
    return n;
  }

  private secret(): string {
    const s = this.config.get<string>('JWT_SECRET');
    if (!s) throw new Error('JWT_SECRET is not configured');
    return s;
  }

  private sign(payload: SlipTicket): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.secret()).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  private parseTicket(ticket: string, contractId: string, actorId: string): SlipTicket {
    const invalid = () => new BadRequestException('ตั๋วตรวจสลิปไม่ถูกต้อง กรุณาแนบสลิปใหม่');
    const [body, sig] = (ticket ?? '').split('.');
    if (!body || !sig) throw invalid();
    const expected = crypto.createHmac('sha256', this.secret()).update(body).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw invalid();
    let parsed: SlipTicket;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SlipTicket;
    } catch {
      throw invalid();
    }
    if (
      parsed.v !== TICKET_VERSION ||
      parsed.contractId !== contractId ||
      parsed.actorId !== actorId
    ) {
      throw invalid();
    }
    if (typeof parsed.exp !== 'number' || Date.now() > parsed.exp) {
      throw new BadRequestException('ตั๋วตรวจสลิปหมดอายุ (15 นาที) กรุณาแนบสลิปใหม่');
    }
    return parsed;
  }
}
