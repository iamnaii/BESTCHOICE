import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

interface CreateBubbleDto {
  type: 'TEXT' | 'IMAGE' | 'STICKER' | 'CARD' | 'LOCATION' | 'VIDEO' | 'JSON';
  text?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  stickerPackageId?: string;
  stickerId?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  locationTitle?: string;
  json?: any;
  channels?: string[];
}

interface UpdateBubbleDto extends Partial<CreateBubbleDto> {
  sortOrder?: number;
}

@Injectable()
export class CannedResponseBubbleService {
  constructor(private prisma: PrismaService) {}

  async listBubbles(cannedResponseId: string) {
    return this.prisma.cannedResponseBubble.findMany({
      where: { cannedResponseId, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createBubble(cannedResponseId: string, dto: CreateBubbleDto) {
    const count = await this.prisma.cannedResponseBubble.count({
      where: { cannedResponseId, deletedAt: null },
    });
    if (count >= 5) {
      throw new BadRequestException('สูงสุด 5 bubbles ต่อ template');
    }
    return this.prisma.cannedResponseBubble.create({
      data: {
        cannedResponseId,
        type: dto.type,
        text: dto.text,
        mediaUrl: dto.mediaUrl,
        thumbnailUrl: dto.thumbnailUrl,
        stickerPackageId: dto.stickerPackageId,
        stickerId: dto.stickerId,
        latitude: dto.latitude,
        longitude: dto.longitude,
        address: dto.address,
        locationTitle: dto.locationTitle,
        json: dto.json,
        channels: dto.channels ?? [],
        sortOrder: count,
      },
    });
  }

  async updateBubble(id: string, dto: UpdateBubbleDto) {
    const existing = await this.prisma.cannedResponseBubble.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('ไม่พบ bubble');
    return this.prisma.cannedResponseBubble.update({
      where: { id },
      data: dto,
    });
  }

  async deleteBubble(id: string) {
    return this.prisma.cannedResponseBubble.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async reorderBubbles(items: Array<{ id: string; sortOrder: number }>) {
    if (items.length > 5) throw new BadRequestException('reorder รับสูงสุด 5 รายการ');
    await this.prisma.$transaction(
      items.map((i) =>
        this.prisma.cannedResponseBubble.update({
          where: { id: i.id },
          data: { sortOrder: i.sortOrder },
        }),
      ),
    );
    return { updated: items.length };
  }
}
