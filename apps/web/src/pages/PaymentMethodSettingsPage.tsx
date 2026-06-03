import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, Building2, QrCode, Plus, Pencil, Trash2, Star } from 'lucide-react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { accountDisplayName } from '@/utils/accountName';

type Method = 'CASH' | 'TRANSFER' | 'QR';

interface PaymentMethodConfig {
  id: string;
  method: Method;
  accountCode: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface CoaAccount {
  code: string;
  name: string;
  /** Optional bank account number stored under "ธนาคาร — KBank ออมทรัพย์ — 2031165205" pattern. */
  accountNumber?: string;
}

const METHOD_META: Record<Method, { label: string; icon: React.ReactNode; tone: string }> = {
  CASH: {
    label: 'เงินสด',
    icon: <Banknote className="size-4" />,
    tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  },
  TRANSFER: {
    label: 'โอนธนาคาร',
    icon: <Building2 className="size-4" />,
    tone: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  },
  QR: {
    label: 'ชำระผ่าน QR',
    icon: <QrCode className="size-4" />,
    tone: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
};

/**
 * Cash account codes the wizard allows. Mirrors CASH_ACCOUNT_CODES in
 * RecordPaymentWizard so settings can never reference a code the wizard
 * would refuse to accept.
 */
const CASH_ACCOUNT_CODES = [
  '11-1101',
  '11-1102',
  '11-1103',
  '11-1201',
  '11-1202',
  '11-1203',
] as const;

export default function PaymentMethodSettingsPage() {
  useDocumentTitle('ช่องทางรับชำระ × บัญชี');
  const queryClient = useQueryClient();

  const configsQuery = useQuery<PaymentMethodConfig[]>({
    queryKey: ['payment-method-configs'],
    queryFn: async () => (await api.get('/payment-method-configs')).data,
  });

  // Use the existing chart-of-accounts endpoint (Phase A.6 grouped) to look
  // up readable names for the cash codes. Falls back to the code if missing.
  const coaQuery = useQuery<CoaAccount[]>({
    queryKey: ['coa-cash-accounts'],
    queryFn: async () => {
      const { data } = await api.get('/chart-of-accounts/grouped');
      const all: CoaAccount[] = [];
      const groups = (data?.groups ?? []) as Array<{ accounts: CoaAccount[] }>;
      for (const group of groups) {
        for (const acct of group.accounts ?? []) {
          if (CASH_ACCOUNT_CODES.includes(acct.code as (typeof CASH_ACCOUNT_CODES)[number])) {
            all.push(acct);
          }
        }
      }
      return all;
    },
  });

  const accountByCode = useMemo(() => {
    const map = new Map<string, CoaAccount>();
    (coaQuery.data ?? []).forEach((a) => map.set(a.code, a));
    return map;
  }, [coaQuery.data]);

  const grouped = useMemo(() => {
    const out: Record<Method, PaymentMethodConfig[]> = { CASH: [], TRANSFER: [], QR: [] };
    (configsQuery.data ?? []).forEach((c) => {
      if (out[c.method]) out[c.method].push(c);
    });
    return out;
  }, [configsQuery.data]);

  const [addOpen, setAddOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; data: Partial<PaymentMethodConfig> }) => {
      const { data } = await api.patch(`/payment-method-configs/${input.id}`, input.data);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payment-method-configs'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/payment-method-configs/${id}`),
    onSuccess: () => {
      toast.success('ลบรายการแล้ว');
      queryClient.invalidateQueries({ queryKey: ['payment-method-configs'] });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title="ช่องทางรับชำระ × บัญชี"
        subtitle="ตั้งค่าว่าช่องทางใดใช้บัญชีไหนได้บ้าง · เลือก default ของแต่ละช่องทาง"
        action={
          <Button onClick={() => setAddOpen(true)} className="gap-2">
            <Plus className="size-4" />
            เพิ่ม mapping
          </Button>
        }
      />

      <QueryBoundary
        isLoading={configsQuery.isLoading}
        isError={configsQuery.isError}
        error={configsQuery.error}
        onRetry={configsQuery.refetch}
      >
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <th className="text-left px-4 py-3 font-semibold">ช่องทาง</th>
                <th className="text-left px-4 py-3 font-semibold">บัญชีรับเงิน</th>
                <th className="text-center px-4 py-3 font-semibold w-20">Default</th>
                <th className="text-center px-4 py-3 font-semibold w-20">Enabled</th>
                <th className="text-right px-4 py-3 font-semibold w-32"></th>
              </tr>
            </thead>
            <tbody>
              {(['CASH', 'TRANSFER', 'QR'] as const).flatMap((method) =>
                grouped[method].map((c) => {
                  const meta = METHOD_META[method];
                  const acct = accountByCode.get(c.accountCode);
                  return (
                    <tr key={c.id} className="border-t border-border/50 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold ${meta.tone}`}
                        >
                          {meta.icon}
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="font-semibold">{acct?.name ?? c.accountCode}</span>
                          <span className="text-xs text-muted-foreground font-mono">
                            {c.accountCode}
                            {acct?.accountNumber ? ` · ${acct.accountNumber}` : ''}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() =>
                            updateMutation.mutate({ id: c.id, data: { isDefault: !c.isDefault } })
                          }
                          className="inline-flex"
                          aria-label={c.isDefault ? 'ตั้งเป็น default' : 'ไม่ใช่ default'}
                        >
                          <Star
                            className={`size-5 ${
                              c.isDefault
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-muted-foreground/40 hover:text-muted-foreground'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Switch
                          checked={c.enabled}
                          onCheckedChange={(checked) =>
                            updateMutation.mutate({ id: c.id, data: { enabled: checked } })
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPendingDeleteId(c.id)}
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                          aria-label="ลบ"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                }),
              )}
              {(configsQuery.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                    ยังไม่มี mapping — เพิ่มด้วยปุ่ม "+ เพิ่ม mapping" ด้านบน
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </QueryBoundary>

      <AddMappingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        coaAccounts={coaQuery.data ?? []}
        existing={configsQuery.data ?? []}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['payment-method-configs'] });
          setAddOpen(false);
        }}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="ลบ mapping"
        description="แน่ใจไหม? บัญชีจะหายจาก wizard ทันที (กู้คืนได้โดย OWNER)"
        confirmLabel="ลบ"
        variant="destructive"
        onConfirm={() => {
          if (pendingDeleteId) deleteMutation.mutate(pendingDeleteId);
          setPendingDeleteId(null);
        }}
      />
    </div>
  );
}

interface AddMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coaAccounts: CoaAccount[];
  existing: PaymentMethodConfig[];
  onCreated: () => void;
}

function AddMappingDialog({ open, onOpenChange, coaAccounts, existing, onCreated }: AddMappingDialogProps) {
  const [method, setMethod] = useState<Method>('CASH');
  const [accountCode, setAccountCode] = useState<string>('');
  const [isDefault, setIsDefault] = useState(false);

  // Hide accounts already mapped to the selected method (avoids 409 from the
  // unique (method, accountCode) constraint). Soft-deleted rows are surfaced
  // by the create endpoint via undelete, so excluding only ACTIVE existing.
  const usedCodes = useMemo(
    () => new Set(existing.filter((c) => c.method === method).map((c) => c.accountCode)),
    [existing, method],
  );
  const availableAccounts = coaAccounts.filter((a) => !usedCodes.has(a.code));

  const createMutation = useMutation({
    mutationFn: async () => {
      await api.post('/payment-method-configs', {
        method,
        accountCode,
        isDefault,
      });
    },
    onSuccess: () => {
      toast.success('เพิ่ม mapping แล้ว');
      // reset
      setAccountCode('');
      setIsDefault(false);
      onCreated();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="size-4" />
            เพิ่ม mapping ใหม่
          </DialogTitle>
          <DialogDescription>เลือกช่องทางและบัญชีที่ต้องการผูกกัน</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>ช่องทาง</Label>
            <Select value={method} onValueChange={(v) => { setMethod(v as Method); setAccountCode(''); }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">เงินสด</SelectItem>
                <SelectItem value="TRANSFER">โอนธนาคาร</SelectItem>
                <SelectItem value="QR">ชำระผ่าน QR</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>บัญชีรับเงิน</Label>
            <Select value={accountCode} onValueChange={setAccountCode}>
              <SelectTrigger>
                <SelectValue placeholder="เลือกบัญชี" />
              </SelectTrigger>
              <SelectContent>
                {availableAccounts.map((a) => (
                  <SelectItem key={a.code} value={a.code}>
                    {accountDisplayName(a.name)}
                  </SelectItem>
                ))}
                {availableAccounts.length === 0 && (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    ไม่มีบัญชีให้เลือก — ผูกครบทุกบัญชีกับ {METHOD_META[method].label} แล้ว
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="is-default"
              checked={isDefault}
              onCheckedChange={(checked) => setIsDefault(checked === true)}
            />
            <Label htmlFor="is-default" className="cursor-pointer text-sm">
              ตั้งเป็น default ของช่องทางนี้
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!accountCode || createMutation.isPending}
          >
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
