import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface ChatRow {
  timestamp: string;
  senderType: 'customer' | 'staff';
  message: string;
}

@Injectable()
export class AiImportService {
  private readonly logger = new Logger(AiImportService.name);

  constructor(private prisma: PrismaService) {}

  async importChatHistory(rows: ChatRow[]): Promise<{ imported: number; skipped: number }> {
    const sorted = [...rows].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      if (current.senderType === 'customer' && next.senderType === 'staff') {
        if (!current.message?.trim() || !next.message?.trim()) {
          skipped++;
          continue;
        }

        const exists = await this.prisma.aiTrainingPair.findFirst({
          where: {
            source: 'CHATCONE_IMPORT',
            customerMessage: current.message.trim(),
            humanEdit: next.message.trim(),
          },
        });
        if (exists) {
          skipped++;
          continue;
        }

        await this.prisma.aiTrainingPair.create({
          data: {
            type: 'ACCEPT',
            source: 'CHATCONE_IMPORT',
            customerMessage: current.message.trim(),
            humanEdit: next.message.trim(),
            quality: 0.5,
          },
        });
        imported++;
        i++;
      }
    }
    this.logger.log(`Import complete: ${imported} imported, ${skipped} skipped`);
    return { imported, skipped };
  }

  parseCSV(csvContent: string): ChatRow[] {
    const lines = csvContent.split('\n').filter((l) => l.trim());
    if (lines.length < 2) throw new BadRequestException('CSV ต้องมีอย่างน้อย 1 แถวข้อมูล');
    const header = lines[0].toLowerCase();
    const hasHeader = header.includes('timestamp') || header.includes('sender');
    const dataLines = hasHeader ? lines.slice(1) : lines;

    return dataLines.map((line) => {
      const parts = line.split(',').map((p) => p.trim().replace(/^"|"$/g, ''));
      if (parts.length < 3) throw new BadRequestException(`บรรทัดไม่ถูกรูปแบบ: ${line}`);
      return {
        timestamp: parts[0],
        senderType: parts[1].toLowerCase().includes('customer')
          ? ('customer' as const)
          : ('staff' as const),
        message: parts.slice(2).join(','),
      };
    });
  }

  parseJSON(jsonContent: string): ChatRow[] {
    const data = JSON.parse(jsonContent);
    if (!Array.isArray(data)) throw new BadRequestException('JSON ต้องเป็น array');
    return data.map((row: any) => ({
      timestamp: row.timestamp ?? row.date ?? new Date().toISOString(),
      senderType: (row.senderType ?? row.sender_type ?? row.role ?? '')
        .toLowerCase()
        .includes('customer')
        ? ('customer' as const)
        : ('staff' as const),
      message: row.message ?? row.text ?? row.content ?? '',
    }));
  }
}
