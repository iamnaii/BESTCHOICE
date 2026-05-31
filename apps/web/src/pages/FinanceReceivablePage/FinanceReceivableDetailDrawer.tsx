import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Phone } from 'lucide-react';
import {
  financeContactApi,
  financeContactKeys,
} from '@/lib/api/finance-contacts';
import { formatDateShortThai } from '@/utils/formatters';
import ContactTimeline from './ContactTimeline';
import FinanceContactLogDialog from './FinanceContactLogDialog';

interface Receivable {
  id: string;
  expectedAmount: string;
  netExpectedAmount: string;
  receivedAmount: string | null;
  status: string;
  externalFinanceCompanyId: string | null;
  financeCompany: string;
  lastContactedAt: string | null;
  lastPromisedDate: string | null;
  contactAttemptCount: number;
}

interface Props {
  receivable: Receivable | null;
  onClose: () => void;
}

export default function FinanceReceivableDetailDrawer({ receivable, onClose }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: logs = [] } = useQuery({
    queryKey: receivable ? financeContactKeys.receivableLogs(receivable.id) : ['noop'],
    queryFn: () => financeContactApi.listLogs(receivable!.id),
    enabled: !!receivable,
  });

  if (!receivable) return null;
  const outstanding = Number(receivable.netExpectedAmount) - Number(receivable.receivedAmount ?? 0);

  return (
    <>
      <Sheet open onOpenChange={(o) => !o && onClose()}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>รายการเงินรับจากไฟแนนซ์</SheetTitle>
          </SheetHeader>

          <div className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <span className="text-sm text-muted-foreground">{receivable.financeCompany}</span>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">ยอดที่คาดว่าจะรับ</span>
                  <span className="font-medium">
                    {Number(receivable.netExpectedAmount).toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {receivable.externalFinanceCompanyId && (
                  <Link
                    to={`/external-finance-companies/${receivable.externalFinanceCompanyId}`}
                    className="text-sm text-primary hover:underline"
                  >
                    ดูข้อมูลบริษัทไฟแนนซ์ →
                  </Link>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <span className="text-sm font-medium">KPI การติดตาม</span>
              </CardHeader>
              <CardContent className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-muted-foreground">ติดต่อล่าสุด</div>
                  <div className="font-medium">
                    {receivable.lastContactedAt ? formatDateShortThai(receivable.lastContactedAt) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">นัดล่าสุด</div>
                  <div className="font-medium">
                    {receivable.lastPromisedDate ? formatDateShortThai(receivable.lastPromisedDate) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">จำนวนครั้ง</div>
                  <div className="font-medium">{receivable.contactAttemptCount}</div>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between">
              <h3 className="font-medium">ประวัติการติดต่อ</h3>
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Phone className="w-4 h-4 mr-1" /> บันทึกการติดต่อ
              </Button>
            </div>
            <ContactTimeline logs={logs} />
          </div>
        </SheetContent>
      </Sheet>

      {dialogOpen && (
        <FinanceContactLogDialog
          receivableId={receivable.id}
          companyId={receivable.externalFinanceCompanyId ?? ''}
          outstanding={outstanding > 0 ? outstanding : 0}
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
