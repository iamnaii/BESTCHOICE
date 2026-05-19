import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Landmark, Wallet, Plus, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateShort } from '@/utils/formatters';
import { maskAccountNumber } from '@/utils/mask.util';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';

interface BankAccount {
  id: string;
  accountCode: string;
  accountName: string;
  bankName: string;
  accountNumber: string | null;
  accountType: 'SAVINGS' | 'CURRENT' | 'FIXED' | 'CASH';
  currency: string;
  isActive: boolean;
  notes: string | null;
  balance: string;
}

interface JournalLineRow {
  id: string;
  debit: string;
  credit: string;
  description: string | null;
  journalEntry: {
    id: string;
    entryNumber: string;
    entryDate: string;
    description: string;
    referenceType: string | null;
    referenceId: string | null;
  };
}

interface AccountDetail extends BankAccount {
  recentTransactions: JournalLineRow[];
}

interface TransactionPage {
  data: JournalLineRow[];
  total: number;
  page: number;
  limit: number;
}

function formatBalance(amount: string | number): string {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!isFinite(n)) return '0.00';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function accountTypeLabel(type: BankAccount['accountType']): string {
  switch (type) {
    case 'CASH':
      return 'เงินสด';
    case 'SAVINGS':
      return 'ออมทรัพย์';
    case 'CURRENT':
      return 'กระแสรายวัน';
    case 'FIXED':
      return 'ฝากประจำ';
    default:
      return type;
  }
}

interface AccountCardProps {
  account: BankAccount;
  onClick: () => void;
}

function AccountCard({ account, onClick }: AccountCardProps) {
  const Icon = account.accountType === 'CASH' ? Wallet : Landmark;
  const balance = parseFloat(account.balance);
  const balanceClass = balance >= 0 ? 'text-foreground' : 'text-destructive';
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg border border-border bg-card p-5 hover:bg-accent hover:shadow-sm transition-colors w-full focus:outline-none focus:ring-2 focus:ring-primary"
      aria-label={`เปิดรายละเอียดบัญชี ${account.accountName}`}
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="size-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-muted-foreground">{account.accountCode}</span>
            <Badge variant="outline" className="text-[10px]">
              {accountTypeLabel(account.accountType)}
            </Badge>
            {!account.isActive && (
              <Badge variant="secondary" className="text-[10px]">ปิดใช้งาน</Badge>
            )}
          </div>
          <h3 className="font-medium text-sm leading-snug mt-1 truncate">{account.accountName}</h3>
          <p className="text-xs text-muted-foreground leading-snug">{account.bankName}</p>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">ยอดคงเหลือ</p>
        <p className={`text-2xl font-semibold leading-snug ${balanceClass}`}>
          {formatBalance(account.balance)} <span className="text-sm text-muted-foreground">{account.currency}</span>
        </p>
        {account.accountNumber && (
          <p className="font-mono text-xs text-muted-foreground">
            {maskAccountNumber(account.accountNumber)}
          </p>
        )}
      </div>
    </button>
  );
}

