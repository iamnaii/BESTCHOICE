import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  FileText,
  Landmark,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/lib/api';
import { equityApi, STATUS_COLORS, STATUS_LABELS, TXN_TYPE_LABELS } from '@/lib/equity';
import { formatThaiDate, formatThaiDateTime } from '@/lib/date';
import { formatNumberDecimal } from '@/utils/formatters';

const CAP_TYPES = ['CAP_INIT', 'CAP_INC', 'CAP_DEC'];

export default function EquityViewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [postConfirm, setPostConfirm] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const canPost = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';

  const q = useQuery({
    queryKey: ['equity', 'doc', id],
    queryFn: () => equityApi.findOne(id!),
    enabled: !!id,
  });
  const mc = useQuery({ queryKey: ['equity', 'mc'], queryFn: equityApi.makerCheckerEnabled });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['equity'] });
  };
  const mut = (fn: () => Promise<unknown>, ok: string) =>
    fn()
      .then((res) => {
        const w = (res as { warning?: string | null } | undefined)?.warning;
        toast.success(ok);
        if (w) toast.warning(w, { duration: 10000 });
        invalidate();
      })
      .catch((e) => toast.error(getErrorMessage(e)));

  const doc = q.data;

  return (
    <QueryBoundary isLoading={q.isLoading} isError={q.isError} error={q.error} onRetry={q.refetch}>
      {doc && (
        <div className="space-y-4">
          <PageHeader
            title={`${doc.docNumber} — ${TXN_TYPE_LABELS[doc.txnType]}`}
            icon={<Landmark size={20} />}
            action={
              <div className="flex gap-2 flex-wrap">
                <Button variant="ghost" onClick={() => navigate('/finance/equity')}>
                  <ArrowLeft className="h-4 w-4 mr-1" /> กลับ
                </Button>
                {doc.status === 'DRAFT' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => navigate(`/finance/equity/${doc.id}/edit`)}
                    >
                      <Pencil className="h-4 w-4 mr-1" /> แก้ไข
                    </Button>
                    {/* Maker-Checker query gates ส่งอนุมัติ/ลงบัญชี — ห้ามถือว่า loading/error = OFF (fail-closed) */}
                    {mc.isLoading ? null : mc.isError ? (
                      <span className="inline-flex items-center px-2 text-xs text-destructive leading-snug">
                        โหลดสถานะ Maker-Checker ไม่สำเร็จ — รีเฟรชหน้า
                      </span>
                    ) : mc.data?.enabled ? (
                      <Button onClick={() => mut(() => equityApi.submit(doc.id), 'ส่งอนุมัติแล้ว')}>
                        <Send className="h-4 w-4 mr-1" /> ส่งอนุมัติ
                      </Button>
                    ) : (
                      canPost && <Button onClick={() => setPostConfirm(true)}>ลงบัญชี</Button>
                    )}
                  </>
                )}
                {doc.status === 'READY' && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => mut(() => equityApi.withdraw(doc.id), 'ถอนกลับเป็นร่างแล้ว')}
                    >
                      ถอนกลับร่าง
                    </Button>
                    {canPost && (
                      <Button onClick={() => setPostConfirm(true)}>อนุมัติ + ลงบัญชี</Button>
                    )}
                  </>
                )}
                {doc.status === 'POSTED' && canPost && (
                  <Button variant="destructive" onClick={() => setReverseOpen(true)}>
                    <RotateCcw className="h-4 w-4 mr-1" /> กลับรายการ
                  </Button>
                )}
              </div>
            }
          />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">สถานะ</div>
                <span
                  className={`inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-medium leading-snug ${STATUS_COLORS[doc.status]}`}
                >
                  {STATUS_LABELS[doc.status]}
                </span>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">วันที่ทำรายการ</div>
                <div className="font-medium mt-1">{formatThaiDate(doc.txnDate)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">เลขที่มติ</div>
                <div className="font-mono mt-1">{doc.resolutionNo ?? '—'}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">ลงบัญชีเมื่อ</div>
                <div className="mt-1">{doc.postedAt ? formatThaiDateTime(doc.postedAt) : '—'}</div>
              </CardContent>
            </Card>
          </div>

          {doc.lines.length > 0 && (
            <Card>
              <CardHeader className="font-semibold">ผู้ถือหุ้น</CardHeader>
              <CardContent>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase">
                      <th className="py-2">ชื่อ</th>
                      <th className="text-right">จำนวนเงิน</th>
                      <th className="text-right">ส่วนเกิน</th>
                      <th className="text-right">ชำระจริง</th>
                      <th className="text-right">WHT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doc.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border">
                        <td className="py-2">{l.shareholderName}</td>
                        <td className="text-right font-mono">
                          {formatNumberDecimal(parseFloat(l.amount), 2)}
                        </td>
                        <td className="text-right font-mono">
                          {formatNumberDecimal(parseFloat(l.premium), 2)}
                        </td>
                        <td className="text-right font-mono">
                          {formatNumberDecimal(parseFloat(l.paid), 2)}
                        </td>
                        <td className="text-right font-mono">
                          {formatNumberDecimal(parseFloat(l.wht), 2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="font-semibold flex-row items-center justify-between">
              <span>
                <Paperclip className="h-4 w-4 inline mr-1" /> ไฟล์แนบ (มติที่ประชุม)
              </span>
              {(doc.status === 'DRAFT' || doc.status === 'READY') && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) mut(() => equityApi.uploadAttachment(doc.id, f), 'แนบไฟล์แล้ว');
                      e.target.value = '';
                    }}
                  />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> แนบไฟล์
                  </Button>
                </>
              )}
            </CardHeader>
            <CardContent className="space-y-2">
              {doc.attachments.length === 0 && (
                <p className="text-sm text-muted-foreground">ยังไม่มีไฟล์แนบ</p>
              )}
              {doc.attachments.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between border border-border rounded-md px-3 py-2 text-sm"
                >
                  <button
                    type="button"
                    className="flex items-center gap-2 hover:underline"
                    onClick={() =>
                      equityApi.attachmentUrl(a.id).then(({ url }) => window.open(url, '_blank'))
                    }
                  >
                    <FileText className="h-4 w-4" /> {a.filename}
                  </button>
                  {(doc.status === 'DRAFT' || doc.status === 'READY') && (
                    <button
                      type="button"
                      aria-label="ลบไฟล์แนบ"
                      className="text-destructive"
                      onClick={() =>
                        mut(() => equityApi.removeAttachment(doc.id, a.id), 'ลบไฟล์แล้ว')
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          <ConfirmDialog
            open={postConfirm}
            onOpenChange={setPostConfirm}
            title="ยืนยันลงบัญชี"
            description={`ลงบัญชี ${doc.docNumber} (${TXN_TYPE_LABELS[doc.txnType]}) — เมื่อลงแล้วแก้ไขไม่ได้ ต้องกลับรายการเท่านั้น (V11)`}
            onConfirm={() => {
              setPostConfirm(false);
              mut(() => equityApi.post(doc.id), 'ลงบัญชีแล้ว');
            }}
          />
          <ConfirmDialog
            open={reverseOpen}
            onOpenChange={setReverseOpen}
            title="กลับรายการเอกสาร"
            description={
              CAP_TYPES.includes(doc.txnType)
                ? 'คำเตือน: ธุรกรรมทุนจดทะเบียน — การกลับรายการอาจต้องแจ้งแก้ไขข้อมูลกับ DBD (กรมพัฒนาธุรกิจการค้า) ด้วย · กรอกเหตุผล ≥10 ตัวอักษร'
                : doc.txnType === 'DIV_DEC'
                  ? 'คำเตือน: ถ้ามีการจ่ายปันผล (DIV_PAY) ไปแล้ว การกลับรายการประกาศจะทำให้ 21-4104 ติดลบ — ควรกลับรายการใบจ่ายก่อน · กรอกเหตุผล ≥10 ตัวอักษร'
                  : 'กรอกเหตุผลการกลับรายการ ≥10 ตัวอักษร'
            }
            variant="destructive"
            closeOnConfirm={false}
            onConfirm={() => {
              if (reverseReason.trim().length < 10) {
                toast.error('เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร');
                return;
              }
              setReverseOpen(false);
              mut(() => equityApi.reverse(doc.id, reverseReason.trim()), 'กลับรายการแล้ว');
              setReverseReason('');
            }}
          >
            <textarea
              className="w-full border border-border rounded-md px-3 py-2 text-sm bg-background mt-2"
              rows={3}
              placeholder="เหตุผล เช่น บันทึกยอดผิด ต้องแก้ไขใหม่"
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
            />
          </ConfirmDialog>
        </div>
      )}
    </QueryBoundary>
  );
}
