import { domainAccessClient } from '../../employee-access/access-execution-context';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { SELL_EXCHANGE_BONUS_POLICY } from '@installment/shared';
import {
  CreateBuybackChoiceDto,
  CreateBuybackQuestionDto,
  UpdateBuybackChoiceDto,
  UpdateBuybackQuestionDto,
  UpdateSellConfigDto,
} from '../dto/buyback-question.dto';

/** CRUD แบบประเมิน buyback (แอดมิน) — soft delete เท่านั้น; public read อยู่ที่ shop-buyback */
@Injectable()
export class BuybackQuestionAdminService {

  private get prisma(): PrismaService { return domainAccessClient(this.basePrisma); }

  constructor(private readonly basePrisma: PrismaService) {}

  async list() {
    const questions = await this.prisma.buybackQuestion.findMany({
      where: { deletedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        choices: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });
    return { questions };
  }

  createQuestion(dto: CreateBuybackQuestionDto) {
    return this.prisma.buybackQuestion.create({
      data: {
        key: dto.key,
        title: dto.title,
        helpText: dto.helpText,
        selectType: dto.selectType,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateQuestion(id: string, dto: UpdateBuybackQuestionDto) {
    await this.mustFindQuestion(id);
    return this.prisma.buybackQuestion.update({ where: { id }, data: { ...dto } });
  }

  async deleteQuestion(id: string) {
    await this.mustFindQuestion(id);
    const now = new Date();
    return this.prisma.$transaction(async tx => {
      const choices = await tx.buybackChoice.updateMany({where:{questionId:id,deletedAt:null},data:{deletedAt:now}});
      const question = await tx.buybackQuestion.update({where:{id},data:{deletedAt:now}});
      return [choices,question];
    });
  }

  async createChoice(questionId: string, dto: CreateBuybackChoiceDto) {
    await this.mustFindQuestion(questionId);
    return this.prisma.buybackChoice.create({
      data: {
        questionId,
        label: dto.label,
        deductType: dto.deductType,
        deductValue: new Prisma.Decimal(dto.deductValue),
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateChoice(id: string, dto: UpdateBuybackChoiceDto) {
    const c = await this.prisma.buybackChoice.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('ไม่พบตัวเลือก');
    const { deductValue, ...rest } = dto;
    return this.prisma.buybackChoice.update({
      where: { id },
      data: {
        ...rest,
        ...(deductValue !== undefined ? { deductValue: new Prisma.Decimal(deductValue) } : {}),
      },
    });
  }

  async deleteChoice(id: string) {
    const c = await this.prisma.buybackChoice.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw new NotFoundException('ไม่พบตัวเลือก');
    return this.prisma.buybackChoice.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async getSellConfig() {
    return { exchangeBonusPct: 0, ...SELL_EXCHANGE_BONUS_POLICY };
  }

  async updateSellConfig(_dto: UpdateSellConfigDto) {
    throw new BadRequestException('โบนัสเทิร์นใช้เกณฑ์จำนวนเงิน 500 / 1,000 บาทแล้ว ไม่รองรับการตั้งเป็นเปอร์เซ็นต์');
  }

  private async mustFindQuestion(id: string) {
    const q = await this.prisma.buybackQuestion.findFirst({ where: { id, deletedAt: null } });
    if (!q) throw new NotFoundException('ไม่พบคำถาม');
    return q;
  }
}
