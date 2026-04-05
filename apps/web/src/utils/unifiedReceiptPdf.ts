import html2pdf from 'html2pdf.js';
import type { Receipt } from '@/types/receipt';

/**
 * Wait for images, QR codes, and fonts to load
 */
async function waitForAllResources(): Promise<void> {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(resolve));
  // Extra delay for QR SVG rendering to complete
  await new Promise(resolve => setTimeout(resolve, 100));
}

/** Pixel widths matching PrintableReceipt's mm-based containers */
const SIZE_WIDTH_PX: Record<string, number> = {
  a4: 794,  // 210mm
  a5: 559,  // 148mm
};

/**
 * Copy key visual computed styles from the original DOM tree onto the
 * html2canvas-cloned tree so the rasterised output matches the screen.
 *
 * html2canvas often fails to resolve Tailwind utility classes and Google Fonts
 * because it reads the cloned document where stylesheets may not fully apply.
 * By reading getComputedStyle() from the *original* (correctly-rendered)
 * elements and writing them inline on the *cloned* elements, we guarantee
 * visual fidelity.
 */
function forceInlineStyles(
  original: HTMLElement,
  cloned: HTMLElement,
): void {
  const dominated = [
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight',
    'color', 'backgroundColor',
    'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'borderTopStyle', 'borderRightStyle', 'borderBottomStyle', 'borderLeftStyle',
  ] as const;

  const origChildren = original.children;
  const cloneChildren = cloned.children;

  // Apply computed styles to the root element itself
  const cs = window.getComputedStyle(original);
  for (const prop of dominated) {
    (cloned.style as unknown as Record<string, string>)[prop] = cs.getPropertyValue(
      prop.replace(/[A-Z]/g, m => `-${m.toLowerCase()}`)
    );
  }

  // Recurse into children (same DOM structure guaranteed by html2canvas clone)
  for (let i = 0; i < origChildren.length && i < cloneChildren.length; i++) {
    const origChild = origChildren[i] as HTMLElement;
    const cloneChild = cloneChildren[i] as HTMLElement;
    if (origChild.nodeType === 1 && cloneChild.nodeType === 1) {
      forceInlineStyles(origChild, cloneChild);
    }
  }
}

/**
 * Generate PDF from the actual receipt preview element.
 * Uses html2canvas to rasterise the DOM, then jsPDF to wrap as PDF.
 */
export async function generateUnifiedReceiptPDF(
  receipt: Receipt,
  size: 'mobile' | 'a4' | 'a5' = 'a5'
): Promise<void> {
  const receiptElement = document.getElementById('receipt-print-area');
  if (!receiptElement) {
    throw new Error('ไม่พบ element ของใบเสร็จ');
  }

  await waitForAllResources();

  try {
    let pageSize: string | number[] = 'a5';
    let margin: number | number[] = 5;

    switch (size) {
      case 'a4':
        pageSize = 'a4';
        margin = 0; // PrintableReceipt handles its own padding (p-[15mm])
        break;
      case 'a5':
        pageSize = 'a5';
        margin = 0; // PrintableReceipt handles its own padding (p-[6mm])
        break;
      case 'mobile':
        pageSize = [80, 297];
        margin = [2, 2, 2, 2];
        break;
    }

    // Keep a reference to the live element so onclone can read computed styles
    const liveElement = receiptElement;

    const opt = {
      margin: margin,
      filename: `receipt_${receipt.receiptNumber}.pdf`,
      image: { type: 'png' },
      html2canvas: {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        letterRendering: true,
        allowTaint: true,
        foreignObjectRendering: false,
        onclone: function (clonedDoc: Document) {
          const clonedElement = clonedDoc.getElementById('receipt-print-area');
          if (!clonedElement) return;

          // ── 1. Inject Google Font into cloned document ──
          const fontLink = clonedDoc.createElement('link');
          fontLink.rel = 'stylesheet';
          fontLink.href =
            'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@300;400;500;600;700&display=swap';
          clonedDoc.head.appendChild(fontLink);

          // ── 2. Force container dimensions to match the paper size ──
          const widthPx = SIZE_WIDTH_PX[size];
          if (widthPx) {
            clonedElement.style.width = `${widthPx}px`;
            clonedElement.style.maxWidth = `${widthPx}px`;
          }
          clonedElement.style.overflow = 'visible';

          // ── 3. Copy computed styles from live DOM → cloned DOM ──
          // This is the most robust way to ensure every color, font, and
          // border in the PDF matches the screen exactly.
          forceInlineStyles(liveElement, clonedElement);

          // ── 4. Force table-specific styles ──
          clonedElement.querySelectorAll('table').forEach((el) => {
            (el as HTMLElement).style.borderCollapse = 'collapse';
          });
          clonedElement.querySelectorAll('th, td').forEach((el) => {
            const td = el as HTMLElement;
            if (!td.style.borderWidth || td.style.borderWidth === '0px') {
              td.style.border = '1px solid #d1d5db';
            }
          });

          // ── 5. Ensure QR SVGs are visible ──
          clonedElement.querySelectorAll('svg').forEach((svg) => {
            const el = svg as SVGElement;
            el.style.display = 'block';
            el.style.visibility = 'visible';
          });

          // ── 6. Global print-color-adjust ──
          const style = clonedDoc.createElement('style');
          style.innerHTML = `
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
            }
          `;
          clonedDoc.head.appendChild(style);
        },
      },
      jsPDF: {
        unit: 'mm',
        format: pageSize,
        orientation: 'portrait' as const,
        compress: true,
      },
      pagebreak: {
        mode: ['avoid-all', 'css', 'legacy'],
      },
    };

    await html2pdf().set(opt).from(receiptElement).save();
  } catch (error) {
    console.error('Failed to generate PDF:', error);
    throw error;
  }
}

/**
 * Download receipt as PDF using unified approach
 */
export async function downloadUnifiedReceiptPDF(
  receipt: Receipt,
  size: 'mobile' | 'a4' | 'a5' = 'a5'
): Promise<void> {
  try {
    await generateUnifiedReceiptPDF(receipt, size);
  } catch (error) {
    console.error('Failed to download receipt PDF:', error);
    throw new Error('ไม่สามารถสร้าง PDF ได้');
  }
}
