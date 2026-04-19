import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { InviteService } from './invite.service';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';

describe('InviteService.register — T7-C6 OTP guard', () => {
  let service: InviteService;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let prisma: any;

  const rawToken = 'a'.repeat(64);
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const inviteRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    token: tokenHash,
    email: 'new@test.com',
    role: 'SALES',
    branchId: null,
    invitedBy: 'u-admin',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    usedAt: null,
    otpHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    phone: null,
    ...overrides,
  });

  beforeEach(async () => {
    prisma = {
      inviteToken: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        InviteService,
        { provide: PrismaService, useValue: prisma },
        { provide: EmailService, useValue: { sendInviteEmail: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();
    service = mod.get(InviteService);
  });

  it('no-OTP invite still works (backward compat)', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(inviteRow());
    const result = await service.register({
      token: rawToken,
      password: 'password123',
      name: 'New Staff',
    });
    expect(result.message).toContain('ลงทะเบียนสำเร็จ');
  });

  it('OTP invite without otp in dto → BadRequest', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(
      inviteRow({
        otpHash: await bcrypt.hash('123456', 10),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        phone: '0891234567',
      }),
    );
    await expect(
      service.register({
        token: rawToken,
        password: 'password123',
        name: 'New Staff',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('OTP invite with wrong otp → increments attempts + BadRequest', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(
      inviteRow({
        otpHash: await bcrypt.hash('123456', 10),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        otpAttempts: 0,
      }),
    );
    await expect(
      service.register({
        token: rawToken,
        password: 'password123',
        name: 'New Staff',
        otp: '000000',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.inviteToken.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ otpAttempts: 1 }),
      }),
    );
  });

  it('OTP invite with correct otp → registers', async () => {
    const otp = '654321';
    prisma.inviteToken.findUnique.mockResolvedValue(
      inviteRow({
        otpHash: await bcrypt.hash(otp, 10),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      }),
    );
    const result = await service.register({
      token: rawToken,
      password: 'password123',
      name: 'New Staff',
      otp,
    });
    expect(result.message).toContain('ลงทะเบียนสำเร็จ');
  });

  it('OTP invite with expired OTP → BadRequest', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(
      inviteRow({
        otpHash: await bcrypt.hash('123456', 10),
        otpExpiresAt: new Date(Date.now() - 60 * 1000), // expired 1 min ago
      }),
    );
    await expect(
      service.register({
        token: rawToken,
        password: 'password123',
        name: 'New Staff',
        otp: '123456',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('OTP invite after 3 failed attempts → BadRequest (burned)', async () => {
    prisma.inviteToken.findUnique.mockResolvedValue(
      inviteRow({
        otpHash: await bcrypt.hash('123456', 10),
        otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        otpAttempts: 3,
      }),
    );
    await expect(
      service.register({
        token: rawToken,
        password: 'password123',
        name: 'New Staff',
        otp: '123456',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
