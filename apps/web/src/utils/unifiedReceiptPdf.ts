import html2pdf from 'html2pdf.js';
import type { Receipt } from '@/types/receipt';

/**
 * Wait for images and QR codes to load
 */
async function waitForAllResources(): Promise<void> {
  // Wait for fonts to load, then one animation frame for pending renders
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(resolve));
}

/**
 * Generate PDF from the actual receipt preview element
 * This ensures the PDF exactly matches what's shown on screen
 */
export async function generateUnifiedReceiptPDF(
  receipt: Receipt,
  size: 'mobile' | 'a4' | 'a5' = 'a5'
): Promise<void> {
  // Find the receipt element in the modal
  const receiptElement = document.getElementById('receipt-print-area');

  if (!receiptElement) {
    throw new Error('ไม่พบ element ของใบเสร็จ');
  }

  // Wait for resources to load
  await waitForAllResources();

  try {
    // Configure html2pdf options based on size
    let pageSize: string | number[] = 'a5';
    let margin: number | number[] = 5;

    switch (size) {
      case 'a4':
        pageSize = 'a4';
        margin = 0; // PrintableReceipt handles its own padding (p-[15mm])
        break;
      case 'a5':
        pageSize = 'a5';
        margin = 0; // PrintableReceipt handles its own padding (p-[8mm])
        break;
      case 'mobile':
        pageSize = [80, 297]; // 80mm width for thermal printer
        margin = [2, 2, 2, 2];
        break;
    }

    const opt = {
      margin: margin,
      filename: `receipt_${receipt.receiptNumber}.pdf`,
      image: {
        type: 'png',
      },
      html2canvas: {
        scale: 3,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        letterRendering: true,
        allowTaint: true,
        foreignObjectRendering: false,
        onclone: function(clonedDoc: Document) {
          const clonedElement = clonedDoc.getElementById('receipt-print-area');
          if (!clonedElement) return;

          // WYSIWYG: NO layout modifications — capture exactly as shown on screen
          // Only force visual properties that html2canvas can't read from Tailwind

          // Force background colors inline (html2canvas misses Tailwind bg classes)
          const bgMap: Record<string, string> = {
            'bg-blue-50': '#eff6ff', 'bg-green-50': '#f0fdf4',
            'bg-orange-50': '#fff7ed', 'bg-gray-50': '#f9fafb',
            'bg-gray-100': '#f3f4f6', 'bg-gray-700': '#374151',
          };
          clonedElement.querySelectorAll('[class*="bg-"]').forEach((el) => {
            const element = el as HTMLElement;
            for (const [cls, color] of Object.entries(bgMap)) {
              if (element.classList.contains(cls)) {
                element.style.backgroundColor = color;
                if (cls === 'bg-gray-700') element.style.color = 'white';
                break;
              }
            }
          });

          // Force borders inline
          clonedElement.querySelectorAll('th, td').forEach((el) => {
            (el as HTMLElement).style.border = '1px solid #d1d5db';
          });

          // Force table border-collapse
          clonedElement.querySelectorAll('table').forEach((el) => {
            (el as HTMLElement).style.borderCollapse = 'collapse';
          });

          // Ensure QR SVGs are visible
          clonedElement.querySelectorAll('svg').forEach((svg) => {
            const el = svg as SVGElement;
            el.style.display = 'block';
            el.style.visibility = 'visible';
          });

          // Force print color accuracy
          const style = clonedDoc.createElement('style');
          style.innerHTML = `* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }`;
          clonedDoc.head.appendChild(style);
        }
      },
      jsPDF: {
        unit: 'mm',
        format: pageSize,
        orientation: 'portrait' as const,
        compress: true
      },
      pagebreak: {
        mode: ['avoid-all', 'css', 'legacy']
      }
    };

    // Generate and download PDF directly from the element in DOM
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