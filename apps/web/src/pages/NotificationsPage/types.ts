export interface NotificationLog {
  id: string;
  channel: string;
  recipient: string;
  subject: string | null;
  message: string;
  status: string;
  relatedId: string | null;
  errorMsg: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  eventType: string;
  channel: string;
  format?: string;
  subject: string | null;
  messageTemplate: string;
  flexTemplate?: string;
  description: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface LogStats {
  total: number;
  sent: number;
  failed: number;
  pending: number;
}

export const channelLabels: Record<string, string> = {
  LINE: 'LINE',
  SMS: 'SMS',
  IN_APP: 'ในระบบ',
};

export const statusLabels: Record<string, string> = {
  SENT: 'ส่งแล้ว',
  FAILED: 'ล้มเหลว',
  PENDING: 'รอส่ง',
};

export const statusColors: Record<string, string> = {
  SENT: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
};

export const eventTypeLabels: Record<string, string> = {
  PAYMENT_REMINDER: 'เตือนชำระ',
  OVERDUE_NOTICE: 'ทวงหนี้',
  PAYMENT_SUCCESS: 'ชำระสำเร็จ',
  CONTRACT_DEFAULT: 'ผิดนัด',
};

export const placeholdersList = [
  '{customer_name}', '{contract_number}', '{amount}', '{due_date}',
  '{installment_no}', '{late_fee}', '{branch_name}', '{overdue_days}',
];

export const defaultFlexTemplates: Record<string, object> = {
  PAYMENT_REMINDER: {
    type: 'flex',
    altText: 'แจ้งเตือน: ค่างวดที่ {installment_no} จำนวน {amount} บาท ครบกำหนด {due_date}',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1DB446', paddingAll: '20px', contents: [
        { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
        { type: 'text', text: 'แจ้งเตือนค่างวด', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
        { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'sm', contents: [
        { type: 'text', text: 'สวัสดีค่ะ คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', margin: 'lg', contents: [
          { type: 'text', text: 'ยอดชำระ', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{amount} บาท', size: 'xl', color: '#1DB446', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'separator', margin: 'lg', color: '#EEEEEE' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'งวดที่', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{installment_no}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'ครบกำหนด', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{due_date}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'text', text: 'กรุณาชำระเงินก่อนครบกำหนด เพื่อหลีกเลี่ยงค่าปรับ', size: 'xs', color: '#888888', wrap: true, margin: 'xl' },
      ]},
      footer: { type: 'box', layout: 'vertical', paddingAll: '15px', spacing: 'sm', contents: [
        { type: 'button', action: { type: 'postback', label: 'ชำระเงิน', data: 'action=pay&contract={contract_number}' }, style: 'primary', color: '#1DB446', height: 'sm' },
        { type: 'button', action: { type: 'postback', label: 'ดูรายละเอียด', data: 'action=check_installments&contract={contract_number}' }, style: 'primary', color: '#AAAAAA', height: 'sm' },
      ]},
    },
  },
  OVERDUE_NOTICE: {
    type: 'flex',
    altText: 'แจ้งเตือน: ค่างวดที่ {installment_no} ค้างชำระ {amount} บาท เลยกำหนด {overdue_days} วัน',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#DD2C00', paddingAll: '20px', contents: [
        { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
        { type: 'text', text: 'แจ้งเตือนค้างชำระ', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
        { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'sm', contents: [
        { type: 'text', text: 'คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', margin: 'lg', contents: [
          { type: 'text', text: 'ยอดค้างชำระ', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{amount} บาท', size: 'xl', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'separator', margin: 'lg', color: '#EEEEEE' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'งวดที่', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{installment_no}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'ค่าปรับ', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{late_fee} บาท', size: 'sm', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'เลยกำหนด', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{overdue_days} วัน', size: 'sm', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'text', text: 'กรุณาชำระโดยเร็วเพื่อหลีกเลี่ยงค่าปรับเพิ่มเติม', size: 'xs', color: '#888888', wrap: true, margin: 'xl' },
      ]},
      footer: { type: 'box', layout: 'vertical', paddingAll: '15px', spacing: 'sm', contents: [
        { type: 'button', action: { type: 'postback', label: 'ชำระเงินทันที', data: 'action=pay&contract={contract_number}' }, style: 'primary', color: '#DD2C00', height: 'sm' },
      ]},
    },
  },
  PAYMENT_SUCCESS: {
    type: 'flex',
    altText: 'ชำระเงินสำเร็จ: สัญญา {contract_number} งวดที่ {installment_no} จำนวน {amount} บาท',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#1DB446', paddingAll: '20px', contents: [
        { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
        { type: 'text', text: 'ชำระเงินสำเร็จ', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
        { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'sm', contents: [
        { type: 'text', text: 'คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', alignItems: 'center', margin: 'lg', contents: [
          { type: 'text', text: 'จำนวนเงิน', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{amount} บาท', size: 'xl', color: '#1DB446', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'separator', margin: 'lg', color: '#EEEEEE' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'งวดที่', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{installment_no}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'md', contents: [
          { type: 'text', text: 'วันที่ชำระ', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{due_date}', size: 'sm', color: '#333333', weight: 'bold', align: 'end', flex: 0 },
        ]},
        { type: 'text', text: 'ขอบคุณที่ชำระตรงเวลาค่ะ', size: 'xs', color: '#1DB446', wrap: true, margin: 'xl', weight: 'bold' },
      ]},
    },
  },
  CONTRACT_DEFAULT: {
    type: 'flex',
    altText: 'แจ้งเตือน: สัญญา {contract_number} มีสถานะผิดนัดชำระ',
    contents: {
      type: 'bubble', size: 'mega',
      header: { type: 'box', layout: 'vertical', backgroundColor: '#DD2C00', paddingAll: '20px', contents: [
        { type: 'text', text: 'BEST CHOICE', size: 'xs', color: '#FFFFFF', weight: 'bold' },
        { type: 'text', text: 'แจ้งเตือนผิดนัดชำระ', size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' },
        { type: 'text', text: 'สัญญา {contract_number}', size: 'xs', color: '#FFFFFFBB', margin: 'sm' },
      ]},
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', spacing: 'sm', contents: [
        { type: 'text', text: 'คุณ{customer_name}', size: 'md', color: '#333333', weight: 'bold' },
        { type: 'text', text: 'สัญญาของท่านอยู่ในสถานะผิดนัดชำระ กรุณาติดต่อเจ้าหน้าที่โดยเร็ว', size: 'sm', color: '#DD2C00', wrap: true, margin: 'lg' },
        { type: 'box', layout: 'horizontal', justifyContent: 'space-between', margin: 'lg', contents: [
          { type: 'text', text: 'ยอดค้างทั้งหมด', size: 'sm', color: '#888888', flex: 0 },
          { type: 'text', text: '{amount} บาท', size: 'xl', color: '#DD2C00', weight: 'bold', align: 'end', flex: 0 },
        ]},
      ]},
      footer: { type: 'box', layout: 'vertical', paddingAll: '15px', spacing: 'sm', contents: [
        { type: 'button', action: { type: 'postback', label: 'ติดต่อเจ้าหน้าที่', data: 'action=contact' }, style: 'primary', color: '#DD2C00', height: 'sm' },
      ]},
    },
  },
};
