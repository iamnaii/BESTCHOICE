import { NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmailProviderService,
  SmtpEmailProvider,
  SendgridEmailProvider,
} from './email-provider.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.3.1.3 — Email provider abstraction tests.
 *
 * - Factory picks SMTP by default (current conservative behavior).
 * - Factory picks Sendgrid when SystemConfig says so.
 * - Sendgrid throws NotImplementedException (stub) — call site must
 *   catch this and surface the actionable error.
 * - SMTP send without env vars gracefully returns `{ skipped: true }`.
 * - DB error → default fallback (smtp).
 * - Invalid SystemConfig value → smtp default.
 */
describe('EmailProviderService factory', () => {
  let prisma: { systemConfig: { findFirst: jest.Mock } };
  let smtp: SmtpEmailProvider;
  let sendgrid: SendgridEmailProvider;
  let service: EmailProviderService;

  beforeEach(() => {
    prisma = { systemConfig: { findFirst: jest.fn() } };
    const config = {
      get: jest.fn(() => undefined),
    } as unknown as ConfigService;
    smtp = new SmtpEmailProvider(config);
    sendgrid = new SendgridEmailProvider();
    service = new EmailProviderService(
      prisma as unknown as PrismaService,
      smtp,
      sendgrid,
    );
  });

  it('factory defaults to SMTP when SystemConfig row missing', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    const provider = await service.getProvider();
    expect(provider.providerName).toBe('smtp');
  });

  it('factory picks Sendgrid when SystemConfig value = "sendgrid"', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'sendgrid' });
    const provider = await service.getProvider();
    expect(provider.providerName).toBe('sendgrid');
  });

  it('factory falls back to SMTP for invalid SystemConfig value', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue({ value: 'mailgun' });
    const provider = await service.getProvider();
    expect(provider.providerName).toBe('smtp');
  });

  it('factory falls back to SMTP on DB error', async () => {
    prisma.systemConfig.findFirst.mockRejectedValue(new Error('db down'));
    const provider = await service.getProvider();
    expect(provider.providerName).toBe('smtp');
  });

  it('Sendgrid send throws NotImplementedException with actionable Thai-friendly hint', async () => {
    await expect(
      sendgrid.send({ to: 'a@x.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toBeInstanceOf(NotImplementedException);
  });

  it('SMTP send returns {sent:false, skipped:true} when env vars missing — does not crash', async () => {
    const result = await smtp.send({ to: 'a@x.com', subject: 's', html: '<p>x</p>' });
    expect(result).toEqual({ sent: false, skipped: true });
  });

  it('service.send() routes through the resolved provider', async () => {
    prisma.systemConfig.findFirst.mockResolvedValue(null);
    const result = await service.send({ to: 'a@x.com', subject: 's', html: '<p>x</p>' });
    // SMTP env not configured → skipped non-fatally
    expect(result).toEqual({ sent: false, skipped: true });
  });
});
