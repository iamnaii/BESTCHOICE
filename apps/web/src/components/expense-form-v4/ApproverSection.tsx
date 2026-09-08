import { useAuth } from '@/contexts/AuthContext';

export function ApproverSection() {
  const { user } = useAuth();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <p className="text-xs font-medium mb-1">ผู้บันทึก</p>
        <p className="px-3 py-2 border border-border rounded-lg text-sm bg-muted/50">
          {user?.name ?? '—'}
        </p>
      </div>
      <div>
        <p className="text-xs font-medium mb-1">ผู้อนุมัติ</p>
        <p className="text-sm">ระบบบันทึกชื่อจากผู้มีสิทธิ์ที่กดอนุมัติจริง</p>
        <p className="mt-1 text-xs text-muted-foreground">เจ้าของกำหนดสิทธิ์รายคนที่ ตั้งค่า → สิทธิ์รายการบัญชีรายรับ–รายจ่าย</p>
      </div>
    </div>
  );
}
