import type { Receipt } from '@/types/receipt';
import { formatDateMedium } from '@/utils/formatters';
import QRCodeSVG from 'react-qr-code';

interface MobileReceiptProps {
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

export default function MobileReceipt({ receipt }: MobileReceiptProps) {
  const thaiDate = formatDateMedium(receipt.paidDate);

  // Generate verify URL for QR code
  const verifyUrl = `${window.location.origin}/verify/${receipt.receiptNumber}`;

  return (
    <div className="mobile-receipt w-full max-w-md mx-auto bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header with gradient */}
      <div className="bg-linear-to-r from-blue-600 to-primary p-6 text-white">
        <div className="text-center mb-3">
          {receipt.company?.logoUrl ? (
            <img
              src={receipt.company.logoUrl}
              alt="Company Logo"
              className="h-12 mx-auto mb-2 object-contain filter brightness-0 invert"
            />
          ) : (
            <h1 className="text-2xl font-bold mb-1">
              {receipt.company?.nameTh || 'BESTCHOICE'}
            </h1>
          )}
          <p className="text-xs opacity-90">
            {receipt.company?.nameEn || 'ระบบผ่อนชำระมือถือและอุปกรณ์'}
          </p>
          {receipt.contract?.branch && (
            <p className="text-xs opacity-75 mt-1">
              สาขา: {receipt.contract.branch.name}
            </p>
          )}
        </div>
        <div className="bg-white/20 backdrop-blur-xs rounded-lg p-3 text-center">
          <div className="text-sm opacity-90 mb-1">
            {typeLabels[receipt.receiptType] || receipt.receiptType}
          </div>
          <div className="font-mono text-lg font-bold">{receipt.receiptNumber}</div>
        </div>
        {receipt.isVoided && (
          <div className="mt-3 text-center">
            <span className="inline-block px-4 py-1 bg-red-500 text-white rounded-full text-xs font-medium">
              ใบเสร็จนี้ถูกยกเลิกแล้ว
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-6 space-y-4">
        {/* Amount Card - Highlight */}
        <div className="bg-linear-to-br from-green-50 to-green-100 border-2 border-green-300 rounded-xl p-5">
          <div className="text-center">
            <div className="text-sm text-green-700 font-medium mb-2">ยอดชำระครั้งนี้</div>
            <div className="text-4xl font-bold text-green-600 mb-1">
              {Number(receipt.amount).toLocaleString()}
              <span className="text-2xl ml-1">฿</span>
            </div>
            {receipt.installmentNo && (
              <div className="text-sm text-green-700 mt-2">งวดที่ {receipt.installmentNo}</div>
            )}
          </div>
        </div>

        {/* Remaining Balance - Highlight if exists */}
        {receipt.remainingBalance != null && (
          <div className="bg-linear-to-br from-orange-50 to-orange-100 border-2 border-orange-300 rounded-xl p-5">
            <div className="text-center">
              <div className="text-sm text-orange-700 font-medium mb-2">ยอดคงเหลือ</div>
              <div className="text-3xl font-bold text-orange-600 mb-1">
                {Number(receipt.remainingBalance).toLocaleString()}
                <span className="text-xl ml-1">฿</span>
              </div>
              {receipt.remainingMonths != null && (
                <div className="text-sm text-orange-700 mt-2">
                  เหลืออีก {receipt.remainingMonths} งวด
                </div>
              )}
            </div>
          </div>
        )}

        {/* Product Section */}
        {receipt.contract?.product && (
          <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-4 mb-4">
            <div className="text-xs text-blue-700 font-medium mb-2">รายละเอียดสินค้า</div>
            <div className="text-sm font-medium text-blue-900">
              {receipt.contract.product.name}
            </div>
            {(receipt.contract.product.imeiSerial || receipt.contract.product.serialNumber) && (
              <div className="text-xs text-blue-700 mt-1 space-y-0.5">
                {receipt.contract.product.imeiSerial && (
                  <div className="font-mono">IMEI/Serial: {receipt.contract.product.imeiSerial}</div>
                )}
                {receipt.contract.product.serialNumber && (
                  <div className="font-mono">S/N: {receipt.contract.product.serialNumber}</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Details Section */}
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
          <div className="flex justify-between items-center pb-2 border-b border-gray-200">
            <span className="text-sm text-gray-600">ผู้ชำระเงิน</span>
            <span className="text-sm font-medium text-gray-900">{receipt.payerName}</span>
          </div>

          {receipt.contract?.contractNumber && (
            <div className="flex justify-between items-center pb-2 border-b border-gray-200">
              <span className="text-sm text-gray-600">เลขสัญญา</span>
              <span className="text-xs font-mono font-medium text-primary">
                {receipt.contract.contractNumber}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center pb-2 border-b border-gray-200">
            <span className="text-sm text-gray-600">วันที่ชำระ</span>
            <span className="text-sm font-medium text-gray-900">{thaiDate}</span>
          </div>

          {receipt.paymentMethod && (
            <div className="flex justify-between items-center pb-2 border-b border-gray-200">
              <span className="text-sm text-gray-600">วิธีชำระ</span>
              <span className="text-sm font-medium text-gray-900">
                {methodLabels[receipt.paymentMethod] || receipt.paymentMethod}
              </span>
            </div>
          )}

          {receipt.transactionRef && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">เลขอ้างอิง</span>
              <span className="text-xs font-mono text-gray-700">{receipt.transactionRef}</span>
            </div>
          )}
        </div>

        {/* Void Reason */}
        {receipt.isVoided && receipt.voidReason && (
          <div className="bg-red-50 border-l-4 border-red-500 rounded-r-lg p-4">
            <div className="text-xs font-bold text-red-700 mb-1">เหตุผลที่ยกเลิก:</div>
            <div className="text-sm text-red-600">{receipt.voidReason}</div>
          </div>
        )}

        {/* Receiver */}
        <div className="text-center text-sm text-gray-500 pt-2">
          <div>ผู้รับเงิน: {receipt.receiverName}</div>
        </div>

        {/* QR Code for Verification */}
        <div className="flex justify-center pt-4 pb-2">
          <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-200">
            <QRCodeSVG value={verifyUrl} size={120} level="M" />
            <p className="text-xs text-gray-500 text-center mt-2">สแกน QR เพื่อตรวจสอบ</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gray-100 px-6 py-4 text-center">
        <p className="text-xs text-gray-500">เอกสารนี้สร้างโดยระบบอัตโนมัติ</p>
        <p className="text-xs text-gray-500 mt-1">ตรวจสอบข้อมูลได้ที่ www.bestchoice.com</p>
      </div>
    </div>
  );
}
