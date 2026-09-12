import { toast } from 'sonner';
import { DOCUMENT_STYLE } from '@installment/shared';

/** Wait before opening print preview so first-time printing uses the real Thai font metrics. */
export async function printDocument(): Promise<void> {
  try {
    const loaded = await Promise.all([400, 700].map(weight =>
      document.fonts.load(`${weight} ${DOCUMENT_STYLE.bodyPt}pt "${DOCUMENT_STYLE.fontFamily}"`),
    ));
    if (loaded.some(faces => faces.length === 0)) throw new Error('Document font is unavailable');
    await document.fonts.ready;
    window.print();
  } catch {
    toast.error('โหลดฟอนต์เอกสารไม่สำเร็จ กรุณาลองพิมพ์อีกครั้ง');
  }
}
