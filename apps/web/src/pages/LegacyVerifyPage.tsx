import { Link, Navigate, useLocation, useParams } from 'react-router';
import { isAmbiguousLegacyNumber, legacyVerificationPath, receiptVerificationPath } from '@/lib/verification-links';

export default function LegacyVerifyPage() {
  const { identifier = '' } = useParams();
  const { search } = useLocation();
  if (isAmbiguousLegacyNumber(identifier)) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center space-y-4">
          <h1 className="text-xl font-semibold">เลือกประเภทเอกสาร</h1>
          <p className="break-all font-medium">{identifier}</p>
          <p className="text-sm text-muted-foreground">กรุณาเลือกตามหัวข้อบนเอกสารที่สแกน หมายเลขนี้ใช้ได้ทั้งใบเสร็จรับเงินและใบสำคัญจ่าย โดยระบบจะตรวจสอบสิทธิ์ก่อนแสดงข้อมูล</p>
          <Link to={receiptVerificationPath(identifier)} className="flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 py-2 text-primary-foreground">ตรวจสอบใบเสร็จรับเงิน</Link>
          <Link to={`/expenses/verify-number/${encodeURIComponent(identifier)}`} className="flex min-h-11 items-center justify-center rounded-lg border border-input px-4 py-2 text-foreground">ตรวจสอบใบสำคัญจ่าย</Link>
        </div>
      </main>
    );
  }
  const path = legacyVerificationPath(identifier, search);
  if (path) return <Navigate to={path} replace />;
  return (
    <main className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="max-w-md rounded-xl border bg-card p-6 text-center space-y-3">
        <h1 className="text-xl font-semibold">ไม่พบรูปแบบลิงก์ตรวจสอบนี้</h1>
        <p className="text-sm text-muted-foreground">
          กรุณาตรวจสอบ QR หรือลิงก์จากเอกสารอีกครั้ง
        </p>
        <Link to="/expenses" className="inline-flex min-h-11 items-center text-primary underline">
          เปิดรายการรายจ่าย
        </Link>
      </div>
    </main>
  );
}
