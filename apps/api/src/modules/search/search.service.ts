import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface SearchResult {
  contracts: {
    id: string;
    contractNumber: string;
    customerName: string;
    status: string;
  }[];
  customers: {
    id: string;
    name: string;
    phone: string | null;
  }[];
  imeis: {
    contractId: string;
    imei: string;
    contractNumber: string;
    customerName: string;
  }[];
  letterTrackings: {
    letterId: string;
    trackingNumber: string;
    contractId: string;
    contractNumber: string;
  }[];
}

interface UnionSearchParams {
  q: string;
  userId: string;
  userRole: string;
  branchId?: string;
}

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  /**
   * Normalize a phone-like query:
   * - preserve leading `+` (country code such as +66)
   * - strip all non-digit characters elsewhere
   */
  normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    const hasPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/\D/g, '');
    return hasPlus ? `+${digits}` : digits;
  }

  async unionSearch({
    q,
    userRole,
    branchId,
  }: UnionSearchParams): Promise<SearchResult> {
    const query = q.trim();
    if (query.length < 2) {
      return { contracts: [], customers: [], imeis: [], letterTrackings: [] };
    }

    const phoneNormalized = this.normalizePhone(query);
    const isSales = userRole === 'SALES';
    const branchFilter = isSales && branchId ? { branchId } : {};

    const [contracts, customers, letters, imeiProducts] = await Promise.all([
      this.prisma.contract.findMany({
        where: {
          deletedAt: null,
          ...branchFilter,
          OR: [
            { contractNumber: { contains: query, mode: 'insensitive' } },
            {
              customer: {
                name: { contains: query, mode: 'insensitive' },
              },
            },
            { customer: { phone: { contains: phoneNormalized } } },
          ],
        },
        select: {
          id: true,
          contractNumber: true,
          status: true,
          customer: { select: { name: true } },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { phone: { contains: phoneNormalized } },
          ],
        },
        select: { id: true, name: true, phone: true },
        take: 10,
      }),
      this.prisma.contractLetter.findMany({
        where: {
          deletedAt: null,
          trackingNumber: { contains: query, mode: 'insensitive' },
          ...(isSales && branchId ? { contract: { branchId } } : {}),
        },
        select: {
          id: true,
          trackingNumber: true,
          contractId: true,
          contract: { select: { contractNumber: true } },
        },
        take: 10,
      }),
      // IMEI search via Product.imeiSerial (joined to its active contract)
      this.prisma.product.findMany({
        where: {
          deletedAt: null,
          imeiSerial: { contains: query, mode: 'insensitive' },
          ...(isSales && branchId ? { branchId } : {}),
          contracts: { some: { deletedAt: null } },
        },
        select: {
          imeiSerial: true,
          contracts: {
            where: { deletedAt: null },
            select: {
              id: true,
              contractNumber: true,
              customer: { select: { name: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        take: 10,
      }),
    ]);

    const imeis: SearchResult['imeis'] = imeiProducts
      .filter((p) => p.imeiSerial && p.contracts.length > 0)
      .map((p) => {
        const c = p.contracts[0];
        return {
          contractId: c.id,
          imei: p.imeiSerial as string,
          contractNumber: c.contractNumber,
          customerName: c.customer?.name ?? '',
        };
      });

    return {
      contracts: contracts.map((c) => ({
        id: c.id,
        contractNumber: c.contractNumber,
        customerName: c.customer?.name ?? '',
        status: c.status,
      })),
      customers: customers.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
      })),
      imeis,
      letterTrackings: letters.map((l) => ({
        letterId: l.id,
        trackingNumber: l.trackingNumber ?? '',
        contractId: l.contractId,
        contractNumber: l.contract?.contractNumber ?? '',
      })),
    };
  }
}
