import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useRef as useReturnFocusRef } from 'react';
import { Mail, Copy, Clock } from 'lucide-react';
import { useUiFlags } from '@/hooks/useUiFlags';
import { roleLabels, inputClass, labelClass } from '../types';
import { useId as useUiFieldId } from 'react';


interface InviteForm {
  email: string;
  role: string;
  branchId: string;
}

interface InviteModalProps {
  inviteForm: InviteForm;
  setInviteForm: React.Dispatch<React.SetStateAction<InviteForm>>;
  lastInviteUrl: string | null;
  isPending: boolean;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onCopyUrl: (url: string) => void;
}

export default function InviteModal({
  inviteForm,
  setInviteForm,
  lastInviteUrl,
  isPending,
  branches,
  onClose,
  onSubmit,
  onCopyUrl,
}: InviteModalProps) {
  const uiFieldId = useUiFieldId();
  const returnFocus = useReturnFocusRef<HTMLElement | null>(null);
  // Owner Q4 (2026-05-17): VIEWER role only appears in the picker when
  // `viewer_role_enabled = 'true'`. Otherwise OWNER shouldn't be inviting
  // auditors yet — backend would deny their requests anyway.
  const { viewerRoleEnabled } = useUiFlags();
  const availableRoles = Object.entries(roleLabels).filter(
    ([k]) => k !== 'VIEWER' || viewerRoleEnabled,
  );
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined} showCloseButton={false}
        onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus(); }}
        className="flex flex-col gap-0 p-0 w-[calc(100%-1rem)] sm:max-w-2xl max-h-[calc(100dvh-1rem)] overflow-hidden">

        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-3 sm:px-6 py-4 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            กลับ
          </button>
          <DialogTitle asChild><h2 className="text-lg font-semibold text-foreground">เชิญผู้ใช้ใหม่</h2></DialogTitle>
          <div className="w-16" />
        </div>
        <div className="flex-1 overflow-y-auto p-3 sm:p-6">
          {lastInviteUrl ? (
            <div className="space-y-4">
              <div className="p-3 bg-success/5 dark:bg-success/10 border border-success/20 rounded-lg">
                <p className="text-sm font-medium text-success mb-1">สร้างคำเชิญสำเร็จ!</p>
                <p className="text-xs text-success">
                  อีเมลเชิญถูกส่งแล้ว คุณสามารถคัดลอกลิงก์ด้านล่างเพื่อส่งเองได้
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={lastInviteUrl}
                  className={`${inputClass} text-xs flex-1`}
                />
                <button
                  onClick={() => onCopyUrl(lastInviteUrl)}
                  className="shrink-0 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 flex items-center gap-1"
                >
                  <Copy className="size-3.5" />
                  คัดลอก
                </button>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                ลิงก์หมดอายุใน 24 ชั่วโมง
              </div>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label htmlFor={`${uiFieldId}-1`} className={labelClass}>อีเมล *</label>
                <input id={`${uiFieldId}-1`}
                  type="email"
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
                  required
                  className={inputClass}
                  placeholder="employee@example.com"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor={`${uiFieldId}-2`} className={labelClass}>ตำแหน่ง *</label>
                  <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${uiFieldId}-2`}
                    value={inviteForm.role}
                    onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
                    className={inputClass}
                  >
                    {availableRoles.map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div>
                  <label htmlFor={`${uiFieldId}-3`} className={labelClass}>สาขา</label>
                  <NativeSelect wrapperClassName="max-w-full w-full min-w-0" id={`${uiFieldId}-3`}
                    value={inviteForm.branchId}
                    onChange={(e) => setInviteForm({ ...inviteForm, branchId: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">ไม่ระบุ (ทุกสาขา)</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            </form>
          )}
        </div>
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-3 sm:px-6 py-4 flex justify-end gap-3 shrink-0">
          {lastInviteUrl ? (
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 font-semibold transition-colors shadow-sm"
            >
              ปิด
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={onSubmit}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm flex items-center gap-1.5"
              >
                <Mail className="size-4" />
                {isPending ? 'กำลังส่ง...' : 'ส่งคำเชิญ'}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
