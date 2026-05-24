import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface CreateQuickReplyDto {
  label: string;
  type: 'POSTBACK' | 'URL' | 'MESSAGE';
  payload?: string;
  url?: string;
  message?: string;
}

@Injectable()
export class CannedResponseQuickReplyService {
  constructor(private prisma: PrismaService) {}

  async list(cannedResponseId: string) {
    return this.prisma.cannedResponseQuickReply.findMany({
      where: { cannedResponseId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async create(cannedResponseId: string, dto: CreateQuickReplyDto) {
    const count = await this.prisma.cannedResponseQuickReply.count({
      where: { cannedResponseId, deletedAt: null },
    });
    if (count >= 13) {
      throw new BadRequestException('สูงสุด 13 quick replies ต่อ template');
    }
    return this.prisma.cannedResponseQuickReply.create({
      data: { cannedResponseId, ...dto, sortOrder: count },
    });
  }

  async update(id: string, dto: Partial<CreateQuickReplyDto> & { sortOrder?: number }) {
    const existing = await this.prisma.cannedResponseQuickReply.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบ quick reply');
    return this.prisma.cannedResponseQuickReply.update({ where: { id }, data: dto });
  }

  async delete(id: string) {
    return this.prisma.cannedResponseQuickReply.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async reorder(items: Array<{ id: string; sortOrder: number }>) {
    if (items.length > 13) throw new BadRequestException('reorder รับสูงสุด 13 รายการ');
    await this.prisma.$transaction(
      items.map((i) =>
        this.prisma.cannedResponseQuickReply.update({
          where: { id: i.id },
          data: { sortOrder: i.sortOrder },
        }),
      ),
    );
    return { updated: items.length };
  }
}
