import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Prisma } from '@prisma/client';

@ApiTags('Receivable Recon')
@ApiBearerAuth('JWT')
@Controller('receivable-recon')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT')
export class ReceivableReconController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('history')
  async history(
    @Query('branchId') branchId?: string,
    @Query('days') daysQ?: string,
  ) {
    const days = Math.min(90, Math.max(1, daysQ ? Number(daysQ) : 30));
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - days);

    const where: Prisma.ReceivableReconLogWhereInput = { runDate: { gte: since } };
    if (branchId) where.branchId = branchId;

    return this.prisma.receivableReconLog.findMany({
      where,
      orderBy: [{ runDate: 'desc' }, { branchId: 'asc' }],
      include: { branch: { select: { id: true, name: true } } },
    });
  }

  @Get('latest')
  async latest() {
    // Most recent run per branch
    const rows = await this.prisma.receivableReconLog.findMany({
      orderBy: { runDate: 'desc' },
      take: 500,
      include: { branch: { select: { id: true, name: true } } },
    });
    // Dedupe — keep newest per branch
    const seen = new Set<string>();
    return rows.filter((r) => {
      const key = r.branchId ?? '__null__';
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
