import type { Receipt } from '@/types/receipt';

/**
 * Simple PDF export using window.print()
 * This method preserves all styles and formatting
 */
export async function exportReceiptAsPDF(
  receipt: Receipt,
  size: 'mobile' | 'a4' | 'a5' = 'a5'
): Promise<void> {
  // Create a new window for printing
  const printWindow = window.open('', '_blank');

  if (!printWindow) {
    throw new Error('ไม่สามารถเปิดหน้าต่างพิมพ์ได้');
  }

  // Get the receipt element
  const receiptElement = document.getElementById('receipt-print-area');

  if (!receiptElement) {
    printWindow.close();
    throw new Error('ไม่พบข้อมูลใบเสร็จ');
  }

  // Get all stylesheets from the current page
  const styleSheets = Array.from(document.styleSheets)
    .map(styleSheet => {
      try {
        const cssRules = Array.from(styleSheet.cssRules || []);
        return cssRules.map(rule => rule.cssText).join('\n');
      } catch (e) {
        // External stylesheets might throw security errors
        const link = document.querySelector(`link[href*="${styleSheet.href}"]`);
        if (link) {
          return `<link rel="stylesheet" href="${styleSheet.href}">`;
        }
        return '';
      }
    })
    .join('\n');

  // Clone the receipt element
  const clonedReceipt = receiptElement.cloneNode(true) as HTMLElement;

  // Set page size based on selection
  const pageSettings = {
    a4: '@page { size: A4 portrait; margin: 10mm; }',
    a5: '@page { size: A5 portrait; margin: 5mm; }',
    mobile: '@page { size: 80mm 297mm; margin: 2mm; }'
  };

  // Create the print document
  const printContent = `
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Receipt ${receipt.receiptNumber}</title>

      <!-- Google Fonts -->
      <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;600;700&display=swap" rel="stylesheet">

      <style>
        /* Reset and base styles */
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          color-adjust: exact !important;
        }

        body {
          font-family: 'Sarabun', 'TH Sarabun PSK', sans-serif;
          background: white;
          margin: 0;
          padding: 0;
        }

        /* Page settings */
        ${pageSettings[size]}

        /* Include all page styles */
        ${styleSheets}

        /* Scale down for printing to fit paper */
        @media print {
          body {
            margin: 0;
            padding: 0;
          }

          .print\\:hidden {
            display: none !important;
          }

          /* Ensure backgrounds print */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Scale down A4 and A5 to fit on paper */
          ${size === 'a4' ? `
            .a4-receipt-container {
              transform: scale(0.65) !important;
              transform-origin: top left !important;
              width: 154% !important;
              margin: 0 auto !important;
            }
          ` : ''}

          ${size === 'a5' ? `
            .a5-receipt-container {
              transform: scale(0.7) !important;
              transform-origin: top left !important;
              width: 143% !important;
              margin: 0 auto !important;
            }
          ` : ''}
        }

        /* Force visibility */
        #receipt-content {
          display: block !important;
          visibility: visible !important;
        }

        #receipt-content * {
          visibility: visible !important;
        }

        /* Additional sizing adjustments for screen view */
        ${size === 'a4' ? `
          .a4-receipt-container {
            width: 210mm !important;
            min-height: 297mm !important;
          }
          .a4-receipt {
            width: 210mm !important;
            min-height: 297mm !important;
            padding: 15mm !important;
          }
        ` : ''}

        ${size === 'a5' ? `
          .a5-receipt-container {
            width: 148mm !important;
            min-height: 210mm !important;
          }
          .a5-receipt {
            width: 148mm !important;
            min-height: 210mm !important;
            padding: 8mm !important;
          }
        ` : ''}
      </style>
    </head>
    <body>
      <div id="receipt-content">
        ${clonedReceipt.outerHTML}
      </div>
    </body>
    </html>
  `;

  // Write content to the new window
  printWindow.document.write(printContent);
  printWindow.document.close();

  // Wait for content to load
  printWindow.onload = () => {
    setTimeout(() => {
      // Trigger print dialog
      printWindow.print();

      // Close window after printing
      printWindow.onafterprint = () => {
        printWindow.close();
      };
    }, 500); // Give time for styles and images to load
  };
}