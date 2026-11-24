import { useState } from 'react';
import {
  isAssignablePermissionKey,
  type DefaultAccessPosition,
  type PermissionDefinition,
  type PermissionKey,
} from '@installment/shared';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AccessEditorDialog } from './AccessEditorDialog';
import { AccessReviewDialog, PermissionChanges, SaveIssue } from './AccessReviewDialog';
import { PermissionPicker } from './PermissionPicker';
import {
  accessWrites,
  isAccessConflict,
  useAccessWrite,
  type AccessPosition,
  type PositionInput,
} from './api';
import { comparePermissions } from './preview';

export type PositionEditorState =
  | { mode: 'create' | 'clone'; draft: PositionInput }
  | { mode: 'edit' | 'status'; position: AccessPosition; draft: PositionInput };

export function toPositionInput(position: AccessPosition): PositionInput {
  return {
    code: position.code,
    name: position.name,
    permissions: position.permissions.filter(isAssignablePermissionKey),
  };
}

export function EditPositionDialog({
  initial,
  positions,
  catalog,
  reloadPositions,
  onClose,
}: {
  initial: PositionEditorState;
  positions: AccessPosition[];
  catalog: readonly PermissionDefinition[];
  reloadPositions: () => Promise<AccessPosition[]>;
  onClose: () => void;
}) {
  const [editor, setEditor] = useState(initial);
  const [review, setReview] = useState(initial.mode === 'status');
  const [validation, setValidation] = useState('');
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<unknown>(null);
  const create = useAccessWrite(accessWrites.createPosition);
  const update = useAccessWrite(accessWrites.updatePosition);
  const { mode, draft } = editor;
  const original = 'position' in editor ? editor.position : undefined;
  const mutation = original ? update : create;
  const conflict = isAccessConflict(mutation.error);
  const names = new Map(catalog.map(({ key, label }) => [key, label]));
  const permissionLabel = (key: PermissionKey) => names.get(key) ?? key;
  const nextActive = mode === 'status' ? !original?.isActive : (original?.isActive ?? true);
  const changes =
    mode === 'status'
      ? comparePermissions(
          original?.isActive ? original.permissions : [],
          nextActive ? draft.permissions : [],
        )
      : comparePermissions(original?.permissions ?? [], draft.permissions);

  async function reload() {
    setReloading(true);
    setReloadError(null);
    try {
      const latest = await reloadPositions();
      if (original) {
        const position = latest.find((row) => row.id === original.id);
        if (!position) {
          setReloadError({
            response: {
              status: 404,
              data: { message: 'ตำแหน่งนี้ถูกนำออกแล้ว คุณยังสามารถกลับไปดูร่างได้' },
            },
          });
          return;
        }
        if (mode === 'status' && position.isActive === nextActive) {
          toast.info('ตำแหน่งมีสถานะตามที่เลือกแล้ว');
          onClose();
          return;
        }
        setEditor({
          mode: mode === 'status' ? 'status' : 'edit',
          position,
          draft: toPositionInput(position),
        });
      }
      mutation.reset();
      setValidation('');
      setReview(mode === 'status');
    } catch (error) {
      setReloadError(error);
    } finally {
      setReloading(false);
    }
  }

  function change(next: Partial<PositionInput>) {
    setEditor({ ...editor, draft: { ...draft, ...next } });
    setValidation('');
  }

  function openReview() {
    if (!draft.name.trim()) return setValidation('กรุณาระบุชื่อตำแหน่ง');
    if (!original && (!/^[A-Z][A-Z0-9_]{1,63}$/.test(draft.code) || draft.code === 'OWNER')) {
      return setValidation('ใช้รหัส 2–64 ตัวอักษร ขึ้นต้นด้วยอักษรอังกฤษตัวใหญ่ และใช้ตัวเลขหรือขีดล่างได้');
    }
    if (!original && positions.some((position) => position.code === draft.code)) {
      return setValidation('รหัสตำแหน่งนี้ถูกใช้แล้ว');
    }
    mutation.reset();
    setReview(true);
  }

  async function save() {
    const name = draft.name.trim();
    try {
      if (original) {
        await update.mutateAsync({
          id: original.id,
          input: {
            expectedRevision: original.revision,
            expectedAffectedEmployeeCount: original.affectedEmployeeCount,
            ...(mode === 'status' ? { isActive: nextActive } : { name, permissions: draft.permissions }),
          },
        });
      } else {
        await create.mutateAsync({ ...draft, name });
      }
      toast.success('บันทึกตำแหน่งแล้ว');
      onClose();
    } catch {
      // The dialog presents the write error while leaving the draft intact.
    }
  }

  return (
    <AccessEditorDialog busy={mutation.isPending || reloading} onClose={onClose}>
      {review ? (
        <AccessReviewDialog
          description={
            mode === 'status'
              ? nextActive
                ? 'เปิดใช้งานตำแหน่ง'
                : 'ปิดใช้งานตำแหน่ง'
              : 'บันทึกตำแหน่งและชุดสิทธิ์'
          }
          pending={mutation.isPending}
          error={mutation.error}
          reloading={reloading}
          onReload={reload}
          cancelLabel={mode === 'status' ? 'ยกเลิก' : undefined}
          onBack={
            mode === 'status'
              ? onClose
              : () => {
                  setReview(false);
                  if (!conflict) mutation.reset();
                }
          }
          onConfirm={() => void save()}
        >
          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <p className="break-words font-medium">
              {draft.name.trim()} · {draft.code}
            </p>
            {original && draft.name.trim() !== original.name && (
              <p className="text-muted-foreground">ชื่อเดิม {original.name}</p>
            )}
            <p>พนักงานที่ได้รับมอบหมาย {original?.affectedEmployeeCount ?? 0} คน</p>
            {original && (
              <p className="text-muted-foreground">สิทธิ์ของตำแหน่งใช้ตามส่วนงานและขอบเขตของแต่ละคน</p>
            )}
          </div>
          {mode === 'status' && !nextActive && (
            <p className="rounded-lg bg-warning/10 p-3 text-warning-strong">
              สิทธิ์ที่มาจากตำแหน่งนี้จะหยุดใช้ทันทีในทุกการมอบหมาย
            </p>
          )}
          {mode === 'status' && nextActive && (
            <p className="rounded-lg bg-warning/10 p-3 text-warning-strong">
              การมอบหมายเดิมที่ยังเข้าเงื่อนไขจะได้รับสิทธิ์จากตำแหน่งนี้ทันที
            </p>
          )}
          {mode === 'edit' && !original?.isActive && <p>สิทธิ์ชุดนี้จะมีผลเมื่อเปิดใช้งานตำแหน่ง</p>}
          <PermissionChanges changes={changes} label={permissionLabel} />
          <SaveIssue error={reloadError} />
        </AccessReviewDialog>
      ) : (
        <>
          <DialogHeader>
            <DialogTitle>
              {mode === 'edit' ? 'แก้ไขตำแหน่ง' : mode === 'clone' ? 'คัดลอกตำแหน่ง' : 'สร้างตำแหน่ง'}
            </DialogTitle>
            <DialogDescription className="leading-snug">
              เลือกสิทธิ์ที่จำเป็นสำหรับหน้าที่ของตำแหน่งนี้
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-1 text-sm leading-snug">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="access-position-name">ชื่อตำแหน่ง</Label>
                <Input
                  id="access-position-name"
                  maxLength={120}
                  value={draft.name}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="access-position-code">รหัสตำแหน่ง</Label>
                <Input
                  id="access-position-code"
                  readOnly={!!original}
                  maxLength={64}
                  value={draft.code}
                  onChange={(event) => change({ code: event.target.value.toUpperCase() })}
                />
              </div>
            </div>
            <PermissionPicker
              catalog={catalog}
              value={draft.permissions}
              onChange={(permissions) => change({ permissions })}
            />
            {validation && (
              <p className="text-destructive" role="alert">
                {validation}
              </p>
            )}
            <SaveIssue error={mutation.error} reloading={reloading} onReload={reload} />
            <SaveIssue error={reloadError} />
          </DialogBody>
          <DialogFooter className="gap-2 sm:space-x-0">
            <Button variant="outline" onClick={onClose} disabled={reloading}>
              ยกเลิก
            </Button>
            <Button disabled={conflict || reloading} onClick={openReview}>
              ตรวจสอบผลกระทบ
            </Button>
          </DialogFooter>
        </>
      )}
    </AccessEditorDialog>
  );
}

