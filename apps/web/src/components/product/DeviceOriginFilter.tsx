export function DeviceOriginFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <select aria-label="เครื่องไทย / เครื่องนอก" value={value} onChange={e => onChange(e.target.value)} className="mb-3 rounded-lg border border-input bg-background px-3 py-2 text-sm">
    <option value="">ไทย/นอกทั้งหมด</option><option value="THAI">เครื่องไทย</option><option value="IMPORTED">เครื่องนอก</option><option value="UNKNOWN">ยังไม่ระบุ</option>
  </select>;
}
