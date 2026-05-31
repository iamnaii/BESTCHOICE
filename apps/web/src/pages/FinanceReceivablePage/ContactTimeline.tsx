import { Badge } from '@/components/ui/badge';
import { FinanceContactLog } from '@/lib/api/finance-contacts';
import { formatDateShortThai } from '@/utils/formatters';

const RESULT_LABEL: Record<FinanceContactLog['result'], string> = {
  ANSWERED: 'รับสาย',
  NO_ANSWER: 'ไม่รับ',
  PROMISED: 'รับปาก',
  DISPUTED: 'โต้แย้ง',
  REQUESTED_DOCS: 'ขอเอกสาร',
  OTHER: 'อื่นๆ',
};

const RESULT_TONE: Record<FinanceContactLog['result'], string> = {
  ANSWERED: 'bg-emerald-100 text-emerald-700',
  NO_ANSWER: 'bg-muted text-muted-foreground',
  PROMISED: 'bg-amber-100 text-amber-700',
  DISPUTED: 'bg-red-100 text-red-700',
  REQUESTED_DOCS: 'bg-blue-100 text-blue-700',
  OTHER: 'bg-secondary text-secondary-foreground',
};

export default function ContactTimeline({ logs }: { logs: FinanceContactLog[] }) {
  if (logs.length === 0) {
    return <p className="text-sm text-muted-foreground py-6 text-center">ยังไม่มีบันทึกการติดต่อ</p>;
  }

  return (
    <ol className="relative border-l border-border ml-3 space-y-4">
      {logs.map((log) => {
        const promiseBroken = !!log.promisedBrokenAt;
        const promiseKept = !!log.promisedKeptAt;
        return (
          <li key={log.id} className="ml-4">
            <span className="absolute -left-1.5 mt-1.5 w-3 h-3 bg-primary rounded-full" />
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{log.contactedBy.name}</span>
              <span className="text-muted-foreground">{formatDateShortThai(log.contactedAt)}</span>
              {log.contact && (
                <Badge variant="secondary">
                  คุย: {log.contact.name}{log.contact.position ? ` (${log.contact.position})` : ''}
                </Badge>
              )}
              <span className={`px-2 py-0.5 rounded text-xs ${RESULT_TONE[log.result]}`}>
                {RESULT_LABEL[log.result]}
              </span>
            </div>
            {log.notes && <p className="mt-1 text-sm text-foreground/80">{log.notes}</p>}
            {log.promisedDate && (
              <div
                className={`mt-2 inline-block px-3 py-1.5 rounded-lg text-sm ${
                  promiseBroken
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : promiseKept
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 border border-amber-200'
                }`}
              >
                {promiseKept ? '✓ นัดสำเร็จ ' : promiseBroken ? '✗ ผิดนัด ' : '⏳ นัดไว้ '}
                {formatDateShortThai(log.promisedDate)}
                {log.promisedAmount && ` • ${Number(log.promisedAmount).toLocaleString('th-TH')} บาท`}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
