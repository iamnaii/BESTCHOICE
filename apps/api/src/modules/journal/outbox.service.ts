import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface OutboxEventPayload {
  flowType: string;
  sourceId: string;
  sourceEntity: 'SHOP' | 'FINANCE';
  targetEntity: 'SHOP' | 'FINANCE';
  payload: Prisma.InputJsonValue;
  idempotencyKey: string;
}

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Enqueue a new outbox event. Call inside the source-entity TX so atomicity
   * holds: either both source JE + outbox row commit, or neither.
   *
   * @param tx — pass the active Prisma transaction client when inside `$transaction`
   */
  async enqueue(event: OutboxEventPayload, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    try {
      return await client.outboxEvent.create({
        data: {
          flowType: event.flowType,
          sourceId: event.sourceId,
          sourceEntity: event.sourceEntity,
          targetEntity: event.targetEntity,
          payload: event.payload,
          idempotencyKey: event.idempotencyKey,
          status: 'PENDING',
        },
      });
    } catch (err) {
      // Duplicate idempotencyKey → return existing (idempotent enqueue)
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.warn(
          `Idempotent enqueue — event with key ${event.idempotencyKey} already exists`,
        );
        return await client.outboxEvent.findUniqueOrThrow({
          where: { idempotencyKey: event.idempotencyKey },
        });
      }
      throw err;
    }
  }

  async findPending(limit = 50) {
    return this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', deletedAt: null, attempts: { lt: 5 } },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async findFailed() {
    return this.prisma.outboxEvent.findMany({
      where: { status: 'FAILED', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async markProcessing(id: string) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PROCESSING', attempts: { increment: 1 } },
    });
  }

  async markProcessed(id: string) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
  }

  async markFailed(id: string, error: string, isFinal: boolean) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: {
        status: isFinal ? 'FAILED' : 'PENDING',
        lastError: error.slice(0, 1000), // truncate to bound storage
      },
    });
  }

  /**
   * Manual retry from reconcile dashboard. Resets attempts so cron picks it up again.
   */
  async retry(id: string) {
    return this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, lastError: null },
    });
  }
}
