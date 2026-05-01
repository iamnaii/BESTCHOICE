import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SaveFeedbackDto } from '../dto/ai-training.dto';
import { EmbeddingService } from './embedding.service';

@Injectable()
export class AiTrainingService {
  private readonly logger = new Logger(AiTrainingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Calculate quality score based on feedback type and edit distance.
   * ACCEPT=1.0, EDIT with small change (<30% diff)=0.7, EDIT with big change=0.3, REJECT=0.0
   */
  private calculateQuality(dto: SaveFeedbackDto): number {
    if (dto.type === 'ACCEPT') return 1.0;
    if (dto.type === 'REJECT') return 0.0;

    // EDIT — measure how much was changed
    const a = dto.aiDraft ?? '';
    const b = dto.humanEdit ?? '';

    if (!a && !b) return 0.7;
    if (!a || !b) return 0.3;

    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 0.7;

    const lengthRatio = Math.abs(a.length - b.length) / maxLen;

    // Also check character-level similarity for same-length edits
    let diffChars = 0;
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
      if (a[i] !== b[i]) diffChars++;
    }
    const charDiffRatio = (diffChars + Math.abs(a.length - b.length)) / maxLen;

    const isSmallChange = lengthRatio < 0.3 && charDiffRatio < 0.3;
    return isSmallChange ? 0.7 : 0.3;
  }

  /**
   * Save a training pair from staff feedback on an AI suggestion.
   */
  async saveFeedback(dto: SaveFeedbackDto): Promise<void> {
    const quality = this.calculateQuality(dto);

    await this.prisma.aiTrainingPair.create({
      data: {
        type: dto.type,
        source: 'SUGGEST_FEEDBACK',
        roomId: dto.sessionId,
        customerMessage: dto.customerMessage,
        aiDraft: dto.aiDraft,
        humanEdit: dto.humanEdit,
        intent: dto.intent,
        quality,
      },
    });
  }

  /**
   * Return top training pairs for few-shot prompt injection.
   *
   * If a query is provided AND the embedding service is configured, uses
   * pgvector cosine-similarity search over embedded pairs. Otherwise falls
   * back to highest-quality pairs (legacy behavior).
   *
   * Filters: quality >= 0.5 (CHATCONE_IMPORT default), optionally by intent.
   */
  async getFewShotExamples(
    intent: string | null,
    limit: number,
    query?: string,
  ): Promise<{ customerMessage: string; staffResponse: string }[]> {
    if (query && query.trim() && this.embedding.isReady()) {
      try {
        return await this.semanticSearch(query.trim(), intent, limit);
      } catch (err) {
        this.logger.warn(
          `Semantic retrieval failed, falling back to top-quality: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return this.topQualityExamples(intent, limit);
  }

  private async semanticSearch(
    query: string,
    intent: string | null,
    limit: number,
  ): Promise<{ customerMessage: string; staffResponse: string }[]> {
    const queryVec = await this.embedding.embedOne(query, 'RETRIEVAL_QUERY');
    const vectorLiteral = this.embedding.toPgvector(queryVec);

    // Cosine distance via <=> operator. Lower = more similar.
    // Use parameterized query to avoid injection.
    const rows = intent
      ? await this.prisma.$queryRaw<
          { customer_message: string; ai_draft: string | null; human_edit: string | null }[]
        >`
          SELECT customer_message, ai_draft, human_edit
          FROM ai_training_pairs
          WHERE embedding IS NOT NULL
            AND quality >= 0.5
            AND intent = ${intent}
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${limit}
        `
      : await this.prisma.$queryRaw<
          { customer_message: string; ai_draft: string | null; human_edit: string | null }[]
        >`
          SELECT customer_message, ai_draft, human_edit
          FROM ai_training_pairs
          WHERE embedding IS NOT NULL
            AND quality >= 0.5
          ORDER BY embedding <=> ${vectorLiteral}::vector
          LIMIT ${limit}
        `;

    return rows.map((r) => ({
      customerMessage: r.customer_message,
      staffResponse: r.human_edit ?? r.ai_draft ?? '',
    }));
  }

  private async topQualityExamples(
    intent: string | null,
    limit: number,
  ): Promise<{ customerMessage: string; staffResponse: string }[]> {
    const pairs = await this.prisma.aiTrainingPair.findMany({
      where: {
        quality: { gte: 0.7 },
        ...(intent ? { intent } : {}),
      },
      orderBy: { quality: 'desc' },
      take: limit,
      select: {
        customerMessage: true,
        aiDraft: true,
        humanEdit: true,
      },
    });

    return pairs.map((p) => ({
      customerMessage: p.customerMessage,
      staffResponse: p.humanEdit ?? p.aiDraft ?? '',
    }));
  }

  /**
   * Return aggregate statistics about the training dataset.
   */
  async getTrainingStats(): Promise<{
    total: number;
    usable: number;
    bySource: Record<string, number>;
    byType: Record<string, number>;
  }> {
    const [total, usable, bySources, byTypes] = await Promise.all([
      this.prisma.aiTrainingPair.count(),
      this.prisma.aiTrainingPair.count({ where: { quality: { gte: 0.7 } } }),
      this.prisma.aiTrainingPair.groupBy({
        by: ['source'],
        _count: { _all: true },
      }),
      this.prisma.aiTrainingPair.groupBy({
        by: ['type'],
        _count: { _all: true },
      }),
    ]);

    const bySource: Record<string, number> = {};
    for (const row of bySources) {
      bySource[row.source] = row._count._all;
    }

    const byType: Record<string, number> = {};
    for (const row of byTypes) {
      byType[row.type] = row._count._all;
    }

    return { total, usable, bySource, byType };
  }
}
