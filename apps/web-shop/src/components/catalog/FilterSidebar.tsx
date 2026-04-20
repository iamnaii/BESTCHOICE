export interface CatalogFilters {
  brand?: string;
  conditionGrade?: string;
  minPrice?: number;
  maxPrice?: number;
}

export function FilterSidebar({
  filters,
  onChange,
}: {
  filters: CatalogFilters;
  onChange: (next: CatalogFilters) => void;
}) {
  return (
    <aside className="space-y-4">
      <div>
        <h4 className="font-semibold mb-2">แบรนด์</h4>
        <select
          className="w-full border border-border rounded p-2"
          value={filters.brand ?? ''}
          onChange={(e) => onChange({ ...filters, brand: e.target.value || undefined })}
        >
          <option value="">ทั้งหมด</option>
          <option value="Apple">Apple (iPhone)</option>
        </select>
      </div>
      <div>
        <h4 className="font-semibold mb-2">สภาพเครื่อง</h4>
        {['', 'A', 'B', 'C'].map((g) => (
          <label key={g} className="flex items-center gap-2 mb-1">
            <input
              type="radio"
              name="grade"
              checked={(filters.conditionGrade ?? '') === g}
              onChange={() => onChange({ ...filters, conditionGrade: g || undefined })}
            />
            <span>{g === '' ? 'ทั้งหมด' : `Grade ${g}`}</span>
          </label>
        ))}
      </div>
      <div>
        <h4 className="font-semibold mb-2">ช่วงราคา</h4>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="ต่ำสุด"
            className="border border-border rounded p-1 w-full"
            value={filters.minPrice ?? ''}
            onChange={(e) =>
              onChange({ ...filters, minPrice: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <input
            type="number"
            placeholder="สูงสุด"
            className="border border-border rounded p-1 w-full"
            value={filters.maxPrice ?? ''}
            onChange={(e) =>
              onChange({ ...filters, maxPrice: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>
      </div>
    </aside>
  );
}