export function SeedDialog({
  templates,
  catalog,
  reloadPositions,
  onClose,
}: {
  templates: DefaultAccessPosition[];
  catalog: readonly PermissionDefinition[];
  reloadPositions: () => Promise<AccessPosition[]>;
  onClose: () => void;
}) {
  const seed = useAccessWrite(accessWrites.seedTemplates);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<unknown>(null);
  const labels = new Map(catalog.map(({ key, label }) => [key, label]));

  async function reload() {
    setReloading(true);
    setReloadError(null);
    try {
      await reloadPositions();
      seed.reset();
    } catch (error) {
      setReloadError(error);
    } finally {
      setReloading(false);
    }
  }

  async function save() {
    try {
      const result = await seed.mutateAsync(undefined);
      toast.success(
        result.createdCount
          ? `เพิ่มตำแหน่งจากแม่แบบแล้ว ${result.createdCount} ตำแหน่ง`
          : 'มีตำแหน่งจากแม่แบบครบแล้ว',
      );
      onClose();
    } catch {
      // Show the write error in the open review.
    }
  }
  return (
    <AccessEditorDialog busy={seed.isPending || reloading} onClose={onClose}>
      <AccessReviewDialog
        description="เพิ่มเฉพาะแม่แบบที่ยังไม่มี และยังไม่มีพนักงานได้รับตำแหน่งใหม่"
        pending={seed.isPending}
        error={seed.error}
        reloading={reloading}
        onReload={() => void reload()}
        confirmDisabled={!templates.length}
        cancelLabel="ยกเลิก"
        onBack={onClose}
        onConfirm={() => void save()}
      >
        <p>พนักงานที่ได้รับมอบหมาย 0 คน</p>
        {!templates.length && <p>มีตำแหน่งจากแม่แบบครบแล้ว</p>}
        <ul className="space-y-2">
          {templates.map((template) => (
            <li key={template.code} className="rounded-lg border border-border p-3">
              <details>
                <summary className="cursor-pointer font-medium">
                  {template.name} · {template.permissions.length} สิทธิ์
                </summary>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {template.permissions.map((permission) => (
                    <li key={permission}>{labels.get(permission) ?? permission}</li>
                  ))}
                </ul>
              </details>
              <p className="text-muted-foreground">{template.code}</p>
            </li>
          ))}
        </ul>
        <SaveIssue error={reloadError} />
      </AccessReviewDialog>
    </AccessEditorDialog>
  );
}
