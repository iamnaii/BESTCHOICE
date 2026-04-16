import { Injectable } from '@nestjs/common';

/**
 * Facebook Template builder — converts business data into Facebook Messenger
 * template payloads (Generic, Button, Media).
 *
 * Equivalent of LINE Flex Messages but using Facebook's template format.
 * https://developers.facebook.com/docs/messenger-platform/send-messages/template/generic
 *
 * Each method returns a templatePayload object ready for OutboundMessage.templatePayload.
 */
@Injectable()
export class FacebookTemplateService {
  /**
   * Balance summary — shows contract balance as a Generic Template card.
   * LINE equivalent: balance-summary.flex.ts
   */
  balanceSummary(data: {
    contractNumber: string;
    totalInstallments: number;
    paidInstallments: number;
    nextDueDate: string | null;
    nextAmountDue: number;
    totalOutstanding: number;
    status: string;
    paymentUrl?: string;
  }): Record<string, unknown> {
    const isOverdue = data.status === 'OVERDUE' || data.status === 'DEFAULT';
    const statusText = isOverdue ? '⚠️ ค้างชำระ' : '✅ ปกติ';

    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `สรุปยอดสัญญา ${data.contractNumber}`,
            subtitle: [
              `สถานะ: ${statusText}`,
              `ยอดคงเหลือ: ฿${this.formatNumber(data.totalOutstanding)}`,
              `ชำระแล้ว: ${data.paidInstallments}/${data.totalInstallments} งวด`,
              data.nextDueDate
                ? `งวดถัดไป: ${data.nextDueDate} — ฿${this.formatNumber(data.nextAmountDue)}`
                : 'ชำระครบแล้ว',
            ].join('\n'),
            buttons: [
              ...(data.paymentUrl
                ? [{ type: 'web_url', url: data.paymentUrl, title: 'ชำระเงิน' }]
                : [{ type: 'postback', title: 'ชำระเงิน', payload: 'ชำระ' }]),
              { type: 'postback', title: 'ดูรายละเอียด', payload: `ดูสัญญา ${data.contractNumber}` },
            ],
          },
        ],
      },
    };
  }

  /**
   * Payment reminder — shows upcoming due date as a Button Template.
   * LINE equivalent: payment-reminder.flex.ts
   */
  paymentReminder(data: {
    contractNumber: string;
    installmentNo: number;
    totalInstallments: number;
    amountDue: number;
    dueDate: string;
    daysUntilDue: number;
    paymentUrl?: string;
  }): Record<string, unknown> {
    const urgency =
      data.daysUntilDue === 0
        ? '🔴 วันนี้!'
        : data.daysUntilDue === 1
        ? '🟠 พรุ่งนี้'
        : `🟢 อีก ${data.daysUntilDue} วัน`;

    return {
      type: 'template',
      payload: {
        template_type: 'button',
        text: [
          `📋 แจ้งเตือนค่างวด ${urgency}`,
          `สัญญา: ${data.contractNumber}`,
          `งวดที่: ${data.installmentNo}/${data.totalInstallments}`,
          `ยอดชำระ: ฿${this.formatNumber(data.amountDue)}`,
          `ครบกำหนด: ${data.dueDate}`,
        ].join('\n'),
        buttons: [
          data.paymentUrl
            ? { type: 'web_url', url: data.paymentUrl, title: 'ชำระเงิน' }
            : { type: 'postback', title: 'ชำระเงิน', payload: 'ชำระ' },
          { type: 'postback', title: 'ดูรายละเอียด', payload: `ดูสัญญา ${data.contractNumber}` },
        ],
      },
    };
  }

  /**
   * Overdue notice — shows overdue amount as a Button Template.
   * LINE equivalent: overdue-notice.flex.ts
   */
  overdueNotice(data: {
    contractNumber: string;
    totalOverdue: number;
    lateFee: number;
    daysOverdue: number;
    paymentUrl?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'button',
        text: [
          `⚠️ แจ้งเตือนค้างชำระ`,
          `สัญญา: ${data.contractNumber}`,
          `ค้างชำระ: ฿${this.formatNumber(data.totalOverdue)}`,
          `ค่าปรับล่าช้า: ฿${this.formatNumber(data.lateFee)}`,
          `เลยกำหนด: ${data.daysOverdue} วัน`,
        ].join('\n'),
        buttons: [
          data.paymentUrl
            ? { type: 'web_url', url: data.paymentUrl, title: 'ชำระเงินตอนนี้' }
            : { type: 'postback', title: 'ชำระเงินตอนนี้', payload: 'ชำระ' },
          { type: 'postback', title: 'คุยกับพนักงาน', payload: 'คุยกับพนักงาน' },
        ],
      },
    };
  }

  /**
   * Payment success — confirmation card after payment.
   * LINE equivalent: payment-success.flex.ts
   */
  paymentSuccess(data: {
    contractNumber: string;
    amountPaid: number;
    method: string;
    remainingInstallments: number;
    receiptNo?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: '✅ ชำระเงินสำเร็จ',
            subtitle: [
              `สัญญา: ${data.contractNumber}`,
              `จำนวน: ฿${this.formatNumber(data.amountPaid)}`,
              `ช่องทาง: ${data.method}`,
              `งวดคงเหลือ: ${data.remainingInstallments} งวด`,
              data.receiptNo ? `เลขที่ใบเสร็จ: ${data.receiptNo}` : '',
            ]
              .filter(Boolean)
              .join('\n'),
            buttons: [
              { type: 'postback', title: 'ดูใบเสร็จ', payload: 'ดูใบเสร็จ' },
              { type: 'postback', title: 'ดูยอดคงเหลือ', payload: 'ดูยอดคงเหลือ' },
            ],
          },
        ],
      },
    };
  }

  /**
   * Receipt — payment receipt card.
   * LINE equivalent: receipt.flex.ts
   */
  receipt(data: {
    receiptNo: string;
    customerName: string;
    amountPaid: number;
    method: string;
    paidDate: string;
    remainingBalance: number;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `🧾 ใบเสร็จ #${data.receiptNo}`,
            subtitle: [
              `ลูกค้า: ${data.customerName}`,
              `จำนวน: ฿${this.formatNumber(data.amountPaid)}`,
              `ช่องทาง: ${data.method}`,
              `วันที่: ${data.paidDate}`,
              `ยอดคงเหลือ: ฿${this.formatNumber(data.remainingBalance)}`,
            ].join('\n'),
            buttons: [
              { type: 'postback', title: 'ดูยอดคงเหลือ', payload: 'ดูยอดคงเหลือ' },
            ],
          },
        ],
      },
    };
  }

  /**
   * PromptPay QR — shows QR code image with payment link.
   * LINE equivalent: promptpay-qr.flex.ts
   */
  promptpayQr(data: {
    qrImageUrl: string;
    amount: number;
    paymentUrl?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `💳 สแกนจ่าย ฿${this.formatNumber(data.amount)}`,
            subtitle: 'สแกน QR Code เพื่อชำระเงินผ่าน PromptPay',
            image_url: data.qrImageUrl,
            buttons: data.paymentUrl
              ? [{ type: 'web_url', url: data.paymentUrl, title: 'ชำระผ่านลิงก์' }]
              : [{ type: 'postback', title: 'ยืนยันการชำระ', payload: 'ยืนยันชำระ' }],
          },
        ],
      },
    };
  }

  /**
   * Contract signed — new contract confirmation card.
   * LINE equivalent: contract-signed.flex.ts
   */
  contractSigned(data: {
    contractNumber: string;
    productName: string;
    monthlyPayment: number;
    totalMonths: number;
    downloadUrl?: string;
  }): Record<string, unknown> {
    return {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: `📄 สัญญาเช่าซื้อ ${data.contractNumber}`,
            subtitle: [
              `สินค้า: ${data.productName}`,
              `ค่างวด: ฿${this.formatNumber(data.monthlyPayment)}/เดือน`,
              `จำนวน: ${data.totalMonths} งวด`,
            ].join('\n'),
            buttons: [
              ...(data.downloadUrl
                ? [{ type: 'web_url', url: data.downloadUrl, title: 'ดาวน์โหลดสัญญา' }]
                : []),
              { type: 'postback', title: 'เช็คยอด', payload: 'เช็คยอด' },
            ],
          },
        ],
      },
    };
  }

  private formatNumber(n: number): string {
    return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