interface AccountDrawerProps {
  accountCode: string | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

function AccountDrawer({ accountCode, open, onOpenChange }: AccountDrawerProps) {
  const [page, setPage] = useState(1);
  const limit = 25;

  const detailQuery = useQuery({
    queryKey: ['bank-account', accountCode],
    queryFn: () => api.get<AccountDetail>(`/bank-accounts/${accountCode}`).then((r) => r.data),
    enabled: Boolean(accountCode && open),
  });

  const txQuery = useQuery({
    queryKey: ['bank-account-tx', accountCode, page, limit],
    queryFn: () =>
      api
        .get<TransactionPage>(`/bank-accounts/${accountCode}/transactions`, {
          params: { page, limit },
        })
        .then((r) => r.data),
    enabled: Boolean(accountCode && open),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="leading-snug">
            {detailQuery.data ? detailQuery.data.accountName : 'รายละเอียดบัญชี'}
          </SheetTitle>
          {detailQuery.data && (
            <SheetDescription className="leading-snug">
              {detailQuery.data.accountCode} - {detailQuery.data.bankName}
            </SheetDescription>
          )}
        </SheetHeader>

        <QueryBoundary
          isLoading={detailQuery.isLoading}
          isError={detailQuery.isError}
          error={detailQuery.error}
          onRetry={detailQuery.refetch}
        >
          {detailQuery.data && (
            <div className="space-y-5 mt-4" data-testid="account-drawer-content">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground leading-snug">
                    ยอดคงเหลือปัจจุบัน
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold leading-snug">
                    {formatBalance(detailQuery.data.balance)}{' '}
                    <span className="text-sm text-muted-foreground">
                      {detailQuery.data.currency}
                    </span>
                  </p>
                  {detailQuery.data.accountNumber && (
                    <p className="font-mono text-xs text-muted-foreground mt-2">
                      เลขบัญชี: {maskAccountNumber(detailQuery.data.accountNumber)}
                    </p>
                  )}
                </CardContent>
              </Card>

              <div>
                <h3 className="font-medium text-sm leading-snug mb-3">รายการเดินบัญชี</h3>
                <QueryBoundary
                  isLoading={txQuery.isLoading}
                  isError={txQuery.isError}
                  error={txQuery.error}
                  onRetry={txQuery.refetch}
                >
                  {txQuery.data && (
                    <>
                      {txQuery.data.data.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-8 leading-snug">
                          ยังไม่มีรายการเดินบัญชี
                        </p>
                      ) : (
                        <div className="border border-border rounded-md divide-y divide-border">
                          {txQuery.data.data.map((tx) => (
                            <div key={tx.id} className="p-3 text-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <p className="font-mono text-xs text-muted-foreground">
                                    {tx.journalEntry.entryNumber}
                                  </p>
                                  <p className="leading-snug">
                                    {tx.journalEntry.description}
                                  </p>
                                  <p className="text-xs text-muted-foreground leading-snug">
                                    {formatDateShort(tx.journalEntry.entryDate)}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  {parseFloat(tx.debit) > 0 && (
                                    <p className="text-sm font-medium text-emerald-600">
                                      +{formatBalance(tx.debit)}
                                    </p>
                                  )}
                                  {parseFloat(tx.credit) > 0 && (
                                    <p className="text-sm font-medium text-destructive">
                                      -{formatBalance(tx.credit)}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {txQuery.data.total > limit && (
                        <div className="flex items-center justify-between mt-4 text-sm">
                          <p className="text-muted-foreground">
                            หน้า {txQuery.data.page} /{' '}
                            {Math.ceil(txQuery.data.total / txQuery.data.limit)}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={page <= 1}
                              onClick={() => setPage((p) => Math.max(1, p - 1))}
                            >
                              ก่อนหน้า
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={page >= Math.ceil(txQuery.data.total / limit)}
                              onClick={() => setPage((p) => p + 1)}
                            >
                              ถัดไป
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </QueryBoundary>
              </div>
            </div>
          )}
        </QueryBoundary>
      </SheetContent>
    </Sheet>
  );
}

interface AddDialogProps {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

function AddBankAccountDialog({ open, onOpenChange }: AddDialogProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    accountCode: '',
    accountName: '',
    bankName: '',
    accountNumber: '',
    accountType: 'SAVINGS' as BankAccount['accountType'],
  });

  const createMutation = useMutation({
    mutationFn: (payload: typeof form) => api.post('/bank-accounts', payload).then((r) => r.data),
    onSuccess: () => {
      toast.success('เพิ่มบัญชีสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
      onOpenChange(false);
      setForm({
        accountCode: '',
        accountName: '',
        bankName: '',
        accountNumber: '',
        accountType: 'SAVINGS',
      });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="leading-snug">เพิ่มบัญชีเงินสด/ธนาคาร</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate(form);
          }}
        >
          <div>
            <Label htmlFor="accountCode">รหัสบัญชี (CoA)</Label>
            <Input
              id="accountCode"
              placeholder="11-1204"
              value={form.accountCode}
              onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))}
              required
              pattern="\d{2}-\d{4}"
            />
            <p className="text-xs text-muted-foreground mt-1 leading-snug">
              ต้องเริ่มด้วย 11-11 (เงินสด) หรือ 11-12 (ธนาคาร) และมีอยู่ในผังบัญชี
            </p>
          </div>
          <div>
            <Label htmlFor="accountName">ชื่อบัญชี</Label>
            <Input
              id="accountName"
              value={form.accountName}
              onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label htmlFor="bankName">ธนาคาร</Label>
            <Input
              id="bankName"
              value={form.bankName}
              onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
              required
            />
          </div>
          <div>
            <Label htmlFor="accountNumber">เลขที่บัญชี (ไม่บังคับ)</Label>
            <Input
              id="accountNumber"
              value={form.accountNumber}
              onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
            />
          </div>
          <div>
            <Label>ประเภทบัญชี</Label>
            <Select
              value={form.accountType}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, accountType: v as BankAccount['accountType'] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SAVINGS">ออมทรัพย์</SelectItem>
                <SelectItem value="CURRENT">กระแสรายวัน</SelectItem>
                <SelectItem value="FIXED">ฝากประจำ</SelectItem>
                <SelectItem value="CASH">เงินสด</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                'บันทึก'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BankAccountsPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';

  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const listQuery = useQuery({
    queryKey: ['bank-accounts', activeOnly],
    queryFn: () =>
      api
        .get<BankAccount[]>('/bank-accounts', { params: { active: activeOnly ? 'true' : undefined } })
        .then((r) => r.data),
  });

  const totalBalance = useMemo(() => {
    if (!listQuery.data) return 0;
    return listQuery.data.reduce((sum, a) => sum + parseFloat(a.balance || '0'), 0);
  }, [listQuery.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="บัญชีเงินสดและธนาคาร"
        subtitle="ภาพรวมยอดเงินสดและบัญชีธนาคาร (อ้างอิงผังบัญชี 11-1101..1203)"
        icon={<Landmark className="size-5" />}
        action={
          isOwner ? (
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="size-4 mr-1" /> เพิ่มบัญชี
            </Button>
          ) : undefined
        }
      />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Switch
            id="active-only"
            checked={activeOnly}
            onCheckedChange={setActiveOnly}
          />
          <Label htmlFor="active-only" className="text-sm leading-snug">
            แสดงเฉพาะบัญชีที่ใช้งาน
          </Label>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => listQuery.refetch()}
          disabled={listQuery.isFetching}
        >
          <RefreshCw className={`size-4 mr-1 ${listQuery.isFetching ? 'animate-spin' : ''}`} />
          รีเฟรช
        </Button>
      </div>

      <QueryBoundary
        isLoading={listQuery.isLoading}
        isError={listQuery.isError}
        error={listQuery.error}
        onRetry={listQuery.refetch}
      >
        {listQuery.data && (
          <>
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground leading-snug">ยอดรวมทุกบัญชี</p>
                <p className="text-3xl font-semibold leading-snug">
                  {formatBalance(totalBalance)} <span className="text-sm text-muted-foreground">THB</span>
                </p>
              </CardContent>
            </Card>

            {listQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12 leading-snug">
                ยังไม่มีบัญชีในระบบ
              </p>
            ) : (
              <div
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
                data-testid="bank-account-grid"
              >
                {listQuery.data.map((acc) => (
                  <AccountCard
                    key={acc.id}
                    account={acc}
                    onClick={() => {
                      setSelectedCode(acc.accountCode);
                      setDrawerOpen(true);
                    }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </QueryBoundary>

      <AccountDrawer
        accountCode={selectedCode}
        open={drawerOpen}
        onOpenChange={(next) => {
          setDrawerOpen(next);
          if (!next) setSelectedCode(null);
        }}
      />

      {isOwner && <AddBankAccountDialog open={addOpen} onOpenChange={setAddOpen} />}
    </div>
  );
}
