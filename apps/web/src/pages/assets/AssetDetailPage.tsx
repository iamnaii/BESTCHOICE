// Asset module — Phase 1 detail page
// Read-only summary + action menu (DRAFT: edit/post/delete · POSTED: transfer/reverse · all: copy)
// + transfer history timeline + audit trail sidebar.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  MoreVertical,
  Edit,
  Copy,
  ArrowRightLeft,
  Undo2,
  Trash2,
  CheckSquare,
  TrendingDown,
  History,
  ReceiptText,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import QueryBoundary from '@/components/QueryBoundary';
import { formatDateShortThai, formatDateTime, formatNumberDecimal } from '@/utils/formatters';
import { getErrorMessage } from '@/lib/api';
import { assetsApi } from './api';
import { AssetStatusBadge } from './components/AssetStatusBadge';
import { ReverseAssetDialog } from './components/ReverseAssetDialog';
import { ReverseDisposalDialog } from './components/ReverseDisposalDialog';
import { TransferAssetDialog } from './components/TransferAssetDialog';
import { CATEGORY_LABEL } from './types';

const fmt = (n: string | number | null | undefined): string =>
  n == null ? '-' : formatNumberDecimal(Number(n));

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.getOne(id!),
    enabled: !!id,
  });

  const auditQuery = useQuery({
    queryKey: ['asset-audit', id],
    queryFn: () => assetsApi.getAudit(id!),
    enabled: !!id,
  });

  const [showReverse, setShowReverse] = useState(false);
  const [showReverseDisposal, setShowReverseDisposal] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showInvoiceReceived, setShowInvoiceReceived] = useState(false);

  const reverseMutation = useMutation({
    mutationFn: (reason: string) => assetsApi.reverse(id!, reason),
    onSuccess: (r) => {
      toast.success(`กลับรายการแล้ว → ${r.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['asset-audit', id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setShowReverse(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const reverseDisposeMutation = useMutation({
    mutationFn: (reason: string) => assetsApi.reverseDispose(id!, reason),
    onSuccess: (r) => {
      toast.success(`คืนสถานะแล้ว → ${r.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['asset-audit', id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setShowReverseDisposal(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const transferMutation = useMutation({
    mutationFn: (payload: Parameters<typeof assetsApi.transfer>[1]) =>
      assetsApi.transfer(id!, payload),
    onSuccess: () => {
      toast.success('โอนสินทรัพย์แล้ว');
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['asset-audit', id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      setShowTransfer(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const copyMutation = useMutation({
    mutationFn: () => assetsApi.copy(id!),
    onSuccess: (a) => {
      toast.success(`คัดลอกเป็น ${a.assetCode}`);
      navigate(`/assets/${a.id}/edit`);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => assetsApi.delete(id!),
    onSuccess: () => {
      toast.success('ลบแล้ว');
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
      navigate('/assets');
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const postMutation = useMutation({
    mutationFn: () => assetsApi.post(id!),
    onSuccess: (r) => {
      toast.success(`POST แล้ว → ${r.entryNo}`);
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['asset-audit', id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-summary'] });
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const invoiceReceivedMutation = useMutation({
    mutationFn: () => assetsApi.markInvoiceReceived(id!),
    onSuccess: (r) => {
      toast.success(`บันทึกใบกำกับและโอน 11-4102 → 11-4101 แล้ว (${r.entryNo})`);
      queryClient.invalidateQueries({ queryKey: ['asset', id] });
      queryClient.invalidateQueries({ queryKey: ['asset-audit', id] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      queryClient.invalidateQueries({ queryKey: ['assets-journal'] });
      setShowInvoiceReceived(false);
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  const asset = assetQuery.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={asset?.assetCode ?? 'กำลังโหลด...'}
        subtitle={asset?.name}
        onBack={() => navigate('/assets')}
        badge={asset && <AssetStatusBadge status={asset.status} />}
        action={
          asset && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" mode="icon" aria-label="เมนู">
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {asset.status === 'DRAFT' && (
                  <>
                    <DropdownMenuItem onClick={() => navigate(`/assets/${id}/edit`)}>
                      <Edit className="mr-2 size-4" /> แก้ไข
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => postMutation.mutate()}
                      disabled={postMutation.isPending}
                    >
                      <CheckSquare className="mr-2 size-4" /> ลงบัญชี (POST)
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setShowDelete(true)}
                      className="text-destructive"
                    >
                      <Trash2 className="mr-2 size-4" /> ลบ
                    </DropdownMenuItem>
                  </>
                )}
                {asset.status === 'POSTED' && (
                  <>
                    {asset.vatAccount === '11-4102' && !asset.invoiceReceivedAt && (
                      <DropdownMenuItem onClick={() => setShowInvoiceReceived(true)}>
                        <ReceiptText className="mr-2 size-4" /> ใบกำกับมาถึงแล้ว
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onClick={() => setShowTransfer(true)}>
                      <ArrowRightLeft className="mr-2 size-4" /> โอนผู้ดูแล/ที่ตั้ง
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate(`/assets/${id}/dispose`)}>
                      <Trash2 className="mr-2 size-4" /> จำหน่ายสินทรัพย์
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setShowReverse(true)}
                      className="text-destructive"
                    >
                      <Undo2 className="mr-2 size-4" /> กลับรายการ
                    </DropdownMenuItem>
                  </>
                )}
                {(asset.status === 'DISPOSED' || asset.status === 'WRITTEN_OFF') && (
                  <DropdownMenuItem
                    onClick={() => setShowReverseDisposal(true)}
                    className="text-destructive"
                  >
                    <Undo2 className="mr-2 size-4" /> กลับรายการจำหน่าย
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => copyMutation.mutate()}
                  disabled={copyMutation.isPending}
                >
                  <Copy className="mr-2 size-4" /> คัดลอกเป็น DRAFT ใหม่
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/assets/${id}/schedule`)}>
                  <TrendingDown className="mr-2 size-4" /> ดูตารางมูลค่าตามบัญชีสุทธิ (NBV)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/assets/${id}/audit`)}>
                  <History className="mr-2 size-4" /> ดูประวัติทั้งหมด
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <QueryBoundary
        isLoading={assetQuery.isLoading}
        isError={assetQuery.isError}
        error={assetQuery.error}
        onRetry={assetQuery.refetch}
        errorTitle="ไม่สามารถโหลดข้อมูลสินทรัพย์ได้"
      >
        {asset && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-4">
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle>{asset.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-muted-foreground">รหัส</dt>
                      <dd className="font-mono">{asset.assetCode}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Doc No.</dt>
                      <dd className="font-mono">{asset.docNo}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">หมวด</dt>
                      <dd>{CATEGORY_LABEL[asset.category]}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">สาขา</dt>
                      <dd>{asset.branch?.name ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">วันที่ซื้อ</dt>
                      <dd>{formatDateShortThai(asset.purchaseDate)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ผู้ขาย</dt>
                      <dd>{asset.supplierName ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ราคาทุน</dt>
                      <dd className="tabular-nums">{fmt(asset.purchaseCost)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">VAT</dt>
                      <dd className="tabular-nums">
                        {fmt(asset.vatAmount)}
                        {asset.hasVat && asset.vatAccount && (
                          <span
                            className={`ml-2 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              asset.vatAccount === '11-4102'
                                ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            }`}
                          >
                            {asset.vatAccount}
                            {asset.vatAccount === '11-4102' && ' รอใบกำกับ'}
                            {asset.vatAccount === '11-4101' && asset.invoiceReceivedAt && ' เครดิตได้'}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">WHT</dt>
                      <dd className="tabular-nums">{fmt(asset.whtAmount)}</dd>
                    </div>
                    {asset.invoiceReceivedAt && (
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">ใบกำกับมาถึงเมื่อ</dt>
                        <dd className="text-emerald-700 dark:text-emerald-400">
                          {formatDateTime(asset.invoiceReceivedAt)}
                          {asset.invoiceReceivedBy && ` · ${asset.invoiceReceivedBy.name}`}
                        </dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">อายุการใช้งาน</dt>
                      <dd>{asset.usefulLifeMonths} เดือน</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ค่าเสื่อม/วัน</dt>
                      <dd className="tabular-nums">{fmt(asset.dailyDepr)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ค่าเสื่อม/เดือน (เฉลี่ย)</dt>
                      <dd className="tabular-nums">{fmt(asset.monthlyDepr)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ค่าเสื่อมสะสม</dt>
                      <dd className="tabular-nums">{fmt(asset.accumulatedDepr)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">มูลค่าตามบัญชีสุทธิ (NBV)</dt>
                      <dd className="tabular-nums font-medium">{fmt(asset.netBookValue)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ผู้ดูแล</dt>
                      <dd>{asset.custodian ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">ที่ตั้ง</dt>
                      <dd>{asset.location ?? '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Serial</dt>
                      <dd className="font-mono">{asset.serialNo ?? '-'}</dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>

              {(asset.transferHistory?.length ?? 0) > 0 && (
                <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
                  <CardHeader>
                    <CardTitle>ประวัติการโอน</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-3 text-sm">
                      {asset.transferHistory!.map((h) => (
                        <li key={h.id} className="border-l-2 border-primary pl-3 py-1">
                          <div className="font-medium">
                            {formatDateShortThai(h.transferDate)} — {h.transferredBy.name}
                          </div>
                          <div className="text-muted-foreground text-xs space-y-0.5 mt-1">
                            {h.fromCustodian !== h.toCustodian && (
                              <div>
                                ผู้ดูแล: {h.fromCustodian ?? '-'} → {h.toCustodian ?? '-'}
                              </div>
                            )}
                            {h.fromLocation !== h.toLocation && (
                              <div>
                                ที่ตั้ง: {h.fromLocation ?? '-'} → {h.toLocation ?? '-'}
                              </div>
                            )}
                          </div>
                          <div className="text-xs italic text-muted-foreground mt-1">
                            {h.reason}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 text-sm">
                      <Link
                        to="/assets/transfers"
                        className="text-muted-foreground hover:text-primary underline"
                      >
                        ดูประวัติการโอนทั้งหมด →
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
                <CardHeader>
                  <CardTitle>Audit Trail</CardTitle>
                </CardHeader>
                <CardContent>
                  {auditQuery.data?.length ? (
                    <ul className="space-y-2 text-xs">
                      {auditQuery.data.map((log) => (
                        <li key={log.id} className="border-l-2 border-muted pl-2 py-0.5">
                          <div className="font-medium">{log.action}</div>
                          <div className="text-muted-foreground">
                            {log.user.name} · {formatDateTime(log.createdAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">ยังไม่มีประวัติ</p>
                  )}
                  {auditQuery.data?.length ? (
                    <Link
                      to={`/assets/${id}/audit`}
                      className="text-sm text-muted-foreground hover:text-primary underline cursor-pointer block mt-3"
                    >
                      ดูประวัติทั้งหมด →
                    </Link>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </QueryBoundary>

      {asset && (
        <>
          <ReverseAssetDialog
            open={showReverse}
            onOpenChange={setShowReverse}
            onConfirm={(reason) => reverseMutation.mutate(reason)}
            isPending={reverseMutation.isPending}
          />
          <TransferAssetDialog
            asset={asset}
            open={showTransfer}
            onOpenChange={setShowTransfer}
            onConfirm={(p) => transferMutation.mutate(p)}
            isPending={transferMutation.isPending}
          />
          <ReverseDisposalDialog
            open={showReverseDisposal}
            onOpenChange={setShowReverseDisposal}
            onConfirm={(reason) => reverseDisposeMutation.mutate(reason)}
            isPending={reverseDisposeMutation.isPending}
          />
          <ConfirmDialog
            open={showDelete}
            onOpenChange={setShowDelete}
            title="ลบสินทรัพย์?"
            description="ลบได้เฉพาะสถานะ DRAFT ไม่สามารถกู้คืนได้"
            variant="destructive"
            loading={deleteMutation.isPending}
            onConfirm={() => deleteMutation.mutate()}
          />
          <ConfirmDialog
            open={showInvoiceReceived}
            onOpenChange={setShowInvoiceReceived}
            title="บันทึกใบกำกับมาถึงแล้ว?"
            description={`โอน VAT ${fmt(asset.vatAmount)} บาท จาก 11-4102 (รอเรียกเก็บ) → 11-4101 (เครดิตได้) — ภ.พ.30 งวดถัดไปจะหักภาษีซื้อได้`}
            confirmLabel="บันทึกใบกำกับ"
            loading={invoiceReceivedMutation.isPending}
            onConfirm={() => invoiceReceivedMutation.mutate()}
          />
        </>
      )}
    </div>
  );
}
