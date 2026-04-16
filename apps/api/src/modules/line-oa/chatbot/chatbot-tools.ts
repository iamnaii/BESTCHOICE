/**
 * Tool definitions for context-aware chatbot (Claude Haiku tool use)
 */
export const CHATBOT_TOOLS = [
  {
    name: 'getContractSummary',
    description: 'ดึงข้อมูลสรุปสัญญาทั้งหมดของลูกค้า — ยอดคงเหลือ, งวดถัดไป, สถานะ',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'getPaymentHistory',
    description: 'ดึงประวัติการชำระเงิน 5 รายการล่าสุด',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'getNextPayment',
    description: 'ดึงข้อมูลงวดถัดไป — วันครบกำหนด, ยอดที่ต้องชำระ',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'getEarlyPayoff',
    description: 'คำนวณยอดปิดสัญญาก่อนกำหนด',
    input_schema: {
      type: 'object' as const,
      properties: {
        contractNumber: { type: 'string', description: 'เลขสัญญา (ถ้าลูกค้าระบุ)' },
      },
      required: [] as string[],
    },
  },
];

export type ChatbotToolName =
  | 'getContractSummary'
  | 'getPaymentHistory'
  | 'getNextPayment'
  | 'getEarlyPayoff';
