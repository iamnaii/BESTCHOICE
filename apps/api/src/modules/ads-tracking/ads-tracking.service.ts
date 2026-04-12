import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdsPlatform, Prisma } from '@prisma/client';

@Injectable()
export class AdsTrackingService {
  private readonly logger = new Logger(AdsTrackingService.name);

  constructor(private prisma: PrismaService) {}

  // ─── Campaigns ─────────────────────────────────────────

  async createCampaign(data: {
    platform: AdsPlatform;
    campaignId: string;
    campaignName: string;
    adSetName?: string;
    adName?: string;
    budget?: number;
    startDate?: Date;
    endDate?: Date;
  }) {
    return this.prisma.adsCampaign.create({
      data: {
        platform: data.platform,
        campaignId: data.campaignId,
        campaignName: data.campaignName,
        adSetName: data.adSetName,
        adName: data.adName,
        budget: data.budget ? new Prisma.Decimal(data.budget) : undefined,
        startDate: data.startDate,
        endDate: data.endDate,
      },
    });
  }

  async listCampaigns(params: {
    platform?: AdsPlatform;
    isActive?: boolean;
    page?: number;
    limit?: number;
  }) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 50;
    const where: Prisma.AdsCampaignWhereInput = { deletedAt: null };
    if (params.platform) where.platform = params.platform;
    if (params.isActive !== undefined) where.isActive = params.isActive;

    const [data, total] = await this.prisma.$transaction([
      this.prisma.adsCampaign.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { _count: { select: { attributions: true } } },
      }),
      this.prisma.adsCampaign.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async updateCampaign(id: string, data: Partial<{
    campaignName: string;
    budget: number;
    isActive: boolean;
    endDate: Date;
  }>) {
    return this.prisma.adsCampaign.update({
      where: { id },
      data: {
        ...data,
        budget: data.budget !== undefined ? new Prisma.Decimal(data.budget) : undefined,
      },
    });
  }

  // ─── Attribution ───────────────────────────────────────

  async createAttribution(data: {
    campaignId: string;
    customerId?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    referrerUrl?: string;
  }) {
    return this.prisma.adsAttribution.create({
      data: {
        campaignId: data.campaignId,
        customerId: data.customerId,
        utmSource: data.utmSource,
        utmMedium: data.utmMedium,
        utmCampaign: data.utmCampaign,
        utmContent: data.utmContent,
        referrerUrl: data.referrerUrl,
        firstTouch: new Date(),
      },
    });
  }

  /** Link attribution to a contract (conversion event) */
  async markConversion(attributionId: string, contractId: string, revenue: number) {
    return this.prisma.adsAttribution.update({
      where: { id: attributionId },
      data: {
        contractId,
        revenue: new Prisma.Decimal(revenue),
        convertedAt: new Date(),
        lastTouch: new Date(),
      },
    });
  }

  // ─── ROI ───────────────────────────────────────────────

  async getROI(params: { platform?: AdsPlatform; startDate?: Date; endDate?: Date }) {
    const campaignWhere: Prisma.AdsCampaignWhereInput = { deletedAt: null };
    if (params.platform) campaignWhere.platform = params.platform;

    const campaigns = await this.prisma.adsCampaign.findMany({
      where: campaignWhere,
      include: {
        attributions: {
          where: {
            ...(params.startDate ? { firstTouch: { gte: params.startDate } } : {}),
            ...(params.endDate ? { firstTouch: { lte: params.endDate } } : {}),
          },
          select: { revenue: true, convertedAt: true },
        },
      },
    });

    return campaigns.map((c) => {
      const totalRevenue = c.attributions.reduce(
        (sum, a) => sum + (a.revenue ? Number(a.revenue) : 0),
        0,
      );
      const conversions = c.attributions.filter((a) => a.convertedAt).length;
      const spend = c.budget ? Number(c.budget) : 0;
      const roi = spend > 0 ? Math.round(((totalRevenue - spend) / spend) * 100) : 0;

      return {
        id: c.id,
        platform: c.platform,
        campaignName: c.campaignName,
        spend,
        totalRevenue,
        conversions,
        totalAttributions: c.attributions.length,
        roi,
      };
    });
  }
}
