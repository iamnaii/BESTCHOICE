import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaySolutionsService } from '../paysolutions/paysolutions.service';
import { CreatePlanDto } from './dto/create-plan.dto';

@Injectable()
export class ShopSavingPlanService {
  constructor(
    private prisma: PrismaService,
    private paysolutions: PaySolutionsService,
  ) {}

  async create(dto: CreatePlanDto, customerId: string) {
    if (dto.monthlyAmount * dto.durationMonths < dto.targetAmount) {
      throw new BadRequestException('ยอดออมรวมต้องไม่น้อยกว่าเป้าหมาย');
    }

    const now = new Date();
    const nextDue = new Date(now);
    nextDue.setMonth(nextDue.getMonth() + 1);

    const planNumber = this.generatePlanNumber(now);

    return this.prisma.savingPlan.create({
      data: {
        planNumber,
        customerId,
        targetProductId: dto.targetProductId,
        targetProductModel: dto.targetProductModel,
        targetAmount: dto.targetAmount,
        monthlyAmount: dto.monthlyAmount,
        durationMonths: dto.durationMonths,
        startedAt: now,
        nextPaymentDueAt: nextDue,
        status: 'ACTIVE',
      },
    });
  }

  async listMine(customerId: string) {
    return this.prisma.savingPlan.findMany({
      where: { customerId, deletedAt: null },
      include: { payments: { orderBy: { paidAt: 'desc' }, take: 20 } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string, customerId: string) {
    const plan = await this.prisma.savingPlan.findUnique({
      where: { id },
      include: { payments: { orderBy: { paidAt: 'desc' } } },
    });
    if (!plan || plan.customerId !== customerId || plan.deletedAt) {
      throw new NotFoundException('ไม่พบแผนออม');
    }
    return plan;
  }

  async createPaymentIntent(id: string, amount: number, customerId: string) {
    const plan = await this.get(id, customerId);
    if (plan.status !== 'ACTIVE') {
      throw new BadRequestException('แผนนี้ไม่เปิดรับชำระแล้ว');
    }
    const paysolutions = this.paysolutions as unknown as {
      createSavingPlanIntent: (input: {
        savingPlanId: string;
        amount: number;
        description: string;
      }) => Promise<{ paymentUrl: string; paymentLinkId: string }>;
    };
    return paysolutions.createSavingPlanIntent({
      savingPlanId: plan.id,
      amount,
      description: `ออมดาวน์ ${plan.planNumber}`,
    });
  }

  async cancel(id: string, customerId: string) {
    const plan = await this.get(id, customerId);
    if (plan.status !== 'ACTIVE') {
      throw new BadRequestException('ยกเลิกไม่ได้');
    }
    return this.prisma.savingPlan.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  async listDueReminders(now = new Date()) {
    const to = new Date(now.getTime() + 24 * 3600_000);
    return this.prisma.savingPlan.findMany({
      where: {
        status: 'ACTIVE',
        nextPaymentDueAt: {
          lte: to,
          gte: new Date(now.getTime() - 2 * 3600_000),
        },
        deletedAt: null,
      },
      include: { customer: { select: { lineId: true, name: true } } },
    });
  }

  private generatePlanNumber(now: Date): string {
    const yy = now.getFullYear().toString().slice(-2);
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const dd = now.getDate().toString().padStart(2, '0');
    const rnd = Math.floor(100 + Math.random() * 900);
    return `SV-${yy}${mm}${dd}-${rnd}`;
  }
}
