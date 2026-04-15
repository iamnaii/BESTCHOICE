import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface LeadScoreResult {
  score: number;
  temperature: string;
  signals: string[];
}

@Injectable()
export class LeadScoringService {
  private readonly logger = new Logger(LeadScoringService.name);

  constructor(private prisma: PrismaService) {}

  async scoreSession(sessionId: string): Promise<LeadScoreResult> {
    const messages = await this.prisma.chatMessage.findMany({
      where: { sessionId, role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    if (messages.length === 0) {
      return { score: 0, temperature: 'COLD', signals: [] };
    }

    const text = messages.map((m) => m.text ?? '').join(' ').toLowerCase();
    let score = 0;
    const signals: string[] = [];

    // Price/installment inquiry (+30)
    if (/ราคา|เท่าไ[ห]?ร่|ผ่อน|งวด|ดาวน์|เงินดาวน์|ค่างวด/.test(text)) {
      score += 30;
      signals.push('ถามราคา/ผ่อน');
    }

    // Specific model mention (+20)
    if (/iphone\s*\d|samsung\s*(galaxy\s*)?(s|a|z)\s*\d|oppo|vivo|xiaomi|realme/i.test(text)) {
      score += 20;
      signals.push('ระบุรุ่นชัดเจน');
    }

    // Stock/color inquiry (+15)
    if (/สต็อก|มีไหม|สี|มีสี|เหลือ|ยังมี|กี่เครื่อง/.test(text)) {
      score += 15;
      signals.push('ถามสต็อก/สี');
    }

    // Returning customer (+15)
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { customer: { include: { contracts: { where: { deletedAt: null } } } } },
    });
    if (session?.customer?.contracts && session.customer.contracts.length > 0) {
      score += 15;
      signals.push('ลูกค้าเก่า (มีสัญญา)');
    }

    // Location/time inquiry (+10)
    if (/สาขา|ที่ไหน|เปิด|ปิด|กี่โมง|แผนที่|ที่อยู่/.test(text)) {
      score += 10;
      signals.push('ถามสาขา/เวลา');
    }

    // Multiple messages (+5 per msg, max +15)
    const msgBonus = Math.min(messages.length * 5, 15);
    if (messages.length > 1) {
      score += msgBonus;
      signals.push(`สนทนาต่อเนื่อง (${messages.length} ข้อความ)`);
    }

    // Single message penalty (-10)
    if (messages.length === 1) {
      score -= 10;
      signals.push('ส่งข้อความเดียว');
    }

    score = Math.max(0, Math.min(100, score));
    const temperature = score >= 80 ? 'HOT' : score >= 50 ? 'WARM' : 'COLD';

    // Update DB
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { leadScore: score, leadTemperature: temperature },
    });

    return { score, temperature, signals };
  }
}
