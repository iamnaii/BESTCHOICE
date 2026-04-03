import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: port || 587,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
      this.logger.log(`SMTP transport configured (host: ${host})`);
    } else {
      this.logger.warn(
        'SMTP not configured — emails will be logged to console instead of sent. ' +
          'Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable.',
      );
    }
  }

  /**
   * Send a password reset email with a Thai-language HTML template.
   */
  async sendPasswordResetEmail(to: string, resetToken: string, userName: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;
    const from = this.configService.get<string>('SMTP_FROM', 'BESTCHOICE <noreply@bestchoice.com>');

    const subject = 'รีเซ็ตรหัสผ่าน BESTCHOICE';
    const html = this.buildPasswordResetHtml(userName, resetUrl);

    if (!this.transporter) {
      this.logger.warn('=== EMAIL NOT SENT (SMTP not configured) ===');
      this.logger.warn(`To: ${to}`);
      this.logger.warn(`Subject: ${subject}`);
      this.logger.warn(`Reset URL: ${resetUrl}`);
      this.logger.warn('=============================================');
      return;
    }

    try {
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Password reset email sent to ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send password reset email to ${to}: ${err}`);
    }
  }

  /**
   * Send an invite email with a Thai-language HTML template.
   */
  async sendInviteEmail(
    to: string,
    rawToken: string,
    inviterName: string,
    roleName: string,
    branchName: string | null,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const registerUrl = `${frontendUrl}/register?token=${rawToken}`;
    const from = this.configService.get<string>('SMTP_FROM', 'BESTCHOICE <noreply@bestchoice.com>');

    const subject = 'คุณได้รับเชิญเข้าใช้งานระบบ BESTCHOICE';
    const html = this.buildInviteHtml(inviterName, roleName, branchName, registerUrl);

    if (!this.transporter) {
      this.logger.warn('=== EMAIL NOT SENT (SMTP not configured) ===');
      this.logger.warn(`To: ${to}`);
      this.logger.warn(`Subject: ${subject}`);
      this.logger.warn(`Register URL: ${registerUrl}`);
      this.logger.warn('=============================================');
      return;
    }

    try {
      await this.transporter.sendMail({ from, to, subject, html });
      this.logger.log(`Invite email sent to ${to}`);
    } catch (err) {
      this.logger.error(`Failed to send invite email to ${to}: ${err}`);
    }
  }

  private buildInviteHtml(
    inviterName: string,
    roleName: string,
    branchName: string | null,
    registerUrl: string,
  ): string {
    const branchLine = branchName
      ? `<p style="margin:0 0 8px;color:#4b5563;font-size:16px;line-height:1.6;">สาขา: <strong>${branchName}</strong></p>`
      : '';

    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>เชิญเข้าใช้งาน BESTCHOICE</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#2563eb;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">BESTCHOICE</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#1f2937;font-size:20px;">คุณได้รับเชิญเข้าใช้งานระบบ</h2>
              <p style="margin:0 0 16px;color:#4b5563;font-size:16px;line-height:1.6;">
                คุณ${inviterName} เชิญคุณเข้าร่วมทีม BESTCHOICE
              </p>
              <p style="margin:0 0 8px;color:#4b5563;font-size:16px;line-height:1.6;">
                ตำแหน่ง: <strong>${roleName}</strong>
              </p>
              ${branchLine}
              <p style="margin:16px 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
                กรุณากดปุ่มด้านล่างเพื่อลงทะเบียนและตั้งรหัสผ่าน:
              </p>
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:6px;background-color:#2563eb;">
                    <a href="${registerUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">
                      ลงทะเบียน
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">
                ลิงก์นี้จะหมดอายุใน <strong>72 ชั่วโมง</strong> หากคุณไม่ได้รับเชิญ กรุณาเพิกเฉยอีเมลนี้
              </p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                หากปุ่มด้านบนไม่ทำงาน กรุณาคัดลอกลิงก์ด้านล่างไปวางในเบราว์เซอร์:<br>
                <a href="${registerUrl}" style="color:#2563eb;word-break:break-all;">${registerUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; BESTCHOICE &mdash; ระบบผ่อนชำระ
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildPasswordResetHtml(userName: string, resetUrl: string): string {
    return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>รีเซ็ตรหัสผ่าน BESTCHOICE</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background-color:#2563eb;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">BESTCHOICE</h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 16px;color:#1f2937;font-size:20px;">รีเซ็ตรหัสผ่าน</h2>
              <p style="margin:0 0 16px;color:#4b5563;font-size:16px;line-height:1.6;">
                สวัสดีคุณ${userName},
              </p>
              <p style="margin:0 0 24px;color:#4b5563;font-size:16px;line-height:1.6;">
                มีการร้องขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ กรุณากดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่:
              </p>
              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:6px;background-color:#2563eb;">
                    <a href="${resetUrl}" target="_blank" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">
                      รีเซ็ตรหัสผ่าน
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 16px;color:#6b7280;font-size:14px;line-height:1.6;">
                ลิงก์นี้จะหมดอายุใน <strong>15 นาที</strong> หากคุณไม่ได้ร้องขอรีเซ็ตรหัสผ่าน กรุณาเพิกเฉยอีเมลนี้ รหัสผ่านของคุณจะไม่ถูกเปลี่ยนแปลง
              </p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                หากปุ่มด้านบนไม่ทำงาน กรุณาคัดลอกลิงก์ด้านล่างไปวางในเบราว์เซอร์:<br>
                <a href="${resetUrl}" style="color:#2563eb;word-break:break-all;">${resetUrl}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color:#f9fafb;padding:24px 40px;text-align:center;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">
                &copy; BESTCHOICE &mdash; ระบบผ่อนชำระ
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }
}
