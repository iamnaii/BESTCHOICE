import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

type Actor = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async provision(dto: CreateEmployeeDto, actor?: Actor) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null },
    });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้ที่จะตั้งเป็นพนักงาน');

    try {
      const profile = await this.prisma.employeeProfile.create({
        data: {
          userId: dto.userId,
          position: dto.position,
          employmentType: dto.employmentType,
          baseSalary: dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : null,
          ssoEligible: dto.ssoEligible,
          bankName: dto.bankName,
          bankAccountNo: dto.bankAccountNo,
          taxIdOverride: dto.taxIdOverride,
          note: dto.note,
        },
      });
      await this.audit.log({
        userId: actor?.userId,
        action: 'EMPLOYEE_PROFILE_CREATED',
        entity: 'employee_profile',
        entityId: profile.id,
        newValue: { userId: dto.userId, position: dto.position },
        ipAddress: actor?.ipAddress,
        userAgent: actor?.userAgent,
      });
      return profile;
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') {
        throw new ConflictException('พนักงานคนนี้มีทะเบียนแล้ว');
      }
      throw e;
    }
  }
}
