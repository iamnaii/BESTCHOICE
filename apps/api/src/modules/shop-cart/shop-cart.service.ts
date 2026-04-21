import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CartItem {
  reservationId: string;
  productId: string;
  expiresAt: Date;
  secondsRemaining: number;
  product: {
    id: string;
    name: string;
    sellingPrice: number;
    gallery: string[];
    conditionGrade: string | null;
  };
}

@Injectable()
export class ShopCartService {
  constructor(private prisma: PrismaService) {}

  async listForSession(sessionId: string): Promise<CartItem[]> {
    const reservations = await this.prisma.productReservation.findMany({
      where: { sessionId, status: 'ACTIVE' },
      include: { product: true },
      orderBy: { reservedAt: 'desc' },
    });
    const now = Date.now();
    return reservations
      .filter((r) => r.expiresAt.getTime() > now)
      .map((r) => ({
        reservationId: r.id,
        productId: r.productId,
        expiresAt: r.expiresAt,
        secondsRemaining: Math.max(0, Math.floor((r.expiresAt.getTime() - now) / 1000)),
        product: {
          id: r.product.id,
          name: r.product.name,
          sellingPrice: Number(r.product.costPrice),
          gallery: r.product.gallery,
          conditionGrade: r.product.conditionGrade,
        },
      }));
  }

  async countForSession(sessionId: string): Promise<number> {
    const items = await this.listForSession(sessionId);
    return items.length;
  }
}
