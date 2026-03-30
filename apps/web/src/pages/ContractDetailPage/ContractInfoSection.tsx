import { useNavigate } from 'react-router-dom';
import type { ContractDetail } from './types';

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-muted-foreground mb-0.5">{label}</div><div className="text-sm text-foreground">{value || '-'}</div></div>;
}

interface ContractInfoSectionProps {
  contract: ContractDetail;
  canEdit: boolean;
  canEditMaster: boolean;
  isEditing: boolean;
  editForm: { sellingPrice: number; downPayment: number; totalMonths: number; interestRate: number; paymentDueDay: number; notes: string };
  setEditForm: (form: ContractInfoSectionProps['editForm']) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  isSaving: boolean;
  onEditProduct: () => void;
  onEditCustomer: () => void;
}

export default function ContractInfoSection({
  contract,
  canEdit,
  canEditMaster,
  isEditing,
  editForm,
  setEditForm,
  onStartEditing,
  onCancelEditing,
  onSave,
  isSaving,
  onEditProduct,
  onEditCustomer,
}: ContractInfoSectionProps) {
  const navigate = useNavigate();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      <div className="rounded-lg border p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">ข้อมูลสัญญา</h2>
          {canEdit && !isEditing && (
            <button onClick={onStartEditing} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
              แก้ไข
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">ราคาขาย</label>
                <input type="number" value={editForm.sellingPrice} onChange={(e) => setEditForm({ ...editForm, sellingPrice: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">เงินดาวน์</label>
                <input type="number" value={editForm.downPayment} onChange={(e) => setEditForm({ ...editForm, downPayment: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">จำนวนงวด (เดือน)</label>
                <input type="number" value={editForm.totalMonths} onChange={(e) => setEditForm({ ...editForm, totalMonths: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">อัตราดอกเบี้ย (ทศนิยม เช่น 0.08)</label>
                <input type="number" step="0.01" value={editForm.interestRate} onChange={(e) => setEditForm({ ...editForm, interestRate: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">วันชำระ</label>
                <select value={editForm.paymentDueDay} onChange={(e) => setEditForm({ ...editForm, paymentDueDay: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 border border-input rounded-lg text-sm">
                  {[...Array.from({ length: 28 }, (_, i) => i + 1), 31].map((d) => (
                    <option key={d} value={d}>{d === 31 ? 'สิ้นเดือน' : `วันที่ ${d}`}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">หมายเหตุ</label>
              <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
            {editForm.sellingPrice > 0 && editForm.downPayment >= 0 && editForm.totalMonths > 0 && editForm.downPayment < editForm.sellingPrice && (() => {
              const p = editForm.sellingPrice - editForm.downPayment;
              const commPct = contract.interestConfig ? parseFloat(contract.interestConfig.storeCommissionPct || '0.10') : 0.10;
              const vPct = contract.interestConfig ? parseFloat(contract.interestConfig.vatPct || '0.07') : 0.07;
              const comm = p * commPct;
              const interest = p * editForm.interestRate * editForm.totalMonths;
              const vat = (p + comm + interest) * vPct;
              const total = p + comm + interest + vat;
              const monthly = Math.ceil(total / editForm.totalMonths);
              return (
                <div className="bg-muted rounded-lg p-3 text-xs space-y-1">
                  <div>ยอดปล่อย: {p.toLocaleString()} ฿</div>
                  <div>ค่าคอมหน้าร้าน ({(commPct * 100).toFixed(0)}%): {comm.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                  <div>ดอกเบี้ยรวม: {interest.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                  <div>VAT ({(vPct * 100).toFixed(0)}%): {vat.toLocaleString(undefined, { maximumFractionDigits: 0 })} ฿</div>
                  <div className="font-semibold">ค่างวด/เดือน: {monthly.toLocaleString()} ฿</div>
                </div>
              );
            })()}
            {editForm.totalMonths <= 0 && <div className="text-xs text-red-600">จำนวนงวดต้องมากกว่า 0</div>}
            {editForm.downPayment >= editForm.sellingPrice && editForm.sellingPrice > 0 && <div className="text-xs text-red-600">เงินดาวน์ต้องน้อยกว่าราคาขาย</div>}
            {editForm.sellingPrice <= 0 && <div className="text-xs text-red-600">ราคาขายต้องมากกว่า 0</div>}
            {(editForm.paymentDueDay < 1 || (editForm.paymentDueDay > 28 && editForm.paymentDueDay !== 31)) && <div className="text-xs text-red-600">วันชำระต้องอยู่ระหว่าง 1-28 หรือสิ้นเดือน</div>}
            <div className="flex gap-2 pt-2">
              <button onClick={onCancelEditing} className="px-4 py-2 text-sm border border-input rounded-lg">ยกเลิก</button>
              <button
                onClick={onSave}
                disabled={isSaving || editForm.totalMonths <= 0 || editForm.sellingPrice <= 0 || editForm.downPayment >= editForm.sellingPrice || editForm.paymentDueDay < 1 || (editForm.paymentDueDay > 28 && editForm.paymentDueDay !== 31)}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Info label="ประเภทแผน" value="ผ่อนกับ BESTCHOICE" />
            <Info label="ราคาขาย" value={`${parseFloat(contract.sellingPrice).toLocaleString()} ฿`} />
            <Info label="เงินดาวน์" value={`${parseFloat(contract.downPayment).toLocaleString()} ฿`} />
            <Info label="ยอดปล่อย (Loan)" value={`${(parseFloat(contract.sellingPrice) - parseFloat(contract.downPayment)).toLocaleString()} ฿`} />
            <Info label="อัตราดอกเบี้ย" value={`${(parseFloat(contract.interestRate) * 100).toFixed(1)}%${contract.interestConfig ? ` (${contract.interestConfig.name})` : ''}`} />
            <Info label="ดอกเบี้ยรวม" value={`${parseFloat(contract.interestTotal).toLocaleString()} ฿`} />
            <Info label="ยอดจัดไฟแนนซ์" value={`${parseFloat(contract.financedAmount).toLocaleString()} ฿`} />
            <Info label="จำนวนงวด" value={`${contract.totalMonths} เดือน`} />
            <Info label="วันชำระ" value={contract.paymentDueDay === 31 ? 'สิ้นเดือน' : contract.paymentDueDay ? `ทุกวันที่ ${contract.paymentDueDay}` : 'วันที่ 1'} />
            <Info label="พนักงานขาย" value={contract.salesperson.name} />
            <Info label="สาขา" value={contract.branch.name} />
            <Info label="วันที่สร้าง" value={new Date(contract.createdAt).toLocaleDateString('th-TH')} />
            {contract.notes && <Info label="หมายเหตุ" value={contract.notes} />}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-foreground">ข้อมูลลูกค้า</h2>
              {contract.customerSnapshot && (
                <span className="text-2xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">ณ วันที่สร้างสัญญา</span>
              )}
            </div>
            {canEditMaster && (
              <button onClick={onEditCustomer} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                แก้ไข
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Info label="ชื่อ" value={contract.customerSnapshot?.prefix ? `${contract.customerSnapshot.prefix}${contract.customerSnapshot?.name || contract.customer.name}` : (contract.customerSnapshot?.name || contract.customer.name)} />
            <Info label="ชื่อเล่น" value={contract.customerSnapshot?.nickname || '-'} />
            <Info label="เบอร์โทร" value={contract.customerSnapshot?.phone || contract.customer.phone} />
            <Info label="อาชีพ" value={contract.customerSnapshot?.occupation || '-'} />
            {contract.customerSnapshot?.salary && <Info label="รายได้" value={`${parseFloat(contract.customerSnapshot.salary).toLocaleString()} ฿`} />}
          </div>
          <button onClick={() => navigate(`/customers/${contract.customer.id}`)} className="mt-3 text-xs text-primary hover:underline">ดูรายละเอียดลูกค้า (ข้อมูลปัจจุบัน)</button>
        </div>

        <div className="rounded-lg border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">ข้อมูลสินค้า</h2>
            {canEditMaster && (
              <button onClick={onEditProduct} className="px-3 py-1 text-xs bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200">
                แก้ไข
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Info label="สินค้า" value={`${contract.product.brand} ${contract.product.model}`} />
            <Info label="ชื่อ" value={contract.product.name} />
            {contract.product.color && <Info label="สี" value={contract.product.color} />}
            {contract.product.storage && <Info label="ความจุ" value={contract.product.storage} />}
            {contract.product.serialNumber && <Info label="S/N" value={contract.product.serialNumber} />}
            {contract.product.imeiSerial && <Info label="IMEI" value={contract.product.imeiSerial} />}
          </div>
          <button onClick={() => navigate(`/products/${contract.product.id}`)} className="mt-3 text-xs text-primary hover:underline">ดูรายละเอียดสินค้า</button>
        </div>

        {contract.contractHash && (
          <div className="rounded-lg border p-6">
            <h2 className="text-sm font-semibold text-foreground mb-2">ตรวจสอบสัญญา (QR Verify)</h2>
            <div className="text-xs text-muted-foreground mb-2">Hash: <span className="font-mono">{contract.contractHash?.slice(0, 16)}...</span></div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 bg-green-500 rounded-full"></span>
              <span className="text-xs text-green-700">สัญญาได้รับการยืนยันแล้ว</span>
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              URL: /api/contracts/{contract.id}/verify
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
