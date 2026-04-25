import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, FileText } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useLegalCase,
  useCreateLegalCase,
  useUpdateLegalCase,
  useUploadLegalDocument,
  type LegalDocKind,
} from '../hooks/useLegalCase';

interface Props {
  open: boolean;
  onClose: () => void;
  contractId: string | null;
}

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const DOC_KIND_OPTIONS: Array<{ value: LegalDocKind; label: string }> = [
  { value: 'complaint', label: 'คำฟ้อง' },
  { value: 'summons', label: 'หมายเรียก' },
  { value: 'judgment', label: 'คำพิพากษา' },
  { value: 'settlement', label: 'หนังสือยอม' },
  { value: 'other', label: 'อื่นๆ' },
];

/**
 * LegalCaseDialog — create/edit/view court case for a contract (P2 Task 7).
 * Documents can be uploaded inline (PDF/JPG/PNG, max 10MB each).
 */
export default function LegalCaseDialog({ open, onClose, contractId }: Props) {
  const { data: existing, isLoading } = useLegalCase(open ? contractId : null);
  const createMut = useCreateLegalCase(contractId ?? '');
  const updateMut = useUpdateLegalCase(contractId ?? '');
  const uploadMut = useUploadLegalDocument(contractId ?? '');

  const [caseNumber, setCaseNumber] = useState('');
  const [court, setCourt] = useState('');
  const [hearingDate, setHearingDate] = useState('');
  const [lawyerName, setLawyerName] = useState('');
  const [lawyerPhone, setLawyerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [docKind, setDocKind] = useState<LegalDocKind>('complaint');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setCaseNumber(existing.caseNumber);
      setCourt(existing.court);
      setHearingDate(existing.hearingDate ? existing.hearingDate.slice(0, 10) : '');
      setLawyerName(existing.lawyerName ?? '');
      setLawyerPhone(existing.lawyerPhone ?? '');
      setNotes(existing.notes ?? '');
    } else {
      setCaseNumber('');
      setCourt('');
      setHearingDate('');
      setLawyerName('');
      setLawyerPhone('');
      setNotes('');
    }
  }, [open, existing]);

  if (!contractId) return null;

  const isEdit = !!existing;
  const submitting = createMut.isPending || updateMut.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!caseNumber.trim() || !court.trim()) {
      toast.error('กรุณาระบุเลขคดีและชื่อศาล');
      return;
    }
    const payload = {
      caseNumber: caseNumber.trim(),
      court: court.trim(),
      hearingDate: hearingDate ? new Date(hearingDate).toISOString() : undefined,
      lawyerName: lawyerName.trim() || undefined,
      lawyerPhone: lawyerPhone.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    try {
      if (isEdit) {
        await updateMut.mutateAsync(payload);
        toast.success('แก้ไขข้อมูลคดีแล้ว');
      } else {
        await createMut.mutateAsync(payload);
        toast.success('บันทึกข้อมูลคดีแล้ว');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ';
      toast.error(msg);
    }
  };

  const handleFile = async (file: File) => {
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('รองรับเฉพาะไฟล์ PDF / JPG / PNG');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('ขนาดไฟล์ต้องไม่เกิน 10 MB');
      return;
    }
    if (!isEdit) {
      toast.error('กรุณาบันทึกข้อมูลคดีก่อนแนบเอกสาร');
      return;
    }
    try {
      await uploadMut.mutateAsync({ file, kind: docKind });
      toast.success('อัปโหลดเอกสารแล้ว');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'อัปโหลดไม่สำเร็จ';
      toast.error(msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'แก้ไขข้อมูลคดี' : 'เพิ่มข้อมูลคดี'}</DialogTitle>
          <DialogDescription>
            สำหรับสัญญาที่อยู่ในชั้นศาล (LEGAL) — เก็บเลขคดี ทนาย และเอกสารหลักฐาน
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="legal-case-number">เลขคดี *</Label>
                <Input
                  id="legal-case-number"
                  value={caseNumber}
                  onChange={(e) => setCaseNumber(e.target.value)}
                  required
                  maxLength={100}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="legal-case-court">ศาล *</Label>
                <Input
                  id="legal-case-court"
                  value={court}
                  onChange={(e) => setCourt(e.target.value)}
                  required
                  maxLength={200}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="legal-case-hearing">วันนัด</Label>
                <Input
                  id="legal-case-hearing"
                  type="date"
                  value={hearingDate}
                  onChange={(e) => setHearingDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="legal-case-lawyer-phone">เบอร์ทนาย</Label>
                <Input
                  id="legal-case-lawyer-phone"
                  value={lawyerPhone}
                  onChange={(e) => setLawyerPhone(e.target.value)}
                  placeholder="0XXXXXXXXX"
                  inputMode="tel"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="legal-case-lawyer">ชื่อทนายความ</Label>
              <Input
                id="legal-case-lawyer"
                value={lawyerName}
                onChange={(e) => setLawyerName(e.target.value)}
                maxLength={200}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="legal-case-notes">หมายเหตุ</Label>
              <textarea
                id="legal-case-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-background p-2 text-sm leading-snug"
                maxLength={2000}
              />
            </div>

            {isEdit && (
              <div className="space-y-2 border-t border-border pt-4">
                <div className="text-sm font-medium leading-snug">เอกสาร</div>
                <div className="flex gap-2 items-end">
                  <div className="space-y-1 flex-1">
                    <Label htmlFor="legal-doc-kind">ประเภท</Label>
                    <select
                      id="legal-doc-kind"
                      value={docKind}
                      onChange={(e) => setDocKind(e.target.value as LegalDocKind)}
                      className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                    >
                      {DOC_KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMut.isPending}
                  >
                    {uploadMut.isPending ? (
                      <Loader2 className="size-4 mr-1 animate-spin" />
                    ) : (
                      <Upload className="size-4 mr-1" />
                    )}
                    อัปโหลด
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleFile(f);
                    }}
                  />
                </div>
                <div className="text-xs text-muted-foreground leading-snug">
                  PDF / JPG / PNG ขนาดไม่เกิน 10 MB
                </div>

                <ul className="space-y-1">
                  {(existing?.documents ?? []).map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"
                    >
                      <a
                        href={d.s3Url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 min-w-0 hover:text-primary"
                      >
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate leading-snug">{d.filename}</span>
                      </a>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {DOC_KIND_OPTIONS.find((o) => o.value === d.kind)?.label ?? d.kind}
                      </span>
                    </li>
                  ))}
                  {(existing?.documents ?? []).length === 0 && (
                    <li className="text-xs text-muted-foreground leading-snug">
                      ยังไม่มีเอกสารแนบ
                    </li>
                  )}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                ปิด
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="size-4 mr-1 animate-spin" />}
                {isEdit ? 'บันทึก' : 'เพิ่มคดี'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
