import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || '';

interface PaymentLinkData {
  id: string;
  token: string;
  amount: number;
  status: string;
  expiresAt: string;
  contract: {
    contractNumber: string;
    customer: { name: string };
    payments: Array<{
      installmentNo: number;
      amountDue: string;
      lateFee: string;
      dueDate: string;
      status: string;
    }>;
  };
  payment: {
    installmentNo: number;
    amountDue: string;
    lateFee: string;
    dueDate: string;
  } | null;
}

export default function LiffPayment() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PaymentLinkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setError('ลิงก์ไม่ถูกต้อง');
      setLoading(false);
      return;
    }

    fetch(`${API_BASE}/api/line-oa/pay/${token}`)
      .then((res) => res.json())
      .then((result) => {
        if (!result || result.status === 'EXPIRED') {
          setError('ลิงก์ชำระเงินหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
        } else if (result.status === 'USED') {
          setError('ลิงก์นี้ถูกใช้งานแล้ว');
        } else {
          setData(result);
          // Load QR code
          setQrUrl(`${API_BASE}/api/line-oa/payment/${result.payment?.id || 'default'}/qr`);
        }
      })
      .catch(() => setError('ไม่สามารถโหลดข้อมูลได้'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSlipUpload = async () => {
    if (!slipFile || !data) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('slip', slipFile);
      formData.append('contractId', data.contract.contractNumber);
      formData.append('token', data.token);

      const res = await fetch(`${API_BASE}/api/line-oa/slip-upload`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setUploadSuccess(true);
      } else {
        const err = await res.json();
        alert(err.message || 'อัปโหลดสลิปไม่สำเร็จ');
      }
    } catch {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto" />
          <p className="mt-4 text-gray-600">กำลังโหลด...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">ไม่สามารถดำเนินการได้</h2>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (uploadSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-green-500 text-5xl mb-4">✓</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">รับสลิปเรียบร้อย</h2>
          <p className="text-gray-600 mb-4">กำลังตรวจสอบ จะแจ้งผลให้ทราบผ่าน LINE ค่ะ</p>
          <p className="text-sm text-gray-400">สามารถปิดหน้านี้ได้เลย</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const payment = data.payment;
  const amount = Number(data.amount);
  const dueDate = payment ? new Date(payment.dueDate).toLocaleDateString('th-TH') : '-';

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="bg-green-600 rounded-2xl p-6 text-white mb-6">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-lg font-bold mt-1">ชำระเงินค่างวด</h1>
        <p className="text-xs opacity-80 mt-1">สัญญา {data.contract.contractNumber}</p>
      </div>

      {/* Payment Details */}
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <h2 className="text-sm text-gray-500 mb-3">รายละเอียด</h2>
        <div className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">ลูกค้า</span>
            <span className="font-medium">{data.contract.customer.name}</span>
          </div>
          {payment && (
            <div className="flex justify-between">
              <span className="text-gray-600">งวดที่</span>
              <span className="font-medium">{payment.installmentNo}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-gray-600">ครบกำหนด</span>
            <span className="font-medium">{dueDate}</span>
          </div>
          <div className="border-t pt-2 flex justify-between items-center">
            <span className="text-gray-600">ยอดชำระ</span>
            <span className="text-2xl font-bold text-green-600">{amount.toLocaleString()} บาท</span>
          </div>
        </div>
      </div>

      {/* PromptPay QR */}
      {qrUrl && (
        <div className="bg-white rounded-2xl shadow-sm p-6 mb-4 text-center">
          <h2 className="text-sm text-gray-500 mb-3">สแกน QR เพื่อชำระเงิน</h2>
          <img
            src={qrUrl}
            alt="PromptPay QR Code"
            className="mx-auto w-64 h-64 rounded-lg border"
            onError={() => setQrUrl(null)}
          />
          <p className="text-xs text-gray-400 mt-2">PromptPay QR Code</p>
        </div>
      )}

      {/* Slip Upload */}
      <div className="bg-white rounded-2xl shadow-sm p-6 mb-4">
        <h2 className="text-sm text-gray-500 mb-3">แจ้งชำระเงิน</h2>
        <p className="text-xs text-gray-400 mb-4">หลังโอนเงินแล้ว กรุณาแนบรูปสลิป</p>

        <label className="block w-full border-2 border-dashed border-gray-300 rounded-xl p-6 text-center cursor-pointer hover:border-green-400 transition-colors">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
          />
          {slipFile ? (
            <div>
              <p className="text-green-600 font-medium">เลือกไฟล์แล้ว</p>
              <p className="text-sm text-gray-500 mt-1">{slipFile.name}</p>
            </div>
          ) : (
            <div>
              <p className="text-gray-500">แตะเพื่อเลือกรูปสลิป</p>
              <p className="text-xs text-gray-400 mt-1">รองรับ JPG, PNG</p>
            </div>
          )}
        </label>

        <button
          onClick={handleSlipUpload}
          disabled={!slipFile || uploading}
          className={`w-full mt-4 py-3 rounded-xl font-medium text-white transition-colors ${
            slipFile && !uploading
              ? 'bg-green-600 hover:bg-green-700'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {uploading ? 'กำลังส่ง...' : 'แจ้งชำระเงิน'}
        </button>
      </div>

      <p className="text-center text-xs text-gray-400 mb-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
