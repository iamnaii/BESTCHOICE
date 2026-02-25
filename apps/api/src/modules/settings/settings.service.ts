import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.systemConfig.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async update(key: string, value: string) {
    return this.prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async bulkUpdate(items: { key: string; value: string }[]) {
    const results: Awaited<ReturnType<typeof this.prisma.systemConfig.upsert>>[] = [];
    for (const item of items) {
      const result = await this.prisma.systemConfig.upsert({
        where: { key: item.key },
        update: { value: item.value },
        create: { key: item.key, value: item.value },
      });
      results.push(result);
    }
    return results;
  }
}
