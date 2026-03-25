import type { Receipt } from '@/types/receipt';
import QRCodeSVG from 'react-qr-code';

interface A4PrintableReceiptProps {
  receipt: Receipt;
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

export default function A4PrintableReceipt({ receipt }: A4PrintableReceiptProps) {
  const thaiDate = new Date(receipt.paidDate).toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Generate verify URL for QR code
  const verifyUrl = `${window.location.origin}/verify/${receipt.receiptNumber}`;

  // Check if this is a reprint (after 5 minutes from creation)
  const isReprint = new Date().getTime() - new Date(receipt.createdAt).getTime() > 5 * 60 * 1000;

  return (
    <div className="a4-receipt-container">
      {/* Watermark for reprints */}
      {isReprint && (
        <div className="watermark">สำเนา</div>
      )}

      {/* A4 Receipt Layout */}
      <div className="a4-receipt bg-white relative">
        {/* Header */}
        <div className="receipt-header border-b-2 border-gray-300 pb-6 mb-6">
          <div className="flex justify-between items-start">
            <div>
              {receipt.company?.logoUrl ? (
                <img
                  src={receipt.company.logoUrl}
                  alt="Company Logo"
                  className="h-16 mb-2 object-contain"
                />
              ) : (
                <h1 className="text-3xl font-bold text-gray-800 mb-2">
                  {receipt.company?.nameTh || 'BESTCHOICE'}
                </h1>
              )}
              <p className="text-sm text-gray-600">
                {receipt.company?.nameEn || 'ระบบผ่อนชำระมือถือและอุปกรณ์'}
              </p>
              {receipt.company?.taxId && (
                <p className="text-xs text-gray-500 mt-1">
                  เลขประจำตัวผู้เสียภาษี: {receipt.company.taxId}
                </p>
              )}
              {receipt.company?.address && (
                <p className="text-xs text-gray-500 mt-1">{receipt.company.address}</p>
              )}
              {receipt.company?.phone && (
                <p className="text-xs text-gray-500">โทร: {receipt.company.phone}</p>
              )}
              {receipt.contract?.branch && (
                <p className="text-xs text-blue-600 mt-2 font-medium">
                  สาขา: {receipt.contract.branch.name}
                  {receipt.contract.branch.location && ` (${receipt.contract.branch.location})`}
                </p>
              )}
            </div>
            <div className="text-right flex flex-col items-end">
              <div className="mb-3">
                <QRCodeSVG
                  value={verifyUrl}
                  size={80}
                  level="M"
                  className="border-2 border-gray-300 p-1 rounded"
                />
                <p className="text-xs text-gray-500 mt-1 text-center">ตรวจสอบ</p>
              </div>
              <h2 className="text-xl font-bold text-primary mb-1">
                {typeLabels[receipt.receiptType] || receipt.receiptType}
              </h2>
              <p className="text-sm font-mono text-gray-700">{receipt.receiptNumber}</p>
              {receipt.isVoided && (
                <span className="inline-block mt-2 px-3 py-1 bg-red-100 text-red-700 rounded text-xs font-medium">
                  ยกเลิกแล้ว
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Receipt Details */}
        <div className="grid grid-cols-2 gap-6 mb-6">
          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase">ข้อมูลผู้ชำระเงิน</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">ชื่อ:</span>{' '}
                <span className="font-medium">{receipt.payerName}</span>
              </div>
              {receipt.contract?.contractNumber && (
                <div>
                  <span className="text-gray-500">เลขสัญญา:</span>{' '}
                  <span className="font-mono font-medium">{receipt.contract.contractNumber}</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-gray-700 mb-3 uppercase">ข้อมูลการชำระเงิน</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-500">วันที่:</span>{' '}
                <span className="font-medium">{thaiDate}</span>
              </div>
              {receipt.paymentMethod && (
                <div>
                  <span className="text-gray-500">วิธีชำระ:</span>{' '}
                  <span className="font-medium">
                    {methodLabels[receipt.paymentMethod] || receipt.paymentMethod}
                  </span>
                </div>
              )}
              {receipt.transactionRef && (
                <div>
                  <span className="text-gray-500">เลขอ้างอิง:</span>{' '}
                  <span className="font-mono text-xs">{receipt.transactionRef}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Product Details */}
        {receipt.contract?.product && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <h3 className="text-sm font-bold text-gray-700 mb-2">รายละเอียดสินค้า</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-600">สินค้า:</span>{' '}
                <span className="font-medium">{receipt.contract.product.name}</span>
              </div>
              {receipt.contract.product.imeiSerial && (
                <div>
                  <span className="text-gray-600">IMEI/Serial:</span>{' '}
                  <span className="font-mono text-xs">{receipt.contract.product.imeiSerial}</span>
                </div>
              )}
              {receipt.contract.product.serialNumber && (
                <div>
                  <span className="text-gray-600">Serial:</span>{' '}
                  <span className="font-mono text-xs">{receipt.contract.product.serialNumber}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Payment Details Table */}
        <div className="mb-6">
          <table className="w-full border border-gray-300">
            <thead className="bg-gray-100">
              <tr>
                <th className="border border-gray-300 px-4 py-3 text-left text-sm font-bold">
                  รายการ
                </th>
                <th className="border border-gray-300 px-4 py-3 text-center text-sm font-bold w-24">
                  งวดที่
                </th>
                <th className="border border-gray-300 px-4 py-3 text-right text-sm font-bold w-32">
                  จำนวนเงิน
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-300 px-4 py-3 text-sm">
                  {typeLabels[receipt.receiptType] || receipt.receiptType}
                  {receipt.contract?.product && (
                    <div className="text-xs text-gray-500 mt-1">
                      {receipt.contract.product.name}
                    </div>
                  )}
                </td>
                <td className="border border-gray-300 px-4 py-3 text-center text-sm">
                  {receipt.installmentNo || '-'}
                </td>
                <td className="border border-gray-300 px-4 py-3 text-right text-sm font-medium">
                  {Number(receipt.amount).toLocaleString()} ฿
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary Box */}
        <div className="border-2 border-primary rounded-lg p-6 mb-6 bg-blue-50">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-gray-600 mb-1">ยอดชำระครั้งนี้</div>
              <div className="text-3xl font-bold text-green-600">
                {Number(receipt.amount).toLocaleString()} ฿
              </div>
            </div>
            {receipt.remainingBalance != null && (
              <div>
                <div className="text-sm text-gray-600 mb-1">ยอดคงเหลือ</div>
                <div className="text-3xl font-bold text-orange-600">
                  {Number(receipt.remainingBalance).toLocaleString()} ฿
                </div>
                {receipt.remainingMonths != null && (
                  <div className="text-sm text-gray-500 mt-1">
                    (เหลืออีก {receipt.remainingMonths} งวด)
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Void Reason */}
        {receipt.isVoided && receipt.voidReason && (
          <div className="border-l-4 border-red-500 bg-red-50 p-4 mb-6">
            <p className="text-sm font-bold text-red-700 mb-1">เหตุผลที่ยกเลิก:</p>
            <p className="text-sm text-red-600">{receipt.voidReason}</p>
          </div>
        )}

        {/* Footer */}
        <div className="border-t-2 border-gray-300 pt-6 mt-12">
          <div className="grid grid-cols-2 gap-8">
            <div className="text-center">
              <div className="border-t border-gray-400 inline-block px-12 pt-2 text-sm">
                ผู้รับเงิน: {receipt.receiverName}
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-gray-400 inline-block px-12 pt-2 text-sm">
                ผู้ชำระเงิน: {receipt.payerName}
              </div>
            </div>
          </div>
          <div className="text-center mt-8 text-xs text-gray-500">
            เอกสารนี้สร้างโดยระบบอัตโนมัติ • ตรวจสอบข้อมูลได้ที่ www.bestchoice.com
            <div className="mt-1">
              พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}
            </div>
          </div>
        </div>
      </div>

      {/* Print-specific CSS */}
      <style>{`
        .a4-receipt-container {
          width: 100%;
          background: white;
          position: relative;
        }

        .watermark {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-45deg);
          font-size: 120px;
          color: rgba(0, 0, 0, 0.1);
          font-weight: bold;
          z-index: 0;
          pointer-events: none;
        }

        .a4-receipt {
          max-width: 210mm;
          margin: 0 auto;
          padding: 20mm;
        }

        @media print {
          body {
            margin: 0;
            padding: 0;
          }

          .a4-receipt-container {
            width: 210mm;
            height: 297mm;
          }

          .a4-receipt {
            max-width: 100%;
            padding: 20mm;
            margin: 0;
          }

          /* Hide non-printable elements */
          button,
          .print\\:hidden {
            display: none !important;
          }

          /* Force print colors */
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Page break control */
          .a4-receipt {
            page-break-inside: avoid;
            page-break-after: avoid;
          }
        }

        @media screen {
          .a4-receipt {
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            border: 1px solid #e5e7eb;
          }
        }
      `}</style>
    </div>
  );
}
