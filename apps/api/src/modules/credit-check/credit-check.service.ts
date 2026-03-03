import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';

@Injectable()
export class CreditCheckService {
  private readonly logger = new Logger(CreditCheckService.name);
  private anthropic: Anthropic | null = null;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {
    const apiKey = this.configService.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
    }
  }

  async findByContract(contractId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { contractId },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
    return creditCheck;
  }

  // === Customer-level credit check (ไม่ต้องมีสัญญา) ===
  async findByCustomer(customerId: string) {
    return this.prisma.creditCheck.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        contract: { select: { id: true, contractNumber: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async findLatestByCustomer(customerId: string) {
    return this.prisma.creditCheck.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async createForCustomer(customerId: string, dto: CreateCreditCheckDto, userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    return this.prisma.creditCheck.create({
      data: {
        customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async analyzeForCustomer(creditCheckId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      include: {
        contract: { select: { monthlyPayment: true, totalMonths: true, financedAmount: true } },
        customer: { select: { name: true, salary: true, occupation: true, occupationDetail: true } },
      },
    });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if (creditCheck.statementFiles.length === 0) {
      throw new BadRequestException('กรุณาอัปโหลด Statement ธนาคารก่อน');
    }

    const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;
    // If linked to a contract, use contract's monthly payment; otherwise estimate
    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;

    const aiAnalysis = await this.performAIAnalysis({
      bankName: creditCheck.bankName,
      statementMonths: creditCheck.statementMonths,
      statementFileCount: creditCheck.statementFiles.length,
      statementFiles: creditCheck.statementFiles,
      monthlyPayment,
      customerSalary,
      customerOccupation: creditCheck.customer.occupation,
    });

    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async overrideById(creditCheckId: string, dto: OverrideCreditCheckDto, userId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { id: creditCheckId } });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        status: dto.status as any,
        reviewNotes: dto.reviewNotes,
        checkedById: userId,
        checkedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async create(contractId: string, dto: CreateCreditCheckDto, userId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // Check if credit check already exists
    const existing = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (existing) {
      // Update existing
      return this.prisma.creditCheck.update({
        where: { contractId },
        data: {
          bankName: dto.bankName,
          statementFiles: dto.statementFiles,
          statementMonths: dto.statementMonths ?? 3,
          status: 'PENDING',
          aiAnalysis: Prisma.JsonNull,
          aiScore: null,
          aiSummary: null,
          aiRecommendation: null,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
          checkedBy: { select: { id: true, name: true } },
        },
      });
    }

    return this.prisma.creditCheck.create({
      data: {
        contractId,
        customerId: contract.customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async analyze(contractId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { contractId },
      include: {
        contract: {
          select: { monthlyPayment: true, totalMonths: true, financedAmount: true },
        },
        customer: {
          select: { name: true, salary: true, occupation: true, occupationDetail: true },
        },
      },
    });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if (creditCheck.statementFiles.length === 0) {
      throw new BadRequestException('กรุณาอัปโหลด Statement ธนาคารก่อน');
    }

    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;
    const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;

    const aiAnalysis = await this.performAIAnalysis({
      bankName: creditCheck.bankName,
      statementMonths: creditCheck.statementMonths,
      statementFileCount: creditCheck.statementFiles.length,
      statementFiles: creditCheck.statementFiles,
      monthlyPayment,
      customerSalary,
      customerOccupation: creditCheck.customer.occupation,
    });

    const updatedCheck = await this.prisma.creditCheck.update({
      where: { contractId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    return updatedCheck;
  }

  async override(contractId: string, dto: OverrideCreditCheckDto, userId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.creditCheck.update({
      where: { contractId },
      data: {
        status: dto.status as any,
        reviewNotes: dto.reviewNotes,
        checkedById: userId,
        checkedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  private async performAIAnalysis(params: {
    bankName: string | null;
    statementMonths: number;
    statementFileCount: number;
    statementFiles: string[];
    monthlyPayment: number;
    customerSalary: number;
    customerOccupation: string | null;
  }) {
    // Try Claude Vision API first, fallback to rule-based if unavailable
    if (this.anthropic && params.statementFiles.length > 0) {
      try {
        return await this.performClaudeAnalysis(params);
      } catch (error) {
        this.logger.warn(`Claude API analysis failed, falling back to rule-based: ${error.message}`);
      }
    }

    return this.performRuleBasedAnalysis(params);
  }

  private async performClaudeAnalysis(params: {
    bankName: string | null;
    statementMonths: number;
    statementFiles: string[];
    monthlyPayment: number;
    customerSalary: number;
    customerOccupation: string | null;
  }) {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const contentBlocks: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

    // Add statement images as content blocks (only accept base64 data URLs to prevent SSRF)
    for (const fileUrl of params.statementFiles.slice(0, 5)) {
      if (!fileUrl.startsWith('data:')) {
        this.logger.warn('Skipping non-data-URL statement file to prevent SSRF');
        continue;
      }
      const match = fileUrl.match(/^data:(image\/(jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/);
      if (match) {
        const mediaType = match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data: match[3] },
        });
      }
    }

    contentBlocks.push({
      type: 'text',
      text: `วิเคราะห์ Statement ธนาคาร${params.bankName ? ` (${params.bankName})` : ''} ของลูกค้าที่ต้องการผ่อนชำระสินค้า

ข้อมูลลูกค้า:
- อาชีพ: ${params.customerOccupation || 'ไม่ระบุ'}
- เงินเดือนที่แจ้ง: ${params.customerSalary > 0 ? `${params.customerSalary.toLocaleString()} บาท/เดือน` : 'ไม่ได้แจ้ง'}
- ค่างวดที่ต้องจ่าย: ${params.monthlyPayment > 0 ? `${params.monthlyPayment.toLocaleString()} บาท/เดือน` : 'ไม่ระบุ'}
- Statement ย้อนหลัง: ${params.statementMonths} เดือน

กรุณาวิเคราะห์และตอบเป็น JSON เท่านั้น ตามรูปแบบนี้:
{
  "score": <คะแนน 0-100>,
  "summary": "<สรุปผลภาษาไทย 2-3 ประโยค>",
  "recommendation": "<คำแนะนำ: แนะนำอนุมัติ / พิจารณาเพิ่มเติม / ไม่แนะนำอนุมัติ พร้อมเหตุผล>",
  "analysis": {
    "monthlyIncome": <รายได้ต่อเดือนโดยประมาณจาก statement>,
    "averageBalance": <ยอดเงินคงเหลือเฉลี่ย>,
    "monthlyPayment": ${params.monthlyPayment},
    "affordabilityRatio": <สัดส่วนค่างวดต่อรายได้ 0.0-1.0>,
    "incomeConsistency": "<stable/unstable/unknown>",
    "debtObligations": <ประมาณภาระหนี้อื่นต่อเดือน>,
    "riskFactors": [<รายการความเสี่ยง>],
    "positiveFactors": [<รายการจุดแข็ง>]
  }
}

เกณฑ์การให้คะแนน:
- 70-100: รายได้สม่ำเสมอ, ค่างวดไม่เกิน 30% ของรายได้, ยอดคงเหลือดี
- 40-69: มีความเสี่ยงบางอย่าง ควรพิจารณาเพิ่มเติม
- 0-39: ความเสี่ยงสูง รายได้ไม่เพียงพอหรือไม่สม่ำเสมอ

ตอบเป็น JSON เท่านั้น ไม่ต้องมี markdown code block`,
    });

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: contentBlocks }],
    });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON from response (handle possible markdown wrapping)
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonText);

    const score = Math.max(0, Math.min(100, Number(result.score) || 50));

    return {
      score,
      summary: result.summary || 'วิเคราะห์โดย AI',
      recommendation: result.recommendation || 'กรุณาตรวจสอบเพิ่มเติม',
      analysis: result.analysis || {},
    };
  }

  private performRuleBasedAnalysis(params: {
    monthlyPayment: number;
    customerSalary: number;
    statementFileCount?: number;
    customerOccupation: string | null;
  }) {
    const { monthlyPayment, customerSalary } = params;

    let score = 50;
    const riskFactors: string[] = [];
    const positiveFactors: string[] = [];

    if (customerSalary > 0) {
      const affordabilityRatio = monthlyPayment / customerSalary;
      if (affordabilityRatio <= 0.2) {
        score += 30;
        positiveFactors.push('ค่างวดไม่เกิน 20% ของรายได้');
      } else if (affordabilityRatio <= 0.3) {
        score += 20;
        positiveFactors.push('ค่างวดไม่เกิน 30% ของรายได้');
      } else if (affordabilityRatio <= 0.4) {
        score += 10;
        riskFactors.push('ค่างวดเกิน 30% ของรายได้');
      } else {
        score -= 10;
        riskFactors.push('ค่างวดเกิน 40% ของรายได้ - ความเสี่ยงสูง');
      }
    } else {
      score -= 10;
      riskFactors.push('ไม่มีข้อมูลรายได้');
    }

    const fileCount = params.statementFileCount ?? 0;
    if (fileCount >= 3) {
      score += 10;
      positiveFactors.push('มี Statement ครบ 3 เดือน');
    } else if (fileCount >= 1) {
      score += 5;
      riskFactors.push('Statement ไม่ครบ 3 เดือน');
    }

    if (params.customerOccupation) {
      score += 5;
      positiveFactors.push(`อาชีพ: ${params.customerOccupation}`);
    }

    score = Math.max(0, Math.min(100, score));

    const analysis = {
      monthlyIncome: customerSalary,
      monthlyPayment,
      affordabilityRatio: customerSalary > 0 ? Math.round((monthlyPayment / customerSalary) * 100) / 100 : null,
      riskFactors,
      positiveFactors,
      incomeConsistency: customerSalary > 0 ? 'มีรายได้' : 'ไม่มีข้อมูล',
    };

    let recommendation: string;
    if (score >= 70) {
      recommendation = 'แนะนำอนุมัติ - ลูกค้ามีความสามารถในการชำระเพียงพอ';
    } else if (score >= 50) {
      recommendation = 'พิจารณาเพิ่มเติม - ควรตรวจสอบข้อมูลเพิ่มเติม';
    } else {
      recommendation = 'ไม่แนะนำอนุมัติ - ความเสี่ยงสูง';
    }

    const summaryParts: string[] = [];
    if (customerSalary > 0) {
      summaryParts.push(`รายได้ ${customerSalary.toLocaleString()} บาท/เดือน`);
      summaryParts.push(`ค่างวด ${monthlyPayment.toLocaleString()} บาท/เดือน`);
      summaryParts.push(`สัดส่วน ${((monthlyPayment / customerSalary) * 100).toFixed(0)}% ของรายได้`);
    }
    if (positiveFactors.length > 0) summaryParts.push(`จุดแข็ง: ${positiveFactors.join(', ')}`);
    if (riskFactors.length > 0) summaryParts.push(`ความเสี่ยง: ${riskFactors.join(', ')}`);

    return {
      score,
      summary: summaryParts.join(' | '),
      recommendation,
      analysis,
    };
  }
}
