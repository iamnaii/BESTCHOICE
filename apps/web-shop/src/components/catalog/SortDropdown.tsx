export function SortDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      className="border border-border rounded p-2"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="popular">ยอดนิยม</option>
      <option value="price_asc">ราคา: ต่ำ → สูง</option>
      <option value="price_desc">ราคา: สูง → ต่ำ</option>
      <option value="newest">ใหม่ล่าสุด</option>
    </select>
  );
}
