import { useRef, useState } from 'react';
import { FileText, Loader2, Plus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatThaiDateTime } from '@/lib/date';
import type { RoomCreditModel } from '../hooks/useRoomCredit';
import { CREDIT_ACCEPT, creditHeadline, hasAmount } from './credit-statement';
import { openCreditDocument } from '@/lib/credit-document';
import { toast } from 'sonner';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';

export function CreditFilePicker({ credit }: { credit?: RoomCreditModel }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={CREDIT_ACCEPT}
        multiple
        className="hidden"
        aria-label="เลือกสเตทเม้นเพื่อตรวจเครดิต"
        onChange={(event) => {
          credit?.upload(Array.from(event.target.files || []));
          event.target.value = '';
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!credit || credit.busy || credit.loading}
        onClick={() => input.current?.click()}
      >
        <Plus className="size-3.5" />
        เลือกไฟล์
      </Button>
    </>
  );
}

export default function RoomCreditCard({
  credit,
  customerId,
}: {
  credit?: RoomCreditModel;
  customerId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const { copy } = useCopyToClipboard();
  const files = credit?.files ?? [];
  const analysis = credit?.analysis;
  const current =
    analysis?.status === 'COMPLETED' &&
    files.length === analysis.fileIds.length &&
    files.every((file) => analysis.fileIds.includes(file.id));
  const result = current && !credit?.analyzing ? analysis.result : null;
  const headline = result ? creditHeadline(result) : null;
  const values: [string, unknown][] = result
    ? [
        ['เงินเข้าเฉลี่ย/เดือน', result.monthlyIncome],
        ['เงินออกเฉลี่ย/เดือน', result.monthlyExpense],
        ['ยอดคงเหลือเฉลี่ย', result.averageBalance],
        ...(expanded || !hasAmount(result.monthlyIncome)
          ? [['เงินเข้าช่วงเอกสาร', result.totalIncome] as [string, unknown]]
          : []),
        ...(expanded || !hasAmount(result.monthlyExpense)
          ? [['เงินออกช่วงเอกสาร', result.totalExpense] as [string, unknown]]
          : []),
        ...(expanded ? [['ยอดคงเหลือปลายงวด', result.balance] as [string, unknown]] : []),
      ]
    : [];
  const money = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 2 });
  return (
    <div className="space-y-2 text-xs leading-snug">
      {credit?.loading && (
        <p role="status" className="text-muted-foreground">
          กำลังโหลดเอกสาร…
        </p>
      )}
      {!files.length && !credit?.loading && (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-muted-foreground">
          <Upload className="mx-auto mb-2 size-5" />
          <p>
            ลากไฟล์จากแชทมาวางในแผงนี้
            <br />
            หรือกดปุ่มตรวจเครดิตข้างไฟล์
          </p>
          <p className="mt-2 text-[11px]">
            PDF, JPEG, PNG, GIF, WebP · ไม่เกิน 10MB/ไฟล์ · สูงสุด 10 ไฟล์
          </p>
          <p className="mt-1 text-[11px]">HEIC: แปลงเป็น JPEG ก่อนแนบ</p>
        </div>
      )}
      {!!files.length && (credit?.analyzing || (result && !expanded)) && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="size-3.5" />
          สเตทเม้น {files.length} ไฟล์
        </p>
      )}
      {!!files.length && !credit?.analyzing && (!result || expanded) && (
        <ul className="space-y-1.5">
          {files.map((file, index) => (
            <li
              key={file.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2"
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left hover:text-primary"
                onClick={() => void openCreditDocument(file.url)}
              >
                <span className="block font-semibold">Statement {index + 1}</span>
                <span className="text-[11px] text-muted-foreground">
                  {file.mimeType === 'application/pdf' ? 'PDF' : 'รูปภาพ'} ·{' '}
                  {(file.size / 1024).toFixed(0)} KB
                </span>
              </button>
              <button
                type="button"
                aria-label={`เอา Statement ${index + 1} ออก`}
                disabled={credit?.busy}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent disabled:opacity-40"
                onClick={() => credit?.remove(file.id)}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {credit?.busy && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg bg-primary/5 p-3 text-primary"
        >
          <Loader2 className="size-4 animate-spin" />
          <span>
            {credit.analyzing ? 'AI กำลังอ่านสเตทเม้น…' : 'กำลังจัดการไฟล์…'}
            <br />
            <span className="text-[11px] text-muted-foreground">
              ปิดแผงไปคุยต่อได้ ผลจะเก็บไว้กับห้องนี้
            </span>
          </span>
        </div>
      )}
      {(credit?.error || analysis?.status === 'FAILED') && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-destructive"
        >
          <p className="whitespace-pre-line">
            {credit?.error || analysis?.error || 'วิเคราะห์ไม่สำเร็จ กรุณาลองใหม่'}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={credit?.retry}>
            โหลดแผงใหม่
          </Button>
          {/ล็อกรหัส|หมดอายุ/.test(credit?.error || analysis?.error || '') && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto whitespace-normal text-left"
              onClick={async () => {
                const ok = await copy(
                  'รบกวนส่งสเตทเม้นใหม่เป็น PDF ที่ไม่ล็อกรหัส หรือรูปภาพที่อ่านได้ชัดเจนครับ',
                );
                if (ok) toast.success('คัดลอกข้อความแล้ว');
                else toast.error('คัดลอกไม่สำเร็จ');
              }}
            >
              คัดลอกข้อความขอไฟล์ใหม่
            </Button>
          )}
        </div>
      )}
      {result && (
        <>
          {headline && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-3">
              <p className="text-muted-foreground">{headline.label}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                {money(headline.amount)} <span className="text-xs font-normal">บาท</span>
              </p>
            </div>
          )}
          {(result.bankName || result.dateRange) && (
            <p className="text-muted-foreground">
              {[result.bankName, result.dateRange].filter(Boolean).join(' · ')}
            </p>
          )}
          <dl className="grid grid-cols-2 gap-2">
            {values
              .filter(([, value]) => hasAmount(value))
              .map(([label, value]) => (
                <div key={label} className="rounded-md bg-muted/50 p-2">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-semibold tabular-nums">{money(value as number)} บาท</dd>
                </div>
              ))}
          </dl>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'ย่อรายละเอียด' : 'ดูรายละเอียด'}
          </Button>
          {expanded && (
            <div className="space-y-2 border-t border-border pt-2">
              {result.accountName && <p>ชื่อบัญชี: {result.accountName}</p>}
              {result.incomeConsistency && result.incomeConsistency !== 'unknown' && (
                <p>รายได้: {result.incomeConsistency === 'stable' ? 'สม่ำเสมอ' : 'ไม่สม่ำเสมอ'}</p>
              )}
              {!!result.positiveFactors?.length && (
                <div>
                  <p className="mb-1 font-semibold text-primary">ปัจจัยบวก</p>
                  {result.positiveFactors.map((text, index) => (
                    <p key={index}>• {text}</p>
                  ))}
                </div>
              )}
              {!!result.riskFactors?.length && (
                <div>
                  <p className="mb-1 font-semibold text-warning">ปัจจัยเสี่ยง</p>
                  {result.riskFactors.map((text, index) => (
                    <p key={index}>• {text}</p>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                AI อ่านเมื่อ {formatThaiDateTime(analysis!.createdAt)} · {analysis!.fileIds.length}{' '}
                ไฟล์
              </p>
              {customerId && (
                <a className="text-primary underline" href={`/customers/${customerId}?tab=credit`}>
                  เปิดประวัติตรวจเครดิตของลูกค้า
                </a>
              )}
            </div>
          )}
        </>
      )}
      {!!files.length && (
        <Button
          type="button"
          size="sm"
          className="w-full"
          disabled={credit?.busy || credit?.loading}
          onClick={credit?.analyze}
        >
          {result
            ? `วิเคราะห์อีกครั้ง (${files.length} ไฟล์)`
            : `AI วิเคราะห์ (${files.length} ไฟล์)`}
        </Button>
      )}
      {!customerId && (
        <p className="text-[11px] text-muted-foreground">
          ไฟล์และผลจะเก็บไว้กับห้องนี้ และเข้าประวัติเมื่อผูกลูกค้า
        </p>
      )}
      <p className="text-center text-[11px] text-muted-foreground">
        เอกสารในแผงนี้ลูกค้าไม่เห็น · พนักงานใช้ตัวเลขประกอบการพิจารณา
      </p>
    </div>
  );
}
