import html2pdf from 'html2pdf.js';
import type { Receipt } from '@/types/receipt';

/**
 * Wait for images and QR codes to load
 */
async function waitForAllResources(): Promise<void> {
  // Wait for any pending renders
  await new Promise(resolve => setTimeout(resolve, 500));
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
        margin = [10, 10, 10, 10];
        break;
      case 'a5':
        pageSize = 'a5';
        margin = [5, 5, 5, 5];
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
        type: 'jpeg',
        quality: 0.98
      },
      html2canvas: {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        letterRendering: true,
        allowTaint: true,
        foreignObjectRendering: true,
        onclone: function(clonedDoc: Document) {
          const clonedElement = clonedDoc.getElementById('receipt-print-area');
          if (!clonedElement) return;

          // Make sure element is visible
          clonedElement.style.display = 'block';
          clonedElement.style.visibility = 'visible';

          // Add critical styles directly to ensure they're captured
          const style = clonedDoc.createElement('style');
          style.innerHTML = `
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              color-adjust: exact !important;
            }

            /* Force backgrounds */
            .bg-blue-50 { background-color: #eff6ff !important; }
            .bg-green-50 { background-color: #f0fdf4 !important; }
            .bg-orange-50 { background-color: #fff7ed !important; }
            .bg-gray-50 { background-color: #f9fafb !important; }
            .bg-gray-100 { background-color: #f3f4f6 !important; }
            .bg-gray-700 { background-color: #374151 !important; }

            /* Force borders */
            .border { border: 1px solid #d1d5db !important; }
            .border-gray-300 { border-color: #d1d5db !important; }
            .border-gray-400 { border-color: #9ca3af !important; }
            .border-green-400 { border-color: #4ade80 !important; }
            .border-orange-400 { border-color: #fb923c !important; }

            /* Force text colors */
            .text-white { color: white !important; }
            .text-gray-600 { color: #4b5566 !important; }
            .text-gray-700 { color: #374151 !important; }
            .text-gray-800 { color: #1f2937 !important; }
            .text-green-600 { color: #16a34a !important; }
            .text-orange-600 { color: #ea580c !important; }

            /* Table styles */
            table { border-collapse: collapse !important; }
            th, td {
              border: 1px solid #d1d5db !important;
              padding: 0.5rem !important;
            }

            /* QR Code visibility */
            svg {
              display: block !important;
              visibility: visible !important;
            }
          `;
          clonedDoc.head.appendChild(style);

          // Apply inline styles to ensure they're captured
          const elementsWithBg = clonedElement.querySelectorAll('[class*="bg-"]');
          elementsWithBg.forEach((el) => {
            const element = el as HTMLElement;
            const classes = element.className;

            if (classes.includes('bg-blue-50')) {
              element.style.backgroundColor = '#eff6ff';
            } else if (classes.includes('bg-green-50')) {
              element.style.backgroundColor = '#f0fdf4';
            } else if (classes.includes('bg-orange-50')) {
              element.style.backgroundColor = '#fff7ed';
            } else if (classes.includes('bg-gray-50')) {
              element.style.backgroundColor = '#f9fafb';
            } else if (classes.includes('bg-gray-100')) {
              element.style.backgroundColor = '#f3f4f6';
            } else if (classes.includes('bg-gray-700')) {
              element.style.backgroundColor = '#374151';
              element.style.color = 'white';
            }
          });

          // Ensure borders are visible
          const elementsWithBorder = clonedElement.querySelectorAll('[class*="border"]');
          elementsWithBorder.forEach((el) => {
            const element = el as HTMLElement;
            if (!element.style.border && !element.style.borderWidth) {
              element.style.border = '1px solid #d1d5db';
            }
          });

          // Ensure QR codes are rendered
          const qrCodes = clonedElement.querySelectorAll('svg');
          qrCodes.forEach((qr) => {
            const svgElement = qr as SVGElement;
            svgElement.style.display = 'block';
            svgElement.style.visibility = 'visible';
            // Preserve original dimensions
            if (!svgElement.style.width) {
              svgElement.style.width = svgElement.getAttribute('width') || '80px';
            }
            if (!svgElement.style.height) {
              svgElement.style.height = svgElement.getAttribute('height') || '80px';
            }
          });
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