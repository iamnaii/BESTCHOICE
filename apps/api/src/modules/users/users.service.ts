import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { UserRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
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
        createdAt: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('อีเมลนี้ถูกใช้แล้ว');

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

    return this.prisma.user.update({
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
        branch: { select: { id: true, name: true } },
      },
    });
  }
}
