import {
  Injectable,
  Logger,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * D1.3.1.3 — Email provider abstraction.
 *
 * SystemConfig key `email_provider` (whitelisted `'smtp'`/`'sendgrid'`,
 * default `'smtp'` — most installations already have SMTP env vars).
 *
 * The factory `getProvider()` reads the SystemConfig at call time and
 * returns the appropriate implementation. Today only `SmtpEmailProvider`
 * has working delivery; the Sendgrid path throws NotImplementedException
 * with a Thai-language hint so owner sees a clear actionable error.
 *
 * Q5-gated: owner can flip the SystemConfig row when ready to switch
 * providers — but Sendgrid path needs API key wiring first.
 *
 * Result shape: `{ sent: boolean, skipped?: boolean }`. `sent=true` means
 * SMTP successfully transmitted. `skipped=true` is a non-fatal "no
 * transport configured" outcome — callers (e.g. submit-for-approval)
 * should NOT crash on a missing provider; the inbox simply won't get the
 * email. The existing EmailService at apps/api/src/modules/email/ uses
 * the same fallback semantics (logger.warn + return false).
 */

export type EmailSendResult = { sent: boolean; skipped?: boolean };

export type SendArgs = {
  to: string | string[];
  subject: string;
  html: string;
};

/**
 * Interface every concrete provider must implement. New providers (e.g.
 * AWS SES) should land here as their own class + factory branch.
 */
export interface IEmailProvider {
  readonly providerName: 'smtp' | 'sendgrid';
  send(args: SendArgs): Promise<EmailSendResult>;
}

@Injectable()
export class SmtpEmailProvider implements IEmailProvider {
  readonly providerName = 'smtp' as const;
  private readonly logger = new Logger(SmtpEmailProvider.name);

  constructor(private configService: ConfigService) {}

  async send(args: SendArgs): Promise<EmailSendResult> {
    const host = this.configService.get<string>('SMTP_HOST') || '';
    const port = parseInt(this.configService.get<string>('SMTP_PORT') || '587', 10);
    const user = this.configService.get<string>('SMTP_USER') || '';
    const pass = this.configService.get<string>('SMTP_PASS') || '';
    const from =
      this.configService.get<string>('SMTP_FROM') ||
      'BESTCHOICE <noreply@bestchoice.com>';

    if (!host || !user || !pass) {
      this.logger.warn(
        `SMTP env not configured — skipping email (subject="${args.subject}")`,
      );
      return { sent: false, skipped: true };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });

    try {
      await transporter.sendMail({
        from,
        to: Array.isArray(args.to) ? args.to.join(',') : args.to,
        subject: args.subject,
        html: args.html,
      });
      this.logger.log(`Email sent via SMTP (subject="${args.subject}")`);
      return { sent: true };
    } catch (err) {
      this.logger.error(`SMTP send failed (subject="${args.subject}"): ${err}`);
      return { sent: false };
    }
  }
}

@Injectable()
export class SendgridEmailProvider implements IEmailProvider {
  readonly providerName = 'sendgrid' as const;

  async send(_args: SendArgs): Promise<EmailSendResult> {
    // D1.3.1.3 — Sendgrid stub. Owner must wire SENDGRID_API_KEY (or
    // equivalent) before flipping `email_provider = 'sendgrid'`. We throw
    // a clearly-actionable error rather than silently dropping mail.
    throw new NotImplementedException(
      'Sendgrid email provider not configured — owner must wire SENDGRID_API_KEY first',
    );
  }
}

@Injectable()
export class EmailProviderService {
  private readonly logger = new Logger(EmailProviderService.name);

  constructor(
    private prisma: PrismaService,
    private smtp: SmtpEmailProvider,
    private sendgrid: SendgridEmailProvider,
  ) {}

  /**
   * Resolve the currently-active provider. Reads SystemConfig at call
   * time so the operator can flip the row without restarting the API.
   * Unknown/missing values default to SMTP (conservative — matches the
   * pre-existing single-provider behavior of `EmailService`).
   */
  async getProvider(): Promise<IEmailProvider> {
    const name = await this.resolveProviderName();
    if (name === 'sendgrid') return this.sendgrid;
    return this.smtp;
  }

  /**
   * Internal: returns the whitelisted provider name. Default 'smtp'.
   */
  async resolveProviderName(): Promise<'smtp' | 'sendgrid'> {
    try {
      const row = await this.prisma.systemConfig.findFirst({
        where: { key: 'email_provider', deletedAt: null },
        select: { value: true },
      });
      const raw = row?.value?.trim();
      if (raw === 'sendgrid') return 'sendgrid';
      return 'smtp';
    } catch {
      return 'smtp';
    }
  }

  /**
   * Convenience wrapper — most callers can use this directly. Returns
   * `{ skipped: true }` when the resolved provider has no working
   * transport (e.g. SMTP env missing). Callers should NOT crash on this
   * outcome — log it, decide whether the notification can be retried,
   * and move on.
   */
  async send(args: SendArgs): Promise<EmailSendResult> {
    const provider = await this.getProvider();
    return provider.send(args);
  }
}
