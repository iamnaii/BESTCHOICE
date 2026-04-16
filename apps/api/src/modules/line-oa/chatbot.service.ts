import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../../prisma/prisma.service';
import { CHATBOT_SYSTEM_PROMPT, CHATBOT_CONTEXT_INSTRUCTIONS } from './chatbot-system-prompt.constants';
import { CHATBOT_TOOLS, ChatbotToolName } from './chatbot/chatbot-tools';

/**
 * ChatbotService — AI-powered response generation สำหรับน้องเบส
 * ใช้สำหรับ freeform messages ที่ไม่ใช่ keyword commands
 * รองรับ tool use สำหรับดึงข้อมูลสัญญา/การชำระของลูกค้า
 */
@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);
  private anthropic: Anthropic | null = null;
  private static readonly MODEL = 'claude-haiku-4-5-20251001'; // Haiku สำหรับ chatbot (เร็ว + ประหยัด)
  private static readonly MAX_TOKENS = 500;

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    const apiKey = (
      this.configService.get<string>('ANTHROPIC_API_KEY') ||
      process.env.ANTHROPIC_API_KEY ||
      ''
    ).trim();
    if (apiKey) {
      this.anthropic = new Anthropic({ apiKey });
      this.logger.log('[Chatbot] AI service initialized');
    } else {
      this.logger.warn('[Chatbot] ANTHROPIC_API_KEY not set — AI responses disabled');
    }
  }

  get isEnabled(): boolean {
    return this.anthropic !== null;
  }

  /**
   * สร้าง AI response สำหรับข้อความที่ไม่ match keyword commands
   * ถ้า lineUserId มีค่า จะดึงข้อมูลลูกค้าและใช้ tool use เพื่อตอบคำถามเกี่ยวกับสัญญา/การชำระ
   * ถ้า AI ไม่พร้อม จะ return null (controller จะใช้ fallback response แทน)
   */
  async generateResponse(userMessage: string, lineUserId?: string): Promise<string | null> {
    if (!this.anthropic) {
      return null;
    }

    try {
      // Look up customer context if lineUserId is provided
      let customerContext: any = null;
      if (lineUserId) {
        customerContext = await this.prisma.customer.findFirst({
          where: { lineId: lineUserId, deletedAt: null },
          include: {
            contracts: {
              where: { status: { in: ['ACTIVE', 'OVERDUE'] }, deletedAt: null },
              include: {
                payments: {
                  where: { deletedAt: null },
                  orderBy: { paidAt: 'desc' },
                  take: 5,
                },
              },
            },
          },
        });
      }

      // Build system prompt — enhance with context instructions if customer is found
      const systemPrompt = customerContext
        ? `${CHATBOT_SYSTEM_PROMPT}${CHATBOT_CONTEXT_INSTRUCTIONS}`
        : CHATBOT_SYSTEM_PROMPT;

      // First API call — include tools if we have customer context
      const createParams: Parameters<typeof this.anthropic.messages.create>[0] = {
        model: ChatbotService.MODEL,
        max_tokens: ChatbotService.MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        ...(customerContext ? { tools: CHATBOT_TOOLS as any } : {}),
      };

      const response = (await this.anthropic.messages.create(createParams)) as Anthropic.Message;

      // Handle tool_use stop reason
      if (response.stop_reason === 'tool_use' && customerContext) {
        const toolUseBlock = response.content.find((b) => b.type === 'tool_use');
        if (toolUseBlock) {
          const toolResult = await this.executeTool(
            (toolUseBlock as Anthropic.ToolUseBlock).name as ChatbotToolName,
            customerContext,
            (toolUseBlock as Anthropic.ToolUseBlock).input as Record<string, any>,
          );

          // Second API call with tool result
          const followUp = (await this.anthropic.messages.create({
            model: ChatbotService.MODEL,
            max_tokens: ChatbotService.MAX_TOKENS,
            system: systemPrompt,
            tools: CHATBOT_TOOLS as any,
            messages: [
              { role: 'user', content: userMessage },
              { role: 'assistant', content: response.content },
              {
                role: 'user',
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: (toolUseBlock as Anthropic.ToolUseBlock).id,
                    content: JSON.stringify(toolResult),
                  },
                ],
              },
            ],
          })) as Anthropic.Message;

          const textBlock = followUp.content.find((b) => b.type === 'text');
          return textBlock ? (textBlock as Anthropic.TextBlock).text : null;
        }
      }

      // Standard text response
      const textBlock = response.content.find((block) => block.type === 'text');
      return textBlock ? (textBlock as Anthropic.TextBlock).text : null;
    } catch (err) {
      this.logger.error(`[Chatbot] AI response error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /**
   * Execute a chatbot tool — maps tool name to data from customerContext
   */
  private async executeTool(
    toolName: ChatbotToolName,
    customerContext: any,
    input?: Record<string, any>,
  ): Promise<unknown> {
    const contracts: any[] = customerContext?.contracts ?? [];

    switch (toolName) {
      case 'getContractSummary': {
        return contracts.map((c) => {
          const unpaidPayments = (c.payments ?? []).filter((p: any) => p.status !== 'PAID');
          const nextPayment = unpaidPayments[unpaidPayments.length - 1] ?? null; // payments ordered desc, so last = earliest due
          const remainingBalance = unpaidPayments.reduce(
            (sum: number, p: any) => sum + Number(p.amountDue ?? 0),
            0,
          );
          return {
            contractNumber: c.contractNumber,
            status: c.status,
            remainingBalance,
            installmentNo: nextPayment?.installmentNo ?? null,
            totalInstallments: (c.payments ?? []).length,
            monthlyPayment: nextPayment ? Number(nextPayment.amountDue ?? 0) : null,
            nextDueDate: nextPayment?.dueDate ?? null,
          };
        });
      }

      case 'getPaymentHistory': {
        const allPayments: any[] = contracts.flatMap((c) =>
          (c.payments ?? [])
            .filter((p: any) => p.status === 'PAID')
            .map((p: any) => ({
              contractNumber: c.contractNumber,
              amount: Number(p.amountPaid ?? p.amountDue ?? 0),
              paidAt: p.paidAt ?? p.paidDate ?? null,
              method: p.paymentMethod ?? null,
            })),
        );
        // Sort by paidAt desc and take 5
        allPayments.sort((a, b) => {
          if (!a.paidAt) return 1;
          if (!b.paidAt) return -1;
          return new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime();
        });
        return allPayments.slice(0, 5);
      }

      case 'getNextPayment': {
        const activeContract = contracts.find((c) => c.status === 'ACTIVE') ?? contracts[0];
        if (!activeContract) return { message: 'ไม่พบสัญญาที่ใช้งานอยู่' };

        // payments ordered by paidAt desc — find unpaid ones; earliest due = last in array
        const unpaid = (activeContract.payments ?? []).filter((p: any) => p.status !== 'PAID');
        const next = unpaid[unpaid.length - 1] ?? null;
        if (!next) return { message: 'ชำระครบทุกงวดแล้วค่ะ' };

        return {
          contractNumber: activeContract.contractNumber,
          installmentNo: next.installmentNo,
          totalInstallments: (activeContract.payments ?? []).length,
          amountDue: Number(next.amountDue ?? 0),
          dueDate: next.dueDate,
          status: next.status,
        };
      }

      case 'getEarlyPayoff': {
        const contractNumber = input?.contractNumber as string | undefined;
        const targetContract = contractNumber
          ? contracts.find((c) => c.contractNumber === contractNumber)
          : contracts.find((c) => c.status === 'ACTIVE') ?? contracts[0];

        if (!targetContract) return { message: 'ไม่พบสัญญา' };

        const unpaid = (targetContract.payments ?? []).filter((p: any) => p.status !== 'PAID');
        const remainingBalance = unpaid.reduce(
          (sum: number, p: any) => sum + Number(p.amountDue ?? 0),
          0,
        );

        return {
          contractNumber: targetContract.contractNumber,
          remainingBalance,
          remainingInstallments: unpaid.length,
          message: 'กรุณากดปุ่ม "ปิดสัญญาก่อนกำหนด" ใน Rich Menu หรือเข้าลิงก์ LIFF เพื่อดำเนินการ',
        };
      }

      default:
        return { message: 'ไม่รู้จัก tool นี้' };
    }
  }
}
