import type { Receipt } from '@/types/receipt';
import QRCodeSVG from 'react-qr-code';

interface PrintableReceiptProps {
  receipt: Receipt;
  size: 'a4' | 'a5';
}

const typeLabels: Record<string, string> = {
  PAYMENT: 'ใบเสร็จรับเงิน',
  DOWN_PAYMENT: 'ใบเสร็จเงินดาวน์',
  EARLY_PAYOFF: 'ใบเสร็จปิดยอด',
  CREDIT_NOTE: 'ใบลดหนี้',
};

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  QR_EWALLET: 'QR/E-Wallet',
};

export default function PrintableReceipt({ receipt, size }: PrintableReceiptProps) {
  // Handle missing receipt data
  if (!receipt) {
    return (
      <div className={`receipt-container receipt-${size} w-full h-full print:m-0 print:p-0`}>
        <div className="receipt-content bg-white relative w-full h-full flex items-center justify-center">
          <div className="text-center text-gray-500">
            <p className="text-lg">ไม่พบข้อมูลใบเสร็จ</p>
          </div>
        </div>
      </div>
    );
  }

  const thaiDate = new Date(receipt.paidDate || new Date()).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const thaiTime = new Date(receipt.paidDate || new Date()).toLocaleTimeString('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Generate verify URL for QR code
  const verifyUrl = `${window.location.origin}/verify/${receipt.receiptNumber || receipt.id}`;

  // Check if this is a reprint (after 5 minutes from creation)
  const isReprint = receipt.createdAt
    ? new Date().getTime() - new Date(receipt.createdAt).getTime() > 5 * 60 * 1000
    : false;

  // Format currency
  const formatCurrency = (amount: string | number | null | undefined) => {
    const num = Number(amount || 0);
    return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Calculate VAT if not present (for old receipts)
  const vatRate = Number(receipt.vatRate || 7.00);
  const totalAmount = Number(receipt.amount || 0);
  const subtotal = receipt.subtotal ? Number(receipt.subtotal) : totalAmount / (1 + vatRate / 100);
  const vatAmount = receipt.vatAmount ? Number(receipt.vatAmount) : totalAmount - subtotal;

  // Size-specific styles
  const getSizeClasses = () => {
    switch (size) {
      case 'a4':
        return {
          container: 'a4-receipt-container w-[210mm] h-[297mm] print:w-[190mm] print:max-w-[190mm]',
          content: 'a4-receipt p-[15mm] print:p-[10mm]',
          header: 'text-2xl print:text-xl',
          title: 'text-xl print:text-lg',
          body: 'text-sm print:text-xs',
          small: 'text-xs print:text-[10px]',
          qrSize: 80,
        };
      default: // a5
        return {
          container: 'a5-receipt-container w-[148mm] h-[210mm] print:w-[138mm] print:max-w-[138mm]',
          content: 'a5-receipt p-[8mm] print:p-[5mm]',
          header: 'text-xl print:text-lg',
          title: 'text-lg print:text-base',
          body: 'text-xs print:text-[11px]',
          small: 'text-[11px] print:text-[10px]',
          qrSize: 65,
        };
    }
  };

  const styles = getSizeClasses();

  // A4/A5 layout
  return (
    <div className={`${styles.container} print:m-0 print:p-0 relative mx-auto`} style={{ fontFamily: "'Sarabun', 'TH Sarabun PSK', sans-serif" }}>
      {/* Watermark for reprints */}
      {isReprint && (
        <div className="watermark absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-[100px] font-bold text-gray-200 opacity-30 rotate-45 z-10 pointer-events-none select-none print:opacity-40">
          สำเนา
        </div>
      )}

      {/* Receipt Layout */}
      <div className={`${styles.content} bg-white w-full min-h-full flex flex-col relative`}>

        {/* ========== HEADER SECTION ========== */}
        <div className="mb-3">
          {/* Company Header with QR Code */}
          <div className="flex justify-between items-start border-b-2 border-gray-300 pb-3">
            {/* Left: Company Info */}
            <div className="flex-1">
              <h1 className={`${styles.header} font-bold text-gray-900`}>
                {receipt.company?.nameTh || 'เบสท์ช้อยส์ โมบาย'}
              </h1>
              <p className={`${styles.small} text-gray-700 mt-0.5`}>
                {receipt.company?.nameEn || 'BESTCHOICE Mobile'}
              </p>
              <div className={`${styles.small} mt-2 text-gray-600 space-y-0.5`}>
                <p>{receipt.company?.address || '99 ถ.วิภาวดีรังสิต แขวงจตุจักร เขตจตุจักร กรุงเทพฯ 10900'}</p>
                <p>โทร: {receipt.company?.phone || '02-100-0000'}</p>
                {receipt.company?.taxId && (
                  <p>เลขประจำตัวผู้เสียภาษี: {receipt.company.taxId}</p>
                )}
              </div>
            </div>

            {/* Right: QR Code */}
            <div className="text-center ml-4">
              <QRCodeSVG
                value={verifyUrl}
                size={styles.qrSize}
                level="M"
                className="border border-gray-400 p-1 rounded"
              />
              <p className={`${styles.small} text-gray-500 mt-1`}>ตรวจสอบ</p>
            </div>
          </div>

          {/* Receipt Header */}
          <div className="mt-3 text-center">
            <h2 className={`${styles.title} font-bold text-gray-800`}>
              {typeLabels[receipt.receiptType] || receipt.receiptType}
            </h2>
            {receipt.isVoided && (
              <span className={`inline-block mt-1 px-3 py-1 bg-red-100 text-red-700 ${styles.body} font-bold rounded`}>
                *** ยกเลิกแล้ว ***
              </span>
            )}
          </div>

          {/* Receipt Number and Date */}
          <div className={`mt-2 flex justify-between items-start ${styles.body}`}>
            <div>
              <span className="text-gray-600">เลขที่ใบเสร็จ:</span>{' '}
              <span className="font-mono font-bold text-gray-800">{receipt.receiptNumber}</span>
            </div>
            <div className="text-right">
              <div>{thaiDate}</div>
              <div className={`${styles.small} text-gray-500`}>{thaiTime} น.</div>
            </div>
          </div>
        </div>

        {/* ========== CUSTOMER & PAYMENT INFO ========== */}
        <div className={`border border-gray-300 rounded-lg p-3 mb-3 ${styles.body}`}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="font-bold text-gray-700 mb-1">ข้อมูลผู้ชำระเงิน:</div>
              <div className="space-y-0.5">
                <div>
                  <span className="text-gray-600">ชื่อ:</span>{' '}
                  <span className="font-medium">{receipt.payerName || 'ลูกค้า'}</span>
                </div>
                {receipt.contract?.contractNumber && (
                  <div>
                    <span className="text-gray-600">เลขสัญญา:</span>{' '}
                    <span className="font-mono font-medium">{receipt.contract.contractNumber}</span>
                  </div>
                )}
                {receipt.contract?.branch && (
                  <div>
                    <span className="text-gray-600">สาขา:</span>{' '}
                    <span className="font-medium">{receipt.contract.branch.name}</span>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="font-bold text-gray-700 mb-1">ข้อมูลการชำระ:</div>
              <div className="space-y-0.5">
                <div>
                  <span className="text-gray-600">วิธีชำระ:</span>{' '}
                  <span className="font-medium">
                    {receipt.paymentMethod ? methodLabels[receipt.paymentMethod] || receipt.paymentMethod : '-'}
                  </span>
                </div>
                {receipt.transactionRef && (
                  <div>
                    <span className="text-gray-600">เลขอ้างอิง:</span>{' '}
                    <span className={`font-mono ${styles.small}`}>{receipt.transactionRef}</span>
                  </div>
                )}
                {receipt.installmentNo && (
                  <div>
                    <span className="text-gray-600">งวดที่:</span>{' '}
                    <span className="font-medium">{receipt.installmentNo}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ========== PRODUCT DETAILS ========== */}
        {receipt.contract?.product && (
          <div className={`bg-blue-50 border border-blue-200 rounded p-2 mb-3 ${styles.body}`}>
            <div className="font-bold text-blue-800 mb-0.5">รายละเอียดสินค้า:</div>
            <div className="text-blue-900 font-medium">{receipt.contract.product.name}</div>
            {(receipt.contract.product.imeiSerial || receipt.contract.product.serialNumber) && (
              <div className={`mt-0.5 ${styles.small} text-blue-700`}>
                {receipt.contract.product.imeiSerial && (
                  <div>IMEI/Serial: <span className="font-mono">{receipt.contract.product.imeiSerial}</span></div>
                )}
                {receipt.contract.product.serialNumber && (
                  <div>S/N: <span className="font-mono">{receipt.contract.product.serialNumber}</span></div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ========== PAYMENT DETAILS TABLE ========== */}
        <div className="mb-3">
          <div className={`${styles.body} font-bold text-gray-700 mb-1`}>รายการ</div>
          <table className={`w-full border border-gray-400 ${styles.body}`}>
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-300 px-2 py-1.5 text-left font-bold text-gray-700">
                  รายละเอียด
                </th>
                <th className="border border-gray-300 px-2 py-1.5 text-right font-bold text-gray-700 w-28">
                  จำนวนเงิน (฿)
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Main payment row - subtotal */}
              <tr>
                <td className="border border-gray-300 px-2 py-1.5">
                  {(() => {
                    const productName = receipt.contract?.product?.name || '';
                    const receiptLabel = typeLabels[receipt.receiptType] || 'การชำระเงิน';

                    // สร้างข้อความตามประเภทใบเสร็จ
                    let description = '';
                    switch(receipt.receiptType) {
                      case 'PAYMENT':
                        description = `ค่างวดสินค้า${productName ? ` - ${productName.substring(0, 40)}` : ''}`;
                        break;
                      case 'DOWN_PAYMENT':
                        description = `ชำระเงินดาวน์${productName ? ` - ${productName.substring(0, 40)}` : ''}`;
                        break;
                      case 'EARLY_PAYOFF':
                        description = `ชำระปิดยอด${productName ? ` - ${productName.substring(0, 40)}` : ''}`;
                        break;
                      case 'CREDIT_NOTE':
                        description = `ใบลดหนี้${receipt.voidReason ? ` - ${receipt.voidReason}` : ''}`;
                        break;
                      default:
                        description = productName || receiptLabel;
                    }

                    return (
                      <>
                        {description}
                        {receipt.installmentNo && receipt.receiptType === 'PAYMENT' && (
                          <span className={`${styles.small} text-gray-500 ml-1`}>(งวดที่ {receipt.installmentNo})</span>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td className="border border-gray-300 px-2 py-1.5 text-right font-medium">
                  {formatCurrency(subtotal)}
                </td>
              </tr>

              {/* VAT row - always show */}
              <tr className="bg-gray-50">
                <td className="border border-gray-300 px-2 py-1.5 text-gray-600">
                  ภาษีมูลค่าเพิ่ม {vatRate.toFixed(0)}%
                </td>
                <td className="border border-gray-300 px-2 py-1.5 text-right text-gray-600">
                  {formatCurrency(vatAmount)}
                </td>
              </tr>

              {/* Total row */}
              <tr className="bg-gray-700 text-white font-bold">
                <td className="border border-gray-700 px-2 py-1.5">
                  รวมทั้งสิ้น
                </td>
                <td className={`border border-gray-700 px-2 py-1.5 text-right ${styles.body}`}>
                  {formatCurrency(receipt.amount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ========== PAYMENT SUMMARY ========== */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-green-50 border border-green-400 rounded p-3 text-center">
            <div className={`${styles.small} text-gray-600 font-medium`}>ยอดชำระครั้งนี้</div>
            <div className="mt-1">
              <div className={`${styles.title} font-bold text-green-600`}>
                {formatCurrency(receipt.amount)}
              </div>
              <div className={`${styles.body} text-green-600`}>บาท</div>
            </div>
          </div>

          {receipt.remainingBalance != null && Number(receipt.remainingBalance) > 0 ? (
            <div className="bg-orange-50 border border-orange-400 rounded p-3 text-center">
              <div className={`${styles.small} text-gray-600 font-medium`}>ยอดคงเหลือ</div>
              <div className="mt-1">
                <div className={`${styles.title} font-bold text-orange-600`}>
                  {formatCurrency(receipt.remainingBalance)}
                </div>
                <div className={`${styles.body} text-orange-600`}>
                  บาท {receipt.remainingMonths != null && receipt.remainingMonths > 0 && (
                    <span className={`${styles.small} text-gray-500`}>({receipt.remainingMonths} งวด)</span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-300 rounded p-3 flex items-center justify-center">
              <div className="text-center">
                <div className={`${styles.body} text-gray-500`}>ชำระครบถ้วน</div>
                <div className={`${styles.small} text-gray-400 mt-0.5`}>✓ เสร็จสิ้น</div>
              </div>
            </div>
          )}
        </div>

        {/* Spacer to push footer to bottom */}
        <div className="flex-grow"></div>

        {/* ========== FOOTER ========== */}
        <div className="mt-auto">
          {/* Signature Section */}
          <div className="grid grid-cols-2 gap-6 mb-3 mt-4">
            <div className="text-center">
              <div className="mb-8"></div>
              <div className="border-t border-gray-400 pt-1 mx-6">
                <div className={`${styles.body} text-gray-600`}>ผู้รับเงิน</div>
                <div className={`${styles.small} font-medium text-gray-800 mt-0.5`}>
                  {receipt.receiverName || 'BESTCHOICE Mobile'}
                </div>
              </div>
            </div>
            <div className="text-center">
              <div className="mb-8"></div>
              <div className="border-t border-gray-400 pt-1 mx-6">
                <div className={`${styles.body} text-gray-600`}>ผู้ชำระเงิน</div>
                <div className={`${styles.small} font-medium text-gray-800 mt-0.5`}>
                  {receipt.payerName || 'ลูกค้า'}
                </div>
              </div>
            </div>
          </div>

          {/* Company Footer */}
          <div className="border-t border-gray-300 pt-2 text-center">
            <div className={`${styles.small} text-gray-600 font-medium`}>
              {receipt.company?.nameTh || 'BESTCHOICE Mobile'}
              {receipt.contract?.branch?.name && ` สาขา${receipt.contract.branch.name}`}
            </div>
            <div className={`${styles.small} text-gray-500`}>
              เอกสารนี้ออกโดยระบบอัตโนมัติ
            </div>
            <div className="text-[9px] text-gray-400 mt-0.5">
              พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}