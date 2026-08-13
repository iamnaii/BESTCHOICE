import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LineExtractorSource, ExtractedMessage } from './sources/line-extractor.source';
import { FacebookExtractorSource } from './sources/facebook-extractor.source';
import { scrubPii } from './pii-scrubber.util';

@Injectable()
export class ChatHistoryExtractorService {
  private readonly logger = new Logger(ChatHistoryExtractorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lineSrc: LineExtractorSource,
    private readonly fbSrc: FacebookExtractorSource,
  ) {}

  async extractAll(
    months: number,
  ): Promise<{ lineCount: number; fbCount: number; pairsWritten: number }> {
    const since = new Date();
    since.setMonth(since.getMonth() - months);

    this.logger.log(`Extracting from ${since.toISOString()} onward`);
    // LINE มี 2 OA: น้องเบส (LINE_FINANCE) + ร้าน (LINE_SHOP) — เดิมดูดแค่ FINANCE
    // ซึ่งบน prod แทบว่าง แชทลูกค้าจริงส่วนใหญ่อยู่ฝั่ง SHOP
    const [lineFinanceMsgs, lineShopMsgs, fbMsgs] = await Promise.all([
      this.lineSrc.extract({ channel: 'LINE_FINANCE', since }),
      this.lineSrc.extract({ channel: 'LINE_SHOP', since }),
      this.fbSrc.extract({ since }),
    ]);
    const lineMsgs = [...lineFinanceMsgs, ...lineShopMsgs];

    const all = [...lineMsgs, ...fbMsgs].map((m) => ({ ...m, text: scrubPii(m.text) }));
    const pairs = this.buildPairs(all);

    // ai_training_pairs ไม่มี unique constraint — skipDuplicates ด้านล่างจึงไม่กันซ้ำให้จริง
    // ต้องเทียบกับของเดิมในโค้ด: กันทั้งซ้ำข้ามรอบ (re-run) และซ้ำในรอบเดียวกัน
    const existing = await this.prisma.aiTrainingPair.findMany({
      where: { source: 'SYSTEM_EXTRACT' },
      select: { customerMessage: true, humanEdit: true },
    });
    const pairKey = (q: string, a: string) => `${q}\u0000${a}`;
    const seen = new Set(existing.map((e) => pairKey(e.customerMessage, e.humanEdit ?? '')));
    const freshPairs = pairs.filter((p) => {
      const k = pairKey(p.customerMessage, p.staffAnswer);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (freshPairs.length < pairs.length) {
      this.logger.log(`ข้ามคู่ข้อความซ้ำ ${pairs.length - freshPairs.length} คู่`);
    }

    const BATCH = 500;
    let written = 0;
    for (let i = 0; i < freshPairs.length; i += BATCH) {
      const batch = freshPairs.slice(i, i + BATCH);
      await this.prisma.aiTrainingPair.createMany({
        data: batch.map((p) => ({
          type: 'ACCEPT',
          source: 'SYSTEM_EXTRACT',
          roomId: null,
          customerMessage: p.customerMessage,
          aiDraft: null,
          humanEdit: p.staffAnswer,
          intent: null,
          quality: null,
        })),
        skipDuplicates: true,
      });
      written += batch.length;
    }

    return { lineCount: lineMsgs.length, fbCount: fbMsgs.length, pairsWritten: written };
  }

  private buildPairs(
    msgs: ExtractedMessage[],
  ): { customerMessage: string; staffAnswer: string }[] {
    const byRoom = new Map<string, ExtractedMessage[]>();
    for (const m of msgs) {
      const arr = byRoom.get(m.roomId) ?? [];
      arr.push(m);
      byRoom.set(m.roomId, arr);
    }
    const pairs: { customerMessage: string; staffAnswer: string }[] = [];
    for (const arr of byRoom.values()) {
      arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (let i = 0; i < arr.length; i++) {
        if (arr[i].role !== 'CUSTOMER') continue;
        const next = arr.slice(i + 1).find((m) => m.role === 'STAFF');
        if (next) pairs.push({ customerMessage: arr[i].text, staffAnswer: next.text });
      }
    }
    return pairs;
  }
}
