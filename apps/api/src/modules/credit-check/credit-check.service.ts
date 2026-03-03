import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCreditCheckDto, OverrideCreditCheckDto } from './dto/credit-check.dto';

@Injectable()
export class CreditCheckService {
  constructor(private prisma: PrismaService) {}

  async findByContract(contractId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { contractId },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
    return creditCheck;
  }

  // === Customer-level credit check (ไม่ต้องมีสัญญา) ===
  async findByCustomer(customerId: string) {
    return this.prisma.creditCheck.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        contract: { select: { id: true, contractNumber: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async findLatestByCustomer(customerId: string) {
    return this.prisma.creditCheck.findFirst({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async createForCustomer(customerId: string, dto: CreateCreditCheckDto, userId: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('ไม่พบลูกค้า');

    return this.prisma.creditCheck.create({
      data: {
        customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async analyzeForCustomer(creditCheckId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { id: creditCheckId },
      include: {
        contract: { select: { monthlyPayment: true, totalMonths: true, financedAmount: true } },
        customer: { select: { name: true, salary: true, occupation: true, occupationDetail: true } },
      },
    });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if (creditCheck.statementFiles.length === 0) {
      throw new BadRequestException('กรุณาอัปโหลด Statement ธนาคารก่อน');
    }

    const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;
    // If linked to a contract, use contract's monthly payment; otherwise estimate
    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;

    const aiAnalysis = await this.performAIAnalysis({
      bankName: creditCheck.bankName,
      statementMonths: creditCheck.statementMonths,
      statementFileCount: creditCheck.statementFiles.length,
      monthlyPayment,
      customerSalary,
      customerOccupation: creditCheck.customer.occupation,
    });

    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async overrideById(creditCheckId: string, dto: OverrideCreditCheckDto, userId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { id: creditCheckId } });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.creditCheck.update({
      where: { id: creditCheckId },
      data: {
        status: dto.status as any,
        reviewNotes: dto.reviewNotes,
        checkedById: userId,
        checkedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async create(contractId: string, dto: CreateCreditCheckDto, userId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { customer: true },
    });
    if (!contract) throw new NotFoundException('ไม่พบสัญญา');

    // Check if credit check already exists
    const existing = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (existing) {
      // Update existing
      return this.prisma.creditCheck.update({
        where: { contractId },
        data: {
          bankName: dto.bankName,
          statementFiles: dto.statementFiles,
          statementMonths: dto.statementMonths ?? 3,
          status: 'PENDING',
          aiAnalysis: Prisma.JsonNull,
          aiScore: null,
          aiSummary: null,
          aiRecommendation: null,
        },
        include: {
          customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
          checkedBy: { select: { id: true, name: true } },
        },
      });
    }

    return this.prisma.creditCheck.create({
      data: {
        contractId,
        customerId: contract.customerId,
        bankName: dto.bankName,
        statementFiles: dto.statementFiles,
        statementMonths: dto.statementMonths ?? 3,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  async analyze(contractId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({
      where: { contractId },
      include: {
        contract: {
          select: { monthlyPayment: true, totalMonths: true, financedAmount: true },
        },
        customer: {
          select: { name: true, salary: true, occupation: true, occupationDetail: true },
        },
      },
    });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    if (creditCheck.statementFiles.length === 0) {
      throw new BadRequestException('กรุณาอัปโหลด Statement ธนาคารก่อน');
    }

    const monthlyPayment = creditCheck.contract ? Number(creditCheck.contract.monthlyPayment) : 0;
    const customerSalary = creditCheck.customer.salary ? Number(creditCheck.customer.salary) : 0;

    const aiAnalysis = await this.performAIAnalysis({
      bankName: creditCheck.bankName,
      statementMonths: creditCheck.statementMonths,
      statementFileCount: creditCheck.statementFiles.length,
      monthlyPayment,
      customerSalary,
      customerOccupation: creditCheck.customer.occupation,
    });

    const updatedCheck = await this.prisma.creditCheck.update({
      where: { contractId },
      data: {
        aiAnalysis: aiAnalysis.analysis,
        aiScore: aiAnalysis.score,
        aiSummary: aiAnalysis.summary,
        aiRecommendation: aiAnalysis.recommendation,
        status: aiAnalysis.score >= 60 ? 'APPROVED' : aiAnalysis.score >= 40 ? 'MANUAL_REVIEW' : 'REJECTED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });

    return updatedCheck;
  }

  async override(contractId: string, dto: OverrideCreditCheckDto, userId: string) {
    const creditCheck = await this.prisma.creditCheck.findUnique({ where: { contractId } });
    if (!creditCheck) throw new NotFoundException('ไม่พบข้อมูลตรวจสอบเครดิต');

    const validStatuses = ['APPROVED', 'REJECTED', 'MANUAL_REVIEW'];
    if (!validStatuses.includes(dto.status)) {
      throw new BadRequestException('สถานะไม่ถูกต้อง');
    }

    return this.prisma.creditCheck.update({
      where: { contractId },
      data: {
        status: dto.status as any,
        reviewNotes: dto.reviewNotes,
        checkedById: userId,
        checkedAt: new Date(),
      },
      include: {
        customer: { select: { id: true, name: true, phone: true, salary: true, occupation: true } },
        checkedBy: { select: { id: true, name: true } },
      },
    });
  }

  private async performAIAnalysis(params: {
    bankName: string | null;
    statementMonths: number;
    statementFileCount: number;
    monthlyPayment: number;
    customerSalary: number;
    customerOccupation: string | null;
  }) {
    // TODO: Replace with actual Anthropic Claude API call
    // This is a rule-based simulation for now
    // In production, the bank statement images would be sent to Claude Vision API
    // with a structured prompt asking for financial analysis

    const { monthlyPayment, customerSalary } = params;

    let score = 50; // base score
    const riskFactors: string[] = [];
    const positiveFactors: string[] = [];

    // Salary-based analysis
    if (customerSalary > 0) {
      const affordabilityRatio = monthlyPayment / customerSalary;
      if (affordabilityRatio <= 0.2) {
        score += 30;
        positiveFactors.push('ค่างวดไม่เกิน 20% ของรายได้');
      } else if (affordabilityRatio <= 0.3) {
        score += 20;
        positiveFactors.push('ค่างวดไม่เกิน 30% ของรายได้');
      } else if (affordabilityRatio <= 0.4) {
        score += 10;
        riskFactors.push('ค่างวดเกิน 30% ของรายได้');
      } else {
        score -= 10;
        riskFactors.push('ค่างวดเกิน 40% ของรายได้ - ความเสี่ยงสูง');
      }
    } else {
      score -= 10;
      riskFactors.push('ไม่มีข้อมูลรายได้');
    }

    // Statement availability
    if (params.statementFileCount >= 3) {
      score += 10;
      positiveFactors.push('มี Statement ครบ 3 เดือน');
    } else if (params.statementFileCount >= 1) {
      score += 5;
      riskFactors.push('Statement ไม่ครบ 3 เดือน');
    }

    // Occupation
    if (params.customerOccupation) {
      score += 5;
      positiveFactors.push(`อาชีพ: ${params.customerOccupation}`);
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    const analysis = {
      monthlyIncome: customerSalary,
      monthlyPayment,
      affordabilityRatio: customerSalary > 0 ? Math.round((monthlyPayment / customerSalary) * 100) / 100 : null,
      riskFactors,
      positiveFactors,
      incomeConsistency: customerSalary > 0 ? 'มีรายได้' : 'ไม่มีข้อมูล',
    };

    let recommendation: string;
    if (score >= 70) {
      recommendation = 'แนะนำอนุมัติ - ลูกค้ามีความสามารถในการชำระเพียงพอ';
    } else if (score >= 50) {
      recommendation = 'พิจารณาเพิ่มเติม - ควรตรวจสอบข้อมูลเพิ่มเติม';
    } else {
      recommendation = 'ไม่แนะนำอนุมัติ - ความเสี่ยงสูง';
    }

    const summaryParts: string[] = [];
    if (customerSalary > 0) {
      summaryParts.push(`รายได้ ${customerSalary.toLocaleString()} บาท/เดือน`);
      summaryParts.push(`ค่างวด ${monthlyPayment.toLocaleString()} บาท/เดือน`);
      summaryParts.push(`สัดส่วน ${((monthlyPayment / customerSalary) * 100).toFixed(0)}% ของรายได้`);
    }
    if (positiveFactors.length > 0) summaryParts.push(`จุดแข็ง: ${positiveFactors.join(', ')}`);
    if (riskFactors.length > 0) summaryParts.push(`ความเสี่ยง: ${riskFactors.join(', ')}`);

    return {
      score,
      summary: summaryParts.join(' | '),
      recommendation,
      analysis,
    };
  }
}
