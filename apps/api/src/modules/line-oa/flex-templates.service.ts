import { Injectable } from '@nestjs/common';
import {
  FlexMessagePayload,
  FlexBubble,
  COLORS,
  GRADIENTS,
  createHeader,
  createDetailRow,
  createUriButton,
  wrapFlexMessage,
} from './flex-messages/base-template';

// ─── Param interfaces ───────────────────────────────────

export interface PaymentReceiptParams {
  contractNumber: string;
  installmentNo: number;
  totalInstallments: number;
  amount: number;
  date: string;
  receiptUrl?: string;
  contractUrl?: string;
}

export interface PaymentReminderParams {
  contractNumber: string;
  installmentNo: number;
  amount: number;
  dueDate: string;
  paymentUrl?: string;
}

export interface OverdueNoticeParams {
  contractNumber: string;
  overdueInstallments: number;
  totalAmount: number;
  lateFee: number;
  paymentUrl?: string;
}

export interface ProductCardParams {
  name: string;
  price: number;
  monthlyPayment?: number;
  imageUrl?: string;
  promoText?: string;
  detailUrl?: string;
}

export interface WelcomeGreetingParams {
  shopName?: string;
  liffUrl?: string;
}

// ─── Service ────────────────────────────────────────────

@Injectable()
export class FlexTemplatesService {
  /**
   * ใบเสร็จชำระเงิน — ส่งหลังลูกค้าชำระค่างวดสำเร็จ
   */
  paymentReceipt(params: PaymentReceiptParams): FlexMessagePayload {
    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'mega',
      header: createHeader(
        '✅ ชำระเงินสำเร็จ',
        `สัญญา ${params.contractNumber}`,
        GRADIENTS.GREEN,
      ),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.SUCCESS_LIGHT,
            cornerRadius: '12px',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: `฿${params.amount.toLocaleString()}`,
                size: 'xxl',
                color: COLORS.PRIMARY,
                weight: 'bold',
                align: 'center',
              },
              {
                type: 'text',
                text: 'ชำระเรียบร้อยแล้ว',
                size: 'xs',
                color: COLORS.MUTED,
                align: 'center',
                margin: 'sm',
              },
            ],
          },
          { type: 'separator', margin: 'lg', color: COLORS.BORDER },
          createDetailRow('สัญญา', params.contractNumber),
          createDetailRow('งวดที่', `${params.installmentNo}/${params.totalInstallments}`),
          createDetailRow('วันที่ชำระ', params.date),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '15px',
        spacing: 'sm',
        contents: [
          createUriButton('ดูใบเสร็จ', params.receiptUrl ?? '#', COLORS.PRIMARY),
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'uri', label: 'ดูสัญญา', uri: params.contractUrl ?? '#' },
          },
        ],
      },
    };

    return wrapFlexMessage(
      `ชำระเงินสำเร็จ สัญญา ${params.contractNumber} งวดที่ ${params.installmentNo} จำนวน ${params.amount.toLocaleString()} บาท`,
      bubble,
    );
  }

  /**
   * แจ้งเตือนค่างวด — ส่งก่อนถึงวันครบกำหนด
   */
  paymentReminder(params: PaymentReminderParams): FlexMessagePayload {
    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'mega',
      header: createHeader(
        '🔔 แจ้งเตือนค่างวด',
        `สัญญา ${params.contractNumber}`,
        GRADIENTS.ORANGE,
      ),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.WARNING_LIGHT,
            cornerRadius: '12px',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: `฿${params.amount.toLocaleString()}`,
                size: 'xxl',
                color: COLORS.WARNING,
                weight: 'bold',
                align: 'center',
              },
              {
                type: 'text',
                text: 'ยอดค่างวดที่ต้องชำระ',
                size: 'xs',
                color: COLORS.MUTED,
                align: 'center',
                margin: 'sm',
              },
            ],
          },
          { type: 'separator', margin: 'lg', color: COLORS.BORDER },
          createDetailRow('สัญญา', params.contractNumber),
          createDetailRow('งวดที่', `${params.installmentNo}`),
          createDetailRow('ครบกำหนด', params.dueDate),
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.WARNING_LIGHT,
            cornerRadius: '8px',
            paddingAll: '12px',
            margin: 'xl',
            contents: [
              {
                type: 'text',
                text: '💡 ชำระตรงเวลา หลีกเลี่ยงค่าปรับล่าช้า',
                size: 'xs',
                color: COLORS.WARNING,
                wrap: true,
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '15px',
        contents: [
          createUriButton('ชำระเงิน', params.paymentUrl ?? '#', COLORS.PRIMARY),
        ],
      },
    };

    return wrapFlexMessage(
      `แจ้งเตือนค่างวด สัญญา ${params.contractNumber} งวดที่ ${params.installmentNo} ครบกำหนด ${params.dueDate}`,
      bubble,
    );
  }

  /**
   * แจ้งเตือนค้างชำระ — ส่งเมื่อลูกค้าค้างงวด
   */
  overdueNotice(params: OverdueNoticeParams): FlexMessagePayload {
    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'mega',
      header: createHeader(
        '⚠️ แจ้งเตือนค้างชำระ',
        `สัญญา ${params.contractNumber}`,
        GRADIENTS.RED,
      ),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.DANGER_LIGHT,
            cornerRadius: '12px',
            paddingAll: '16px',
            contents: [
              {
                type: 'text',
                text: `฿${params.totalAmount.toLocaleString()}`,
                size: 'xxl',
                color: COLORS.DANGER,
                weight: 'bold',
                align: 'center',
              },
              {
                type: 'text',
                text: 'ยอดค้างชำระรวม',
                size: 'xs',
                color: COLORS.MUTED,
                align: 'center',
                margin: 'sm',
              },
            ],
          },
          { type: 'separator', margin: 'lg', color: COLORS.BORDER },
          createDetailRow('สัญญา', params.contractNumber),
          createDetailRow('งวดค้าง', `${params.overdueInstallments} งวด`),
          ...(params.lateFee > 0
            ? [createDetailRow('ค่าปรับล่าช้า', `+฿${params.lateFee.toLocaleString()}`, COLORS.DANGER)]
            : []),
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.DANGER_LIGHT,
            cornerRadius: '8px',
            paddingAll: '12px',
            margin: 'xl',
            contents: [
              {
                type: 'text',
                text: '⚠️ กรุณาชำระโดยเร็ว เพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม',
                size: 'xs',
                color: COLORS.DANGER,
                wrap: true,
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '15px',
        contents: [
          createUriButton('ชำระเงินทันที', params.paymentUrl ?? '#', COLORS.DANGER),
        ],
      },
    };

    return wrapFlexMessage(
      `แจ้งค้างชำระ สัญญา ${params.contractNumber} ${params.overdueInstallments} งวด ยอดรวม ${params.totalAmount.toLocaleString()} บาท`,
      bubble,
    );
  }

  /**
   * การ์ดสินค้า — ใช้ส่งแนะนำสินค้าใน campaign
   */
  productCard(params: ProductCardParams): FlexMessagePayload {
    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'mega',
      ...(params.imageUrl
        ? {
            hero: {
              type: 'image',
              url: params.imageUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            },
          }
        : {}),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: params.name,
            size: 'xl',
            weight: 'bold',
            color: COLORS.DARK,
            wrap: true,
          },
          {
            type: 'text',
            text: `฿${params.price.toLocaleString()}`,
            size: 'xxl',
            weight: 'bold',
            color: COLORS.DANGER,
            margin: 'md',
          },
          ...(params.monthlyPayment
            ? [
                {
                  type: 'text' as const,
                  text: `ผ่อนเริ่มต้น ฿${params.monthlyPayment.toLocaleString()}/เดือน`,
                  size: 'sm',
                  color: COLORS.PRIMARY,
                  margin: 'sm',
                },
              ]
            : []),
          ...(params.promoText
            ? [
                {
                  type: 'box' as const,
                  layout: 'vertical' as const,
                  backgroundColor: COLORS.SUCCESS_LIGHT,
                  cornerRadius: '8px',
                  paddingAll: '10px',
                  margin: 'md',
                  contents: [
                    {
                      type: 'text' as const,
                      text: params.promoText,
                      size: 'xs',
                      color: COLORS.PRIMARY,
                      wrap: true,
                    },
                  ],
                },
              ]
            : []),
        ],
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        paddingAll: '15px',
        spacing: 'sm',
        contents: [
          createUriButton('ดูรายละเอียด', params.detailUrl ?? '#', COLORS.INFO),
          createUriButton('สนใจผ่อน', params.detailUrl ?? '#', COLORS.PRIMARY),
        ],
      },
    };

    return wrapFlexMessage(
      `${params.name} ราคา ฿${params.price.toLocaleString()}${params.monthlyPayment ? ` ผ่อน ฿${params.monthlyPayment.toLocaleString()}/เดือน` : ''}`,
      bubble,
    );
  }

  /**
   * ข้อความต้อนรับ — ส่งเมื่อลูกค้าติดตาม LINE OA ครั้งแรก
   */
  welcomeGreeting(params: WelcomeGreetingParams): FlexMessagePayload {
    const shop = params.shopName ?? 'BEST CHOICE';
    const liffUrl = params.liffUrl ?? '#';

    const bubble: FlexBubble = {
      type: 'bubble',
      size: 'mega',
      header: createHeader('🎉 ยินดีต้อนรับ', shop, GRADIENTS.GREEN),
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '20px',
        spacing: 'sm',
        contents: [
          {
            type: 'text',
            text: `ยินดีต้อนรับสู่ ${shop} ค่ะ`,
            size: 'lg',
            weight: 'bold',
            color: COLORS.DARK,
            wrap: true,
          },
          {
            type: 'text',
            text: 'เราให้บริการขายมือถือใหม่และมือสอง พร้อมบริการผ่อนชำระที่สะดวกสบาย ดอกเบี้ยพิเศษ',
            size: 'sm',
            color: COLORS.MUTED,
            wrap: true,
            margin: 'md',
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: COLORS.SUCCESS_LIGHT,
            cornerRadius: '8px',
            paddingAll: '12px',
            margin: 'xl',
            contents: [
              {
                type: 'text',
                text: '✨ สิทธิพิเศษสมาชิก LINE OA: รับแจ้งเตือนค่างวด ดูประวัติการชำระ และโปรโมชั่นก่อนใคร',
                size: 'xs',
                color: COLORS.PRIMARY,
                wrap: true,
              },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '15px',
        spacing: 'sm',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
              createUriButton('ดูสินค้า', liffUrl, COLORS.PRIMARY),
              createUriButton('โปรโมชัน', liffUrl, COLORS.INFO),
            ],
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            margin: 'sm',
            action: { type: 'message', label: 'คุยกับเรา', text: 'สวัสดี' },
          },
        ],
      },
    };

    return wrapFlexMessage(`ยินดีต้อนรับสู่ ${shop} ค่ะ`, bubble);
  }
}
