import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async search(query: string, limit = 5) {
    if (!query || query.trim().length === 0) {
      return { customers: [], contracts: [], products: [] };
    }

    const q = query.trim();

    const [customers, contracts, products] = await Promise.all([
      this.searchCustomers(q, limit),
      this.searchContracts(q, limit),
      this.searchProducts(q, limit),
    ]);

    return { customers, contracts, products };
  }

  private async searchCustomers(q: string, limit: number) {
    return this.prisma.customer.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { nationalId: { contains: q } },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
      },
      take: limit,
      orderBy: { name: 'asc' },
    });
  }

  private async searchContracts(q: string, limit: number) {
    const results = await this.prisma.contract.findMany({
      where: {
        deletedAt: null,
        OR: [
          { contractNumber: { contains: q, mode: 'insensitive' } },
          { customer: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      select: {
        id: true,
        contractNumber: true,
        status: true,
        customer: {
          select: { name: true },
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return results.map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      customerName: c.customer.name,
      status: c.status,
    }));
  }

  private async searchProducts(q: string, limit: number) {
    const results = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { imeiSerial: { contains: q, mode: 'insensitive' } },
          { serialNumber: { contains: q, mode: 'insensitive' } },
          { brand: { contains: q, mode: 'insensitive' } },
          { model: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        imeiSerial: true,
        category: true,
      },
      take: limit,
      orderBy: { name: 'asc' },
    });

    return results.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.imeiSerial || '',
      category: p.category,
    }));
  }
}
