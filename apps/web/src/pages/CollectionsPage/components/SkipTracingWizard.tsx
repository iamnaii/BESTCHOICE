import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Phone,
  Search,
  Globe,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  UserSearch,
} from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import api from '@/lib/api';
import { useUpdateCustomerContact } from '../hooks/useUpdateCustomerContact';

const PHONE_RE = /^0[0-9]{9}$/;

interface ReferenceLike {
  prefix?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  relationship?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contract: {
    id: string;
    contractNumber: string;
    customer: { id: string; name: string; phone: string; lineIdFinance: string | null; lineIdShop: string | null };
  } | null;
}

type ResultChoice = 'FOUND' | 'NOT_FOUND' | 'MARK_LOST';

/**
 * SkipTracingWizard — 4-step dialog for tracing unreachable customers.
 *
 * Steps:
 *  1. Emergency contact — show first reference (`references[0]`) + tel: link.
 *     The schema has no dedicated `emergencyContact*` columns — we use the
 *     `references[]` Json (relatives/contacts) which is the de-facto
 *     emergency contact list captured at customer onboarding.
 *  2. Try new phone / LINE ID — input + client-side validation.
 *  3. Social media check — pre-filled Facebook search URL (manual, opens in
 *     new tab; we can't scrape FB programmatically).
 *  4. Result — radio: เจอ (input new phone) / ไม่เจอ / ติดป้าย "สูญหาย".
 *     Submission goes through `useUpdateCustomerContact` which writes the
 *     `SKIP_TRACING_UPDATE` audit log on the API side.
 */
