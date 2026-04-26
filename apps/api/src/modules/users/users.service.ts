import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

// Emails of service accounts used by scripts/migrations — hidden from the
// standard user list so they don't inflate headcount or clutter the UI.
const SYSTEM_USER_EMAILS = ['legacy-import@bestchoice.com'];

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 50) {
    page = Math.max(1, page);
    limit = Math.min(200, Math.max(1, limit));

    const select = {
      id: true,
      email: true,
      name: true,
      role: true,
      branchId: true,
      isActive: true,
      employeeId: true,
      nickname: true,
      phone: true,
      lineId: true,
      address: true,
      avatarUrl: true,
      startDate: true,
      nationalId: true,
      birthDate: true,
      lastLoginAt: true,
      createdAt: true,
      branch: { select: { id: true, name: true } },
    };

    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      email: { notIn: SYSTEM_USER_EMAILS },
    };

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing && !existing.deletedAt) throw new ConflictException('อีเมลนี้ถูกใช้แล้ว');

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        role: dto.role as UserRole,
        branchId: dto.branchId || null,
        employeeId: dto.employeeId || null,
        nickname: dto.nickname || null,
        phone: dto.phone || null,
        lineId: dto.lineId || null,
        address: dto.address || null,
        avatarUrl: dto.avatarUrl || null,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        nationalId: dto.nationalId || null,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        isActive: true,
        employeeId: true,
        nickname: true,
        phone: true,
        lineId: true,
        address: true,
        avatarUrl: true,
        startDate: true,
        branch: { select: { id: true, name: true } },
      },
    });
  }

  async getSavedSignature(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { savedSignature: true },
    });
    return user?.savedSignature || null;
  }

  async saveSignature(userId: string, signatureImage: string): Promise<{ success: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { savedSignature: signatureImage },
    });
    return { success: true };
  }

  async deleteSavedSignature(userId: string): Promise<{ success: boolean }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { savedSignature: null },
    });
    return { success: true };
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('ไม่พบผู้ใช้งาน');

    // T7-C7 — if this update deactivates the user (true → false transition
    // OR fresh deactivation request), revoke all of their refresh tokens so
    // their sessions don't live on for up to 7 days past the deactivation.
    const isNowBeingDeactivated =
      dto.isActive === false && user.isActive === true;

    const data: Prisma.UserUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role as UserRole;
    if (dto.branchId !== undefined) data.branchId = dto.branchId || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.password = await bcrypt.hash(dto.password, 10);
    if (dto.employeeId !== undefined) data.employeeId = dto.employeeId || null;
    if (dto.nickname !== undefined) data.nickname = dto.nickname || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.lineId !== undefined) data.lineId = dto.lineId || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl || null;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.nationalId !== undefined) data.nationalId = dto.nationalId || null;
    if (dto.birthDate !== undefined) data.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        branchId: true,
        isActive: true,
        employeeId: true,
        nickname: true,
        phone: true,
        lineId: true,
        address: true,
        avatarUrl: true,
        startDate: true,
        nationalId: true,
        birthDate: true,
        branch: { select: { id: true, name: true } },
      },
    });

    if (isNowBeingDeactivated) {
      // Revoke every live refresh token so the just-deactivated user cannot
      // continue to mint new access tokens from cookies already issued to
      // their browser. Best-effort: never block the user update itself.
      try {
        await this.prisma.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      } catch {
        // Intentionally swallowed — tokens will also be rejected by the
        // isActive check in the auth guard, so this is defence-in-depth.
      }
    }

    return updated;
  }

  async updateExtension(userId: string, extension: string | null | undefined): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId, deletedAt: null },
      data: { yeastarExtension: extension ?? null },
    });
  }
}
