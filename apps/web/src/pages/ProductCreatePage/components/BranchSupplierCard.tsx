import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';

interface BranchSupplierCardProps {
  branchId: string;
  supplierId: string;
  costPrice: string;
  branchList: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  inputCls: string;
  onChange: (field: string, value: string) => void;
}

export default function BranchSupplierCard({
  branchId,
  supplierId,
  costPrice,
  branchList,
  suppliers,
  suppliersLoading,
  suppliersError,
  inputCls,
  onChange,
}: BranchSupplierCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>สาขา &amp; ผู้ขาย</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-5 lg:gap-7.5">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">สาขา *</label>
            <select
              value={branchId}
              onChange={(e) => onChange('branchId', e.target.value)}
              className={inputCls}
              required
            >
              <option value="">เลือกสาขา</option>
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ผู้ขาย</label>
            <select
              value={supplierId}
              onChange={(e) => onChange('supplierId', e.target.value)}
              className={inputCls}
            >
              <option value="">
                {suppliersLoading ? 'กำลังโหลด...' : suppliersError ? '⚠ โหลดข้อมูลไม่ได้' : 'ไม่ระบุ'}
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">ราคาทุน (บาท) *</label>
            <input
              type="number"
              step="0.01"
              value={costPrice}
              onChange={(e) => onChange('costPrice', e.target.value)}
              className={inputCls}
              required
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
