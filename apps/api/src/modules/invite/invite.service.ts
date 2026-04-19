import {
  Injectable,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { RegisterInviteDto } from './dto/register-invite.dto';
import { UserRole } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class InviteService {
  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private configService: ConfigService,
  ) {}

  private hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  async create(dto: CreateInviteDto, invitedBy: string) {
    // Check if email already has an active user
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingUser && !existingUser.deletedAt) {
      throw new ConflictException('อีเมลนี้มีบัญชีอยู่แล้ว');
    }

    // Check for unexpired, unused invite for the same email
    const existingInvite = await this.prisma.inviteToken.findFirst({
      where: {
        email: dto.email,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (existingInvite) {
      throw new ConflictException('อีเมลนี้มีคำเชิญที่ยังไม่หมดอายุอยู่แล้ว');
    }

    // Generate raw token (goes in email link)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = this.hashToken(rawToken);
    // T7-C6: reduce validity 72h → 24h. Email + OTP combo means an invite is
    // two-channel; the longer the window open, the more chances a compromised
    // mailbox has to intercept both channels.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // T7-C6: second channel OTP — 6 digits, 15 min validity, bcrypt-hashed.
    // Sent via SMS to dto.phone (if provided). Older invites without phone
    // fall back to email-only (best for existing integration tests and
    // environments without SMS credentials).
    let rawOtp: string | null = null;
    let otpHash: string | null = null;
    let otpExpiresAt: Date | null = null;
    if (dto.phone) {
      rawOtp = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
      otpHash = await bcrypt.hash(rawOtp, 10);
      otpExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    }

    // Get inviter info for the email
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitedBy },
      select: { name: true },
    });

    // Get branch name if branchId provided
    let branchName: string | null = null;
    if (dto.branchId) {
      const branch = await this.prisma.branch.findUnique({
        where: { id: dto.branchId },
        select: { name: true, deletedAt: true },
      });
      branchName = (branch && !branch.deletedAt) ? branch.name : null;
    }

    const invite = await this.prisma.inviteToken.create({
      data: {
        token: hashedToken,
        email: dto.email,
        role: dto.role,
        branchId: dto.branchId || null,
        invitedBy,
        expiresAt,
        otpHash,
        otpExpiresAt,
        phone: dto.phone ?? null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
      },
    });

    // Consumed by controller: SMS the OTP separately (out of email channel).
    // Not returned in the response — callers (the controller) will read
    // `rawOtp` via a private field pattern if needed. For now we expose the
    // raw OTP on a throwaway property so the controller can hand it to SMS.
    (invite as typeof invite & { _rawOtp?: string })._rawOtp = rawOtp ?? undefined;

    // Build the invite URL with raw (unhashed) token
    const frontendUrl = this.configService.get<string>(
      'FRONTEND_URL',
      'http://localhost:5173',
    );
    const inviteUrl = `${frontendUrl}/register?token=${rawToken}`;

    // Send invite email
    const roleLabels: Record<string, string> = {
      OWNER: 'เจ้าของร้าน',
      BRANCH_MANAGER: 'ผู้จัดการสาขา',
      SALES: 'พนักงานขาย',
      ACCOUNTANT: 'ฝ่ายบัญชี',
      FINANCE_MANAGER: 'ผู้จัดการการเงิน',
    };

    await this.emailService.sendInviteEmail(
      dto.email,
      rawToken,
      inviter?.name || 'ผู้ดูแลระบบ',
      roleLabels[dto.role] || dto.role,
      branchName,
    );

    return { ...invite, inviteUrl };
  }

  async findAll(page = 1, limit = 20) {
    page = Math.max(1, page);
    limit = Math.min(100, Math.max(1, limit));

    const [data, total] = await Promise.all([
      this.prisma.inviteToken.findMany({
        select: {
          id: true,
          email: true,
          role: true,
          branchId: true,
          expiresAt: true,
          usedAt: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
          inviter: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.inviteToken.count(),
    ]);

    return { data, total, page, limit };
  }

  async resend(id: string, invitedBy: string) {
    const invite = await this.prisma.inviteToken.findUnique({ where: { id } });
    if (!invite) {
      throw new NotFoundException('ไม่พบคำเชิญ');
    }
    if (invite.usedAt) {
      throw new BadRequestException('คำเชิญนี้ถูกใช้แล้ว ไม่สามารถส่งซ้ำได้');
    }

    // Expire the old invite
    await this.prisma.inviteToken.update({
      where: { id },
      data: { expiresAt: new Date() },
    });

    // Create a new invite with the same details
    return this.create(
      {
        email: invite.email,
        role: invite.role,
        branchId: invite.branchId || undefined,
      },
      invitedBy,
    );
  }

  async revoke(id: string) {
    const invite = await this.prisma.inviteToken.findUnique({ where: { id } });
    if (!invite) {
      throw new NotFoundException('ไม่พบคำเชิญ');
    }
    if (invite.usedAt) {
      throw new BadRequestException('คำเชิญนี้ถูกใช้แล้ว ไม่สามารถยกเลิกได้');
    }

    // Soft-revoke by expiring it
    return this.prisma.inviteToken.update({
      where: { id },
      data: { expiresAt: new Date() },
      select: { id: true, email: true },
    });
  }

  async verify(rawToken: string) {
    const hashedToken = this.hashToken(rawToken);

    const invite = await this.prisma.inviteToken.findUnique({
      where: { token: hashedToken },
      include: {
        branch: { select: { name: true } },
      },
    });

    if (!invite || invite.usedAt || invite.expiresAt < new Date()) {
      return { valid: false };
    }

    return {
      valid: true,
      email: invite.email,
      role: invite.role,
      branchName: invite.branch?.name || null,
    };
  }

  async register(dto: RegisterInviteDto) {
    const hashedToken = this.hashToken(dto.token);

    const invite = await this.prisma.inviteToken.findUnique({
      where: { token: hashedToken },
    });

    if (!invite) {
      throw new BadRequestException('ลิงก์เชิญไม่ถูกต้อง');
    }
    if (invite.usedAt) {
      throw new BadRequestException('ลิงก์นี้ถูกใช้งานแล้ว');
    }
    if (invite.expiresAt < new Date()) {
      throw new BadRequestException('ลิงก์หมดอายุแล้ว');
    }

    // T7-C6: when an OTP was issued at invite time, the invitee must supply
    // it here alongside the link. 3 failed attempts → invite is burned.
    if (invite.otpHash) {
      if (!dto.otp) {
        throw new BadRequestException('กรุณากรอกรหัส OTP ที่ส่งไปทาง SMS');
      }
      if (invite.otpExpiresAt && invite.otpExpiresAt < new Date()) {
        throw new BadRequestException('รหัส OTP หมดอายุแล้ว กรุณาขอ invite ใหม่');
      }
      if (invite.otpAttempts >= 3) {
        throw new BadRequestException('ผิด OTP เกิน 3 ครั้ง กรุณาขอ invite ใหม่');
      }
      const ok = await bcrypt.compare(dto.otp, invite.otpHash);
      if (!ok) {
        await this.prisma.inviteToken.update({
          where: { id: invite.id },
          data: { otpAttempts: invite.otpAttempts + 1 },
        });
        throw new BadRequestException('รหัส OTP ไม่ถูกต้อง');
      }
    }

    // Check if email is already taken (race condition guard)
    const existingUser = await this.prisma.user.findUnique({
      where: { email: invite.email },
    });
    if (existingUser && !existingUser.deletedAt) {
      throw new ConflictException('อีเมลนี้มีบัญชีอยู่แล้ว');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    // Create user and mark invite as used in a transaction
    await this.prisma.$transaction([
      this.prisma.user.create({
        data: {
          email: invite.email,
          password: hashedPassword,
          name: dto.name,
          role: invite.role as UserRole,
          branchId: invite.branchId || null,
          phone: dto.phone || null,
          nickname: dto.nickname || null,
        },
      }),
      this.prisma.inviteToken.update({
        where: { id: invite.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'ลงทะเบียนสำเร็จ' };
  }
}
