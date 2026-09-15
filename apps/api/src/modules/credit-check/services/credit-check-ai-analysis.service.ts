import { NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { AiProviderService, AiClient, AiRequest } from '../../ai-usage/ai-provider.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { IntegrationConfigService } from '../../integrations/integration-config.service';
import type { JourneyEntryWriter } from '../../customer-journey/journey-entry-writer.service';
import { journeyDedupeKey } from '../../customer-journey/journey-data-schemas';

/**
 * AI-analysis sub-service for credit-check. Plain class (NOT @Injectable) —
 * instantiated internally by the CreditCheckService facade.
 *
 * Owns: analyzeForCustomer, analyze + the private performAIAnalysis /
 * performClaudeAnalysis / performRuleBasedAnalysis. Credentials still resolve
 * through IntegrationConfigService; client caching and request usage belong to
 * the shared provider transport.
 */
export class CreditCheckAiAnalysisService {
  private readonly logger = new Logger(CreditCheckAiAnalysisService.name);

  constructor(
    private prisma: PrismaService,
    private integrationConfig: IntegrationConfigService,
    private provider: AiProviderService,
    // การเดินทางของลูกค้า (CREDIT_AI_SCORED) — ไม่บังคับ: เทสเดิมประกอบด้วย 3 อาร์กิวเมนต์
    private journeyEntries?: JourneyEntryWriter,
  ) {}

  private async getAnthropicClient(): Promise<AiClient | null> {
    const apiKey = ((await this.integrationConfig.getValue('claude-ai', 'apiKey')) || '').trim();
    return this.provider.clientFor(apiKey, 'credit');
  }

  async analyzeForCustomer(creditCheckId: string, userId?: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      include: {
        contract: { select: { monthlyPayment: true, totalMonths: true, financedAmount: true } },
        customer: { select: { name: true, salary: true, occupation: true, occupationDetail: true } },
      },
    });
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if ((creditCheck.aiAnalysis as Record<string, unknown> | null)?.source === 'chat-statement') {
      throw new BadRequestException('รายการนี้อ่านจากสเตทเม้นในแชท กรุณาเปิดแชทต้นทางเพื่อวิเคราะห์อีกครั้ง');
    }

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
      userId,
    });

    const updated = await this.prisma.creditCheck.update({
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
    await this.recordAiScored(updated);
    return updated;
  }

  async analyze(contractId: string, userId?: string) {
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
    if (!creditCheck || creditCheck.deletedAt) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if ((creditCheck.aiAnalysis as Record<string, unknown> | null)?.source === 'chat-statement') {
      throw new BadRequestException('รายการนี้อ่านจากสเตทเม้นในแชท กรุณาเปิดแชทต้นทางเพื่อวิเคราะห์อีกครั้ง');
    }

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
      userId,
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
    await this.recordAiScored(updatedCheck);

    return updatedCheck;
  }

  /**
   * การเดินทางของลูกค้า — credit_checks.status ถูกเขียนทับทุกรอบ และ updatedAt ขยับทุกครั้งที่แก้แถว (ใช้ย้อนหลังไม่ได้)
   * ⇒ เก็บผลของรอบนี้เป็น entry หลัง update สำเร็จ · occurredAt = updatedAt ที่ update นี้เพิ่งเขียน
   * เก็บแค่คะแนนกับผล ไม่เก็บ aiSummary/aiAnalysis (มีรายได้ ยอดคงเหลือ ชื่อนายจ้าง) · ผู้กระทำ = ระบบ
   */
  private async recordAiScored(check: {
    id: string;
    customerId: string;
    aiScore: number | null;
    status: string;
    updatedAt: Date;
  }): Promise<void> {
    if (!this.journeyEntries) return;
    await this.journeyEntries.recordAfterCommit({
      customerId: check.customerId,
      kind: 'CREDIT_AI_SCORED',
      occurredAt: check.updatedAt,
      actorType: 'SYSTEM',
      actorUserId: null,
      refType: 'credit_check',
      refId: check.id,
      data: { score: check.aiScore, status: check.status },
      dedupeKey: journeyDedupeKey('CREDIT_AI_SCORED', check.id, check.updatedAt.toISOString()),
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
    userId?: string;
  }) {
    // Try Claude Vision API first, fallback to rule-based if unavailable
    const client = await this.getAnthropicClient();
    if (client && params.statementFiles.length > 0) {
      try {
        return await this.performClaudeAnalysis(params);
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Claude API analysis failed, falling back to rule-based: ${errMsg}`);
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
    userId?: string;
  }) {
    const client = await this.getAnthropicClient();
    if (!client) {
      throw new InternalServerErrorException('Anthropic client not initialized');
    }

    const contentBlocks: AiRequest['messages'][0]['content'] = [];

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
    "affordablePayment": <ค่างวดที่ผ่อนไหวต่อเดือน ไม่ใช่ค่างวดของสัญญา พิจารณาเงินเหลือและภาระหนี้ เพดานไม่เกินรายได้ต่อเดือน × 40% ตามเกณฑ์เดิม; null ถ้าข้อมูลไม่พอ>,
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

    // Live provider check on 2026-09-08 returned 404 for the former dated ID.
    // Use the validated OCR model; prompts, scoring and rule fallback stay unchanged.
    const model = 'claude-sonnet-4-6';

    const response = await this.provider.complete(client, {
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: contentBlocks }],
    }, { service: 'credit-check', method: 'performClaudeAnalysis', userId: params.userId });

    const textContent = response.content.find((c) => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new InternalServerErrorException('No text response from Claude');
    }

    // Parse JSON from response (handle possible markdown wrapping)
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonText);

    // Honor a legitimate score of 0 (absolute reject). `Number(x) || 50` collapsed
    // 0 into the 50 default; gate on finiteness so only missing/NaN scores default.
    const parsedScore = Number(result.score);
    const score = Number.isFinite(parsedScore) ? Math.max(0, Math.min(100, parsedScore)) : 50;

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
