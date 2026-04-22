import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type AiSettingsUpdate = Partial<{
  salesBotMode: string;
  serviceBotMode: string;
  salesBotConfidenceThreshold: number;
  serviceBotConfidenceThreshold: number;
}>;

@Injectable()
export class AiSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get() {
    return this.prisma.aiSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
  }

  async update(data: AiSettingsUpdate, userId: string) {
    // Ensure singleton row exists before update
    await this.prisma.aiSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton' },
      update: {},
    });
    return this.prisma.aiSettings.update({
      where: { id: 'singleton' },
      data: { ...data, updatedById: userId },
    });
  }
}
