import { useMemo, useState } from 'react';
import type { PermissionDefinition, PermissionKey } from '@installment/shared';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDebounce } from '@/hooks/useDebounce';
import { permissionAdvisories } from './preview';

export function PermissionPicker({
  catalog,
  value,
  onChange,
}: {
  catalog: readonly PermissionDefinition[];
  value: PermissionKey[];
  onChange: (permissions: PermissionKey[]) => void;
}) {
  const [search, setSearch] = useState('');
  const filter = useDebounce(search.trim().toLowerCase(), 150);
  const matching = useMemo(() => {
    const groups = new Map<string, PermissionDefinition[]>();
    for (const entry of catalog) {
      if (![entry.label, entry.key, entry.groupLabel].some((text) => text.toLowerCase().includes(filter)))
        continue;
      const group = groups.get(entry.groupLabel) ?? [];
      group.push(entry);
      groups.set(entry.groupLabel, group);
    }
    return [...groups];
  }, [catalog, filter]);
  const labels = new Map(catalog.map(({ key, label }) => [key, label]));
  const warnings = permissionAdvisories(value, catalog);
  const selected = new Set(value);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="access-permission-search">ค้นหาสิทธิ์</Label>
        <Badge variant="secondary">เลือกแล้ว {value.length} สิทธิ์</Badge>
      </div>
      <Input
        id="access-permission-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="ชื่อสิทธิ์หรือกลุ่มงาน"
      />
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-warning/10 p-3 text-sm text-warning-strong">
          {warnings.map(({ permission, dependency }) => (
            <li key={permission}>
              ควรตรวจสอบสิทธิ์ “{labels.get(dependency)}” เพื่อให้ใช้ “{labels.get(permission)}”
              ได้ตามขั้นตอนงาน
            </li>
          ))}
        </ul>
      )}
      <div className="max-h-72 space-y-4 overflow-y-auto overscroll-contain rounded-lg border border-border p-3 sm:max-h-[38dvh]">
        {matching.length === 0 && <p className="py-3 text-muted-foreground">ไม่พบสิทธิ์ที่ตรงกับคำค้น</p>}
        {matching.map(([group, entries]) => (
          <fieldset key={group} className="min-w-0 space-y-1">
            <legend className="mb-1 font-medium">{group}</legend>
            {entries.map((entry) => {
              const reserved = entry.ownerOnly || entry.allStaff;
              return (
                <label
                  key={entry.key}
                  className="flex min-h-9 items-start gap-2.5 rounded-md px-2 py-2 has-[:enabled]:hover:bg-muted"
                >
                  <Checkbox
                    className="mt-0.5 shrink-0"
                    disabled={reserved}
                    checked={!reserved && selected.has(entry.key)}
                    onCheckedChange={(checked) =>
                      onChange(
                        checked === true ? [...value, entry.key] : value.filter((key) => key !== entry.key),
                      )
                    }
                  />
                  <span className="min-w-0 break-words">
                    {entry.label}
                    {entry.ownerOnly && (
                      <Badge className="ms-2" variant="outline">
                        เฉพาะเจ้าของ
                      </Badge>
                    )}
                    {entry.allStaff && (
                      <Badge className="ms-2" variant="outline">
                        พนักงานทุกคนได้รับโดยอัตโนมัติ
                      </Badge>
                    )}
                    {entry.sensitive && (
                      <Badge className="ms-2" variant="warning">
                        ข้อมูลสำคัญ
                      </Badge>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))}
      </div>
    </div>
  );
}
