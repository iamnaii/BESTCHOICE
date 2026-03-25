import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import MobileReceipt from '@/components/payment/MobileReceipt';
import type { Receipt } from '@/types/receipt';
import { CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export default function ReceiptVerifyPage() {
  const { receiptNumber } = useParams<{ receiptNumber: string }>();

  const { data: receipt, isLoading, error } = useQuery<Receipt>({
    queryKey: ['verify-receipt', receiptNumber],
    queryFn: async () => {
      const { data } = await api.get(`/receipts/number/${receiptNumber}`);
      return data;
    },
    enabled: !!receiptNumber,
    retry: false,
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">ตรวจสอบใบเสร็จ</h1>
          <p className="text-sm text-gray-600">Receipt Verification</p>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-primary mb-4" />
            <p className="text-gray-600">กำลังตรวจสอบใบเสร็จ...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border-2 border-red-300 rounded-xl p-8 text-center">
            <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-red-700 mb-2">ไม่พบใบเสร็จ</h2>
            <p className="text-red-600 text-sm">
              ไม่พบใบเสร็จเลขที่ <span className="font-mono">{receiptNumber}</span>
            </p>
            <p className="text-red-500 text-xs mt-2">กรุณาตรวจสอบเลขใบเสร็จและลองอีกครั้ง</p>
          </div>
        )}

        {receipt && (
          <div>
            {/* Verification Status */}
            {!receipt.isVoided ? (
              <div className="bg-green-50 border-2 border-green-300 rounded-xl p-6 mb-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h2 className="text-lg font-bold text-green-700 mb-1">ใบเสร็จถูกต้อง</h2>
                <p className="text-green-600 text-sm">ใบเสร็จนี้ออกโดย {receipt.company?.nameTh || 'BESTCHOICE'}</p>
              </div>
            ) : (
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-6 mb-6 text-center">
                <AlertCircle className="w-12 h-12 text-yellow-500 mx-auto mb-3" />
                <h2 className="text-lg font-bold text-yellow-700 mb-1">ใบเสร็จถูกยกเลิก</h2>
                <p className="text-yellow-600 text-sm">ใบเสร็จนี้ถูกยกเลิกแล้ว</p>
                {receipt.voidReason && (
                  <p className="text-yellow-700 text-xs mt-2">
                    เหตุผล: {receipt.voidReason}
                  </p>
                )}
              </div>
            )}

            {/* Receipt Display */}
            <MobileReceipt receipt={receipt} />

            {/* Footer Info */}
            <div className="mt-6 bg-gray-50 rounded-lg p-4 text-center">
              <p className="text-xs text-gray-500">
                หากพบความผิดปกติ กรุณาติดต่อ
                {receipt.company?.phone && (
                  <span className="block font-medium text-gray-700 mt-1">
                    โทร: {receipt.company.phone}
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                ตรวจสอบเมื่อ: {new Date().toLocaleString('th-TH')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