export default function SkipTracingWizard({ open, onClose, contract }: Props) {
  const [step, setStep] = useState(1);
  const [newPhone, setNewPhone] = useState('');
  const [newLineId, setNewLineId] = useState('');
  const [resultChoice, setResultChoice] = useState<ResultChoice | null>(null);
  const [foundPhone, setFoundPhone] = useState('');
  const [reason, setReason] = useState('');
  const update = useUpdateCustomerContact();

  // Fetch the customer record so we can show the references[] array as
  // emergency contacts. The schema has no dedicated emergencyContact* columns —
  // references is the de-facto emergency contact list captured at onboarding.
  const customerQ = useQuery({
    queryKey: ['customer', contract?.customer.id, 'skip-tracing'],
    queryFn: async () => {
      const { data } = await api.get<{ references?: unknown }>(
        `/customers/${contract!.customer.id}`,
      );
      return data;
    },
    enabled: !!contract && open,
    staleTime: 30_000,
  });
  const references: ReferenceLike[] = (() => {
    const raw = customerQ.data?.references;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (r): r is ReferenceLike =>
        r !== null && typeof r === 'object' && !Array.isArray(r),
    );
  })();
  const emergency = references[0];

  // Reset wizard state whenever it reopens for a new contract.
  useEffect(() => {
    if (open) {
      setStep(1);
      setNewPhone('');
      setNewLineId('');
      setResultChoice(null);
      setFoundPhone('');
      setReason('');
    }
  }, [open, contract?.id]);

  if (!contract) return null;

  const fbSearchUrl = `https://www.facebook.com/search/people/?q=${encodeURIComponent(
    contract.customer.name,
  )}`;

  const newPhoneInvalid = newPhone.length > 0 && !PHONE_RE.test(newPhone);
  const foundPhoneInvalid = foundPhone.length > 0 && !PHONE_RE.test(foundPhone);

  function handleClose() {
    if (update.isPending) return;
    onClose();
  }

  function tryUpdate(payload: Parameters<typeof update.mutate>[0]['payload']) {
    update.mutate(
      { customerId: contract!.customer.id, payload },
      { onSuccess: () => onClose() },
    );
  }

  function handleStep2Submit() {
    if (!reason.trim()) return;
    if (newPhone && !PHONE_RE.test(newPhone)) return;
    const payload: Parameters<typeof update.mutate>[0]['payload'] = {
      reason: reason.trim(),
    };
    if (newPhone) payload.newPhone = newPhone;
    if (newLineId.trim()) payload.newLineId = newLineId.trim();
    if (!payload.newPhone && !payload.newLineId) return;
    tryUpdate(payload);
  }

  function handleResultSubmit() {
    if (!resultChoice || !reason.trim()) return;
    if (resultChoice === 'FOUND') {
      if (!foundPhone || !PHONE_RE.test(foundPhone)) return;
      tryUpdate({ newPhone: foundPhone, reason: reason.trim() });
    } else if (resultChoice === 'MARK_LOST') {
      tryUpdate({ markAsLost: true, reason: reason.trim() });
    } else {
      // NOT_FOUND — no API call, just close. (No state to persist.)
      onClose();
    }
  }

  const stepperLabels = ['ผู้ติดต่อฉุกเฉิน', 'ลองช่องทางใหม่', 'เช็ค Social', 'สรุป'];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserSearch className="size-4 text-muted-foreground" /> หาเบอร์ใหม่
          </DialogTitle>
          <DialogDescription className="leading-snug">
            {contract.contractNumber} · {contract.customer.name}
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <ol className="flex items-center justify-between gap-1 text-2xs">
          {stepperLabels.map((label, idx) => {
            const n = idx + 1;
            const active = step === n;
            const done = step > n;
            return (
              <li key={label} className="flex flex-1 items-center gap-1">
                <span
                  className={`flex size-6 items-center justify-center rounded-full border text-2xs font-medium leading-snug ${
                    done
                      ? 'border-success bg-success/10 text-success'
                      : active
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-muted text-muted-foreground'
                  }`}
                >
                  {done ? <CheckCircle2 className="size-3.5" /> : n}
                </span>
                <span
                  className={`truncate leading-snug ${
                    active ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </span>
                {n < stepperLabels.length && (
                  <span className="ml-1 hidden h-px flex-1 bg-border sm:block" />
                )}
              </li>
            );
          })}
        </ol>

        {/* Step 1 — Emergency contact */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-snug">
              ลองโทรหาผู้ติดต่อฉุกเฉินที่ลูกค้าให้ไว้ตอนเปิดสัญญา
            </p>
            {customerQ.isLoading ? (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
                กำลังโหลด...
              </div>
            ) : emergency && emergency.phone ? (
              <div className="rounded-lg border border-border bg-card p-3">
                <div className="text-2xs uppercase tracking-wide text-muted-foreground leading-snug">
                  {emergency.relationship || 'ผู้ติดต่อ'}
                </div>
                <div className="text-sm font-medium leading-snug">
                  {[emergency.prefix, emergency.firstName, emergency.lastName]
                    .filter(Boolean)
                    .join(' ') || '—'}
                </div>
                <a
                  href={`tel:${emergency.phone}`}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <Phone className="size-3.5" /> โทร emergency {emergency.phone}
                </a>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 p-4 text-center text-xs text-warning leading-snug">
                <AlertTriangle className="mx-auto mb-1 size-4" />
                ลูกค้าไม่ได้ระบุผู้ติดต่อฉุกเฉินไว้
              </div>
            )}
            {references.length > 1 && (
              <details className="rounded-lg border border-border bg-muted/30 p-2 text-xs">
                <summary className="cursor-pointer font-medium leading-snug">
                  ผู้ติดต่ออื่น ({references.length - 1})
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {references.slice(1).map((r, i) => (
                    <li key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate leading-snug">
                        {[r.firstName, r.lastName].filter(Boolean).join(' ')}{' '}
                        <span className="text-muted-foreground">
                          ({r.relationship || '—'})
                        </span>
                      </span>
                      {r.phone && (
                        <a
                          href={`tel:${r.phone}`}
                          className="inline-flex items-center gap-1 rounded border border-input px-2 py-0.5 text-2xs hover:bg-accent transition-colors"
                        >
                          <Phone className="size-3" /> {r.phone}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {/* Step 2 — try new contact */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-snug">
              ถ้ามีเบอร์/LINE ใหม่จากญาติ/ที่ทำงาน — กรอกแล้วบันทึกได้เลย
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="skip-new-phone">เบอร์ใหม่</Label>
              <Input
                id="skip-new-phone"
                inputMode="tel"
                placeholder="0XXXXXXXXX"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                maxLength={10}
              />
              {newPhoneInvalid && (
                <p className="text-2xs text-destructive leading-snug">
                  เบอร์ต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skip-new-line">LINE ID ใหม่ (ถ้ามี)</Label>
              <Input
                id="skip-new-line"
                placeholder="เช่น @johndoe"
                value={newLineId}
                onChange={(e) => setNewLineId(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="skip-reason-2">เหตุผล (จำเป็น)</Label>
              <Textarea
                id="skip-reason-2"
                placeholder="เช่น พี่สาวให้เบอร์ใหม่ / เบอร์เก่าเป็นเลขเครื่องที่ทำงาน"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
              />
            </div>
          </div>
        )}

        {/* Step 3 — Social */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-snug">
              ลองค้นหาลูกค้าใน Facebook ด้วยชื่อจริง — ถ้าเจอ ทักไปขอเบอร์ติดต่อ
            </p>
            <a
              href={fbSearchUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg border border-input bg-background p-3 hover:border-primary/40 hover:bg-accent transition-colors"
            >
              <div className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Globe className="size-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-snug">
                  ค้นหา "{contract.customer.name}" ใน Facebook
                </div>
                <div className="text-2xs text-muted-foreground leading-snug">
                  เปิดในแท็บใหม่
                </div>
              </div>
              <ExternalLink className="size-4 text-muted-foreground" />
            </a>
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-2xs text-muted-foreground leading-snug">
              <strong className="text-foreground">เคล็ดลับ:</strong> ถ้าหา Facebook ไม่เจอ
              ลองใส่ชื่อเล่น + จังหวัด หรือเช็ค LINE OpenChat กลุ่มท้องถิ่น
            </div>
          </div>
        )}

        {/* Step 4 — result */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground leading-snug">
              สรุปผลการหาเบอร์ใหม่
            </p>
            <RadioGroup
              value={resultChoice ?? ''}
              onValueChange={(v) => setResultChoice(v as ResultChoice)}
              className="space-y-1.5"
            >
              <label className="flex items-center gap-3 rounded-lg border border-input bg-background p-3 cursor-pointer hover:border-primary/40 hover:bg-accent transition-colors">
                <RadioGroupItem value="FOUND" id="result-found" />
                <CheckCircle2 className="size-4 text-success" />
                <span className="text-sm leading-snug">เจอแล้ว — ใส่เบอร์ใหม่</span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-input bg-background p-3 cursor-pointer hover:border-primary/40 hover:bg-accent transition-colors">
                <RadioGroupItem value="NOT_FOUND" id="result-notfound" />
                <Search className="size-4 text-muted-foreground" />
                <span className="text-sm leading-snug">ยังไม่เจอ — ลองอีกวันหลัง</span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-input bg-background p-3 cursor-pointer hover:border-destructive/40 hover:bg-destructive/5 transition-colors">
                <RadioGroupItem value="MARK_LOST" id="result-lost" />
                <XCircle className="size-4 text-destructive" />
                <span className="text-sm leading-snug">
                  ติดป้าย "สูญหาย" — เลิกตามแล้ว
                </span>
              </label>
            </RadioGroup>

            {resultChoice === 'FOUND' && (
              <div className="space-y-1.5">
                <Label htmlFor="skip-found-phone">เบอร์ใหม่</Label>
                <Input
                  id="skip-found-phone"
                  inputMode="tel"
                  placeholder="0XXXXXXXXX"
                  value={foundPhone}
                  onChange={(e) =>
                    setFoundPhone(e.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  maxLength={10}
                />
                {foundPhoneInvalid && (
                  <p className="text-2xs text-destructive leading-snug">
                    เบอร์ต้องเป็นเลข 10 หลัก ขึ้นต้นด้วย 0
                  </p>
                )}
              </div>
            )}

            {resultChoice && resultChoice !== 'NOT_FOUND' && (
              <div className="space-y-1.5">
                <Label htmlFor="skip-reason-4">เหตุผล (จำเป็น)</Label>
                <Textarea
                  id="skip-reason-4"
                  placeholder={
                    resultChoice === 'MARK_LOST'
                      ? 'เช่น หาทุกช่องทางแล้วไม่เจอ ผ่าน 90 วัน'
                      : 'เช่น เพื่อนสนิทให้เบอร์ใหม่'
                  }
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={500}
                  rows={2}
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => (step === 1 ? handleClose() : setStep((s) => s - 1))}
            disabled={update.isPending}
          >
            <ChevronLeft className="size-4" /> {step === 1 ? 'ยกเลิก' : 'ย้อน'}
          </Button>
          <div className="flex items-center gap-2">
            {step < 4 && step !== 2 && (
              <Button onClick={() => setStep((s) => s + 1)}>
                ถัดไป <ChevronRight className="size-4" />
              </Button>
            )}
            {step === 2 && (
              <>
                <Button
                  variant="ghost"
                  onClick={() => setStep(3)}
                  disabled={update.isPending}
                >
                  ข้าม
                </Button>
                <Button
                  onClick={handleStep2Submit}
                  disabled={
                    update.isPending ||
                    !reason.trim() ||
                    (!newPhone && !newLineId.trim()) ||
                    newPhoneInvalid
                  }
                >
                  บันทึก
                </Button>
              </>
            )}
            {step === 4 && (
              <Button
                onClick={handleResultSubmit}
                disabled={
                  update.isPending ||
                  !resultChoice ||
                  (resultChoice !== 'NOT_FOUND' && !reason.trim()) ||
                  (resultChoice === 'FOUND' && (!foundPhone || foundPhoneInvalid))
                }
                variant={resultChoice === 'MARK_LOST' ? 'destructive' : 'primary'}
              >
                {resultChoice === 'MARK_LOST'
                  ? 'ติดป้ายสูญหาย'
                  : resultChoice === 'NOT_FOUND'
                    ? 'ปิดหน้าต่าง'
                    : 'บันทึก'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
