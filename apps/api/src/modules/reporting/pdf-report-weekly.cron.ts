import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import { PdfReportService } from './pdf-report.service';
import { EmailService } from '../email/email.service';

/**
 * Weekly collections analytics PDF — emailed every Monday 08:00 Bangkok
 * (= 01:00 UTC). Recipients pulled from SystemConfig key
 * `pdf_report_recipients` (comma-separated). Skips when no recipients.
 */
@Injectable()
export class PdfReportWeeklyCron {
  private readonly logger = new Logger(PdfReportWeeklyCron.name);

  constructor(
    private readonly pdfReport: PdfReportService,
    private readonly email: EmailService,
  ) {}

  @Cron('0 1 * * 1')
  async run(): Promise<{ sent: number; recipients: number }> {
    try {
      const recipients = await this.pdfReport.getRecipients();
      if (recipients.length === 0) {
        this.logger.log('pdf-report-weekly: no recipients configured — skipping');
        return { sent: 0, recipients: 0 };
      }

      const to = new Date();
      const from = new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);
      const pdf = await this.pdfReport.generate({ from, to });

      const subject = `BESTCHOICE Collections Weekly Report (${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)})`;
      const html = `<p>รายงานติดตามหนี้รายสัปดาห์ของ BESTCHOICE</p><p>ช่วงข้อมูล: ${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)}</p><p>ดูรายละเอียดใน PDF แนบ</p>`;

      const ok = await this.email.sendMail({
        to: recipients,
        subject,
        html,
        attachments: [
          {
            filename: `collections-weekly-${to.toISOString().slice(0, 10)}.pdf`,
            content: pdf,
            contentType: 'application/pdf',
          },
        ],
      });

      this.logger.log(
        `pdf-report-weekly: sent=${ok} recipients=${recipients.length} pdfBytes=${pdf.length}`,
      );
      return { sent: ok ? recipients.length : 0, recipients: recipients.length };
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'pdf-report-weekly' } });
      this.logger.error(`pdf-report-weekly failed: ${err instanceof Error ? err.message : err}`);
      return { sent: 0, recipients: 0 };
    }
  }
}
