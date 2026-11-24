import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Plus } from '@/lib/icons';
import { useDebounce } from '@/hooks/useDebounce';
import { EditPositionDialog, SeedDialog, toPositionInput, type PositionEditorState } from './PositionEditor';
import { accessQueries } from './api';
import { clonePosition } from './preview';

export function PositionsTab() {
  const positions = useQuery(accessQueries.positions);
  const catalog = useQuery(accessQueries.catalog);
  const [search, setSearch] = useState('');
  const filter = useDebounce(search.trim().toLowerCase(), 150);
  const [editor, setEditor] = useState<PositionEditorState | null>(null);
  const [seed, setSeed] = useState(false);
  const rows = positions.data ?? [];
  const ownerTemplate = catalog.data?.templates.find((template) => !template.assignable);
  const missingTemplates =
    catalog.data?.templates.filter(
      (template) => template.assignable && !rows.some((position) => position.code === template.code),
    ) ?? [];
  const reloadPositions = async () => (await positions.refetch({ throwOnError: true })).data ?? [];
  const filtered = rows.filter(({ name, code }) => `${name} ${code}`.toLowerCase().includes(filter));

  return (
    <>
      <QueryBoundary
        isLoading={positions.isPending || catalog.isPending}
        isError={positions.isError || catalog.isError}
        error={positions.error ?? catalog.error}
        onRetry={() => {
          void positions.refetch();
          void catalog.refetch();
        }}
      >
        <section className="space-y-4" aria-label="รายการตำแหน่ง">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full space-y-1.5 sm:max-w-xs">
              <Label htmlFor="access-position-search">ค้นหาตำแหน่ง</Label>
              <Input
                id="access-position-search"
                type="search"
                placeholder="ชื่อหรือรหัสตำแหน่ง"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={missingTemplates.length === 0}
                onClick={() => setSeed(true)}
              >
                เพิ่มตำแหน่งจากแม่แบบ
              </Button>
              <Button
                onClick={() => setEditor({ mode: 'create', draft: { code: '', name: '', permissions: [] } })}
              >
                <Plus aria-hidden="true" /> สร้างตำแหน่ง
              </Button>
            </div>
          </div>

          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {ownerTemplate &&
              `${ownerTemplate.name} ${ownerTemplate.code}`.toLowerCase().includes(filter) && (
                <li className="flex items-start gap-3 p-4">
                  <Lock className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div>
                    <p className="font-medium">{ownerTemplate.name}</p>
                    <p className="text-sm text-muted-foreground">สิทธิ์มาจากบัญชีเจ้าของโดยตรง</p>
                  </div>
                </li>
              )}
            {filtered.map((position) => {
              const { id, name, code, isActive, affectedEmployeeCount, permissions } = position;
              return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium break-words">{name}</p>
                      <Badge variant={isActive ? 'success' : 'secondary'}>
                        {isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground break-words">
                      {code} · {permissions.length} สิทธิ์ · {affectedEmployeeCount} คนได้รับมอบหมาย
                    </p>
                  </div>
                  {code !== 'OWNER' && (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        variant="ghost"
                        aria-label={`คัดลอก ${name}`}
                        onClick={() => setEditor({ mode: 'clone', draft: clonePosition(position, rows) })}
                      >
                        คัดลอก
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`${isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${name}`}
                        onClick={() =>
                          setEditor({ mode: 'status', position, draft: toPositionInput(position) })
                        }
                      >
                        {isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`แก้ไข ${name}`}
                        onClick={() =>
                          setEditor({ mode: 'edit', position, draft: toPositionInput(position) })
                        }
                      >
                        แก้ไข
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="p-5 text-sm text-muted-foreground">
                {filter ? 'ไม่พบตำแหน่งที่ตรงกับคำค้น' : 'ยังไม่มีตำแหน่งที่มอบหมายได้'}
              </li>
            )}
          </ul>
        </section>
      </QueryBoundary>
      {editor && catalog.data && (
        <EditPositionDialog
          initial={editor}
          positions={rows}
          catalog={catalog.data.permissions}
          reloadPositions={reloadPositions}
          onClose={() => setEditor(null)}
        />
      )}
      {seed && catalog.data && (
        <SeedDialog
          templates={missingTemplates}
          catalog={catalog.data.permissions}
          reloadPositions={reloadPositions}
          onClose={() => setSeed(false)}
        />
      )}
    </>
  );
}
