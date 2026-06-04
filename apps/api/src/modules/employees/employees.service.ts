import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { ListEmployeesDto } from './dto/list-employees.dto';

type Actor = { userId?: string; ipAddress?: string; userAgent?: string };

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private maskNationalId(v: string | null): string | null {
    if (!v) return v;
    return '•••••••••' + v.slice(-4);
  }

  private userSelect = {
    id: true, name: true, nickname: true, employeeId: true,
    nationalId: true, startDate: true, branchId: true, isActive: true,
  };

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

  async list(dto: ListEmployeesDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 50;
    const where: Prisma.EmployeeProfileWhereInput = { deletedAt: null };
    if (dto.isActive === 'true') where.resignedDate = null;
    if (dto.search) {
      where.user = {
        OR: [
          { name: { contains: dto.search, mode: 'insensitive' } },
          { nickname: { contains: dto.search, mode: 'insensitive' } },
          { employeeId: { contains: dto.search, mode: 'insensitive' } },
        ],
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.employeeProfile.findMany({
        where,
        include: { user: { select: this.userSelect } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.employeeProfile.count({ where }),
    ]);
    const data = rows.map((r) => ({
      ...r,
      nationalId: this.maskNationalId(r.user.nationalId),
      user: { ...r.user, nationalId: this.maskNationalId(r.user.nationalId) },
    }));
    return { data, total, page, limit };
  }

  async findOne(id: string) {
    const profile = await this.prisma.employeeProfile.findFirst({
      where: { id, deletedAt: null },
      include: { user: { select: this.userSelect } },
    });
    if (!profile) throw new NotFoundException('ไม่พบทะเบียนพนักงาน');
    return profile; // full nationalId — endpoint is OWNER/ACCOUNTANT only
  }

  async update(id: string, dto: UpdateEmployeeDto, actor?: Actor) {
    await this.findOne(id); // 404 if missing/deleted
    const profile = await this.prisma.employeeProfile.update({
      where: { id },
      data: {
        position: dto.position,
        employmentType: dto.employmentType,
        baseSalary: dto.baseSalary != null ? new Prisma.Decimal(dto.baseSalary) : undefined,
        ssoEligible: dto.ssoEligible,
        bankName: dto.bankName,
        bankAccountNo: dto.bankAccountNo,
        taxIdOverride: dto.taxIdOverride,
        note: dto.note,
        resignedDate: dto.resignedDate ? new Date(dto.resignedDate) : undefined,
      },
    });
    await this.audit.log({
      userId: actor?.userId,
      action: 'EMPLOYEE_PROFILE_UPDATED',
      entity: 'employee_profile',
      entityId: id,
      newValue: dto as Record<string, unknown>,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return profile;
  }

  async remove(id: string, actor?: Actor) {
    await this.findOne(id);
    const profile = await this.prisma.employeeProfile.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: actor?.userId,
      action: 'EMPLOYEE_PROFILE_DELETED',
      entity: 'employee_profile',
      entityId: id,
      ipAddress: actor?.ipAddress,
      userAgent: actor?.userAgent,
    });
    return profile;
  }
}
