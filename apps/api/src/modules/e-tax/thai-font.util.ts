import { DOCUMENT_STYLE } from '@installment/shared';
import { registerDocumentFont } from '../../assets/fonts/document-fonts';

/** Same embedded regular/bold faces as contracts and all system documents. */
export const THAI_FONT_FAMILY = DOCUMENT_STYLE.pdfFontFamily;
export const registerThaiFont = registerDocumentFont;
