export const CREDIT_MESSAGE_MIME = 'application/x-bestchoice-credit-message';
export const CREDIT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.gif,.webp';

export interface StatementResult {
  affordablePayment?: number | null;
  monthlyIncome?: number | null;
  monthlyExpense?: number | null;
  averageBalance?: number | null;
  totalIncome?: number | null;
  totalExpense?: number | null;
  balance?: number | null;
  bankName?: string | null;
  accountName?: string | null;
  dateRange?: string | null;
  incomeConsistency?: string | null;
  positiveFactors?: string[];
  riskFactors?: string[];
  [key: string]: unknown;
}

export const hasAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export function creditHeadline(result: StatementResult): { label: string; amount: number } | null {
  if (hasAmount(result.affordablePayment))
    return { label: 'ผ่อนไหวเดือนละ', amount: result.affordablePayment };
  if (hasAmount(result.monthlyIncome) && hasAmount(result.monthlyExpense))
    return {
      label: 'เงินเหลือต่อเดือน',
      amount: Math.round((result.monthlyIncome - result.monthlyExpense) * 100) / 100,
    };
  if (hasAmount(result.totalIncome) && hasAmount(result.totalExpense))
    return {
      label: `เงินเหลือช่วง ${result.dateRange || 'ตามเอกสาร'}`,
      amount: Math.round((result.totalIncome - result.totalExpense) * 100) / 100,
    };
  return null;
}

export function readCreditFile(file: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้ กรุณาเลือกใหม่'));
    reader.readAsArrayBuffer(file);
  });
}

export async function validateCreditFile(file: File) {
  if (!file.size || file.size > 10 * 1024 * 1024)
    throw new Error('ไฟล์ต้องมีข้อมูลและขนาดไม่เกิน 10MB');
  const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (file.type ? !allowed.includes(file.type) : !/\.(pdf|jpe?g|png|gif|webp)$/i.test(file.name)) {
    throw new Error('รองรับ PDF, JPEG, PNG, GIF และ WebP หากเป็น HEIC กรุณาแปลงเป็น JPEG ก่อน');
  }
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const { PDFDocument, EncryptedPDFError } = await import('pdf-lib');
    try {
      await PDFDocument.load(new Uint8Array(await readCreditFile(file)));
    } catch (error) {
      // pdf-lib's ES5 Error subclass does not always preserve instanceof.
      if (
        error instanceof EncryptedPDFError ||
        (error instanceof Error && error.message === new EncryptedPDFError().message)
      )
        throw new Error(
          'เปิดไฟล์นี้ไม่ได้ — ไฟล์นี้ล็อกรหัส กรุณาใช้ PDF ที่ไม่ล็อกรหัส หรือส่งเป็นรูปแทน',
        );
      throw new Error('เปิดไฟล์นี้ไม่ได้ กรุณาเลือก PDF ที่เปิดอ่านได้ หรือส่งเป็นรูปแทน');
    }
  }
}
