import { useState, type ReactNode } from 'react';
import type { PermissionKey } from '@installment/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getErrorMessage } from '@/lib/api';
import { isAccessConflict } from './api';

export function AccessReviewDialog({
  description,
  children,
  acknowledgement,
  confirmDisabled,
  pending,
  error,
  reloading,
  onReload,
  onBack,
  onConfirm,
  cancelLabel = 'กลับไปแก้ไข',
}: {
  description: string;
  children: ReactNode;
  acknowledgement?: string;
  confirmDisabled?: boolean;
  pending: boolean;
  error: unknown;
  reloading?: boolean;
  onReload?: () => void;
  onBack: () => void;
  cancelLabel?: string;
  onConfirm: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <>
      <DialogHeader>
        <DialogTitle>ตรวจสอบผลกระทบ</DialogTitle>
        <DialogDescription className="leading-snug">{description}</DialogDescription>
      </DialogHeader>
      <SaveIssue error={error} reloading={reloading} onReload={onReload} />
      <DialogBody className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-1 text-sm leading-snug">
        {children}
        {acknowledgement && (
          <label className="flex items-start gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 font-medium">
            <Checkbox
              className="mt-0.5 shrink-0"
              checked={acknowledged}
              disabled={pending}
              onCheckedChange={(checked) => setAcknowledged(checked === true)}
            />
            <span>{acknowledgement}</span>
          </label>
        )}
      </DialogBody>
      <DialogFooter className="gap-2 sm:space-x-0">
        <Button variant="outline" disabled={pending || reloading} onClick={onBack}>
          {cancelLabel}
        </Button>
        <Button
          disabled={
            pending ||
            reloading ||
            confirmDisabled ||
            isAccessConflict(error) ||
            (!!acknowledgement && !acknowledged)
          }
          onClick={onConfirm}
        >
          {pending ? 'กำลังบันทึก…' : 'ยืนยันบันทึก'}
        </Button>
      </DialogFooter>
    </>
  );
}

export function SaveIssue({
  error,
  reloading,
  onReload,
}: {
  error: unknown;
  reloading?: boolean;
  onReload?: () => void;
}) {
  if (!error) return null;
  if (isAccessConflict(error) && onReload) {
    return (
      <div
        role="alert"
        className="space-y-2 rounded-lg border border-warning/50 bg-warning/10 p-3 text-sm leading-snug"
      >
        <p>{getErrorMessage(error)}</p>
        <p>ร่างยังอยู่ คุณสามารถกลับไปดูร่างได้ การโหลดข้อมูลล่าสุดจะเปิดแบบแก้ไขจากข้อมูลล่าสุด</p>
        <Button variant="outline" disabled={reloading} onClick={onReload}>
          {reloading ? 'กำลังโหลด…' : 'โหลดข้อมูลล่าสุด'}
        </Button>
      </div>
    );
  }
  return (
    <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm leading-snug text-destructive">
      {getErrorMessage(error)}
    </p>
  );
}

export function PermissionChanges({
  changes,
  label,
}: {
  changes: { added: PermissionKey[]; removed: PermissionKey[] };
  label: (permission: PermissionKey) => string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <PermissionChange title="สิทธิ์ที่เพิ่ม" permissions={changes.added} label={label} />
      <PermissionChange title="สิทธิ์ที่นำออก" permissions={changes.removed} label={label} />
    </div>
  );
}

function PermissionChange({
  title,
  permissions,
  label,
}: {
  title: string;
  permissions: PermissionKey[];
  label: (permission: PermissionKey) => string;
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-lg border border-border bg-card p-3">
      <h3 className="mb-2 font-medium">{title}</h3>
      {permissions.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5">
          {permissions.map((permission) => (
            <li key={permission}>{label(permission)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">ไม่มี</p>
      )}
    </section>
  );
}
