import { useState } from 'react';
import { AlertTriangle, Gavel, ShieldCheck, Archive } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDunningFrequency,
  useLegalPipeline,
  useAuditSummary,
  useVoiceMemoRetention,
} from '../../hooks/useCompliance';

type CardKey = 'pdpa' | 'legal' | 'audit' | 'retention' | null;

/**
 * Compliance dashboard (P3 D2).
 * 4 cards: PDPA dunning frequency / LEGAL hearings upcoming / audit anomalies / voice memo retention.
 * Click a card → opens dialog with detail table.
 */
export default function ComplianceDashboardSection() {
  const [openCard, setOpenCard] = useState<CardKey>(null);
  const dunning = useDunningFrequency();
  const legal = useLegalPipeline();
  const audit = useAuditSummary('week');
  const retention = useVoiceMemoRetention();

  const pdpaCount = dunning.data?.rows.length ?? 0;
  const legalSoon =
    legal.data?.windows.find((w) => w.days === 7)?.count ?? 0;
  const anomalyCount = audit.data?.anomalyCount ?? 0;
  const retentionPending =
    (retention.data?.eligibleForGlacier.count ?? 0) +
    (retention.data?.eligibleForDelete.count ?? 0);

  return (
    <Card className="lg:col-span-2">
      <CardContent className="p-5">
        <div className="text-sm font-semibold mb-1 leading-snug">การกำกับดูแล (Compliance)</div>
        <div className="text-xs text-muted-foreground mb-4 leading-snug">
          PDPA · คดีความ · ตรวจสอบ · การเก็บข้อมูลเสียง
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ComplianceCard
            icon={<ShieldCheck className="h-5 w-5 text-warning" aria-hidden />}
            label="PDPA: ทวงถามถี่เกิน"
            value={dunning.isLoading ? null : pdpaCount}
            hint={
              dunning.data ? `เกณฑ์ > ${dunning.data.threshold} ครั้ง / 30 วัน` : 'กำลังโหลด...'
            }
            onClick={() => setOpenCard('pdpa')}
          />
          <ComplianceCard
            icon={<Gavel className="h-5 w-5 text-destructive" aria-hidden />}
            label="คดีนัดสืบ ≤ 7 วัน"
            value={legal.isLoading ? null : legalSoon}
            hint={
              legal.data
                ? `รวม 14 วัน ${legal.data.windows.find((w) => w.days === 14)?.count ?? 0} / 30 วัน ${legal.data.windows.find((w) => w.days === 30)?.count ?? 0}`
                : 'กำลังโหลด...'
            }
            onClick={() => setOpenCard('legal')}
          />
          <ComplianceCard
            icon={<AlertTriangle className="h-5 w-5 text-warning" aria-hidden />}
            label="Audit anomalies"
            value={audit.isLoading ? null : anomalyCount}
            hint="DENY events 7 วันที่ผ่านมา"
            onClick={() => setOpenCard('audit')}
          />
          <ComplianceCard
            icon={<Archive className="h-5 w-5 text-muted-foreground" aria-hidden />}
            label="Voice memo retention"
            value={retention.isLoading ? null : retentionPending}
            hint={
              retention.data
                ? `Glacier ${retention.data.eligibleForGlacier.count} / Delete ${retention.data.eligibleForDelete.count}`
                : 'กำลังโหลด...'
            }
            onClick={() => setOpenCard('retention')}
          />
        </div>
      </CardContent>

      <Dialog open={openCard !== null} onOpenChange={(o) => !o && setOpenCard(null)}>
        <DialogContent className="max-w-2xl">
          {openCard === 'pdpa' && (
            <DetailDialog
              title="PDPA: ลูกค้าที่ถูกทวงถามถี่เกิน"
              description={
                dunning.data
                  ? `เกณฑ์ > ${dunning.data.threshold} ครั้ง ใน 30 วันที่ผ่านมา`
                  : ''
              }
            >
              {dunning.isLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่สัญญา</TableHead>
                      <TableHead>ลูกค้า</TableHead>
                      <TableHead className="text-right">จำนวนครั้ง</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(dunning.data?.rows ?? []).map((r) => (
                      <TableRow key={r.contractId}>
                        <TableCell>{r.contractNumber ?? '-'}</TableCell>
                        <TableCell>{r.customerName ?? '-'}</TableCell>
                        <TableCell className="text-right">{r.actionCount}</TableCell>
                      </TableRow>
                    ))}
                    {(dunning.data?.rows ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground italic">
                          ยังไม่มีรายการ
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </DetailDialog>
          )}
          {openCard === 'legal' && (
            <DetailDialog
              title="คดีความที่นัดสืบในเร็วๆ นี้"
              description="คดี LEGAL ที่มีนัดสืบใน 30 วันข้างหน้า"
            >
              {legal.isLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>เลขที่สัญญา</TableHead>
                      <TableHead>เลขคดี</TableHead>
                      <TableHead>ศาล</TableHead>
                      <TableHead className="text-right">วันนัด</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(legal.data?.rows ?? []).map((r) => (
                      <TableRow key={r.contractId}>
                        <TableCell>{r.contractNumber ?? '-'}</TableCell>
                        <TableCell>{r.caseNumber}</TableCell>
                        <TableCell>{r.court}</TableCell>
                        <TableCell className="text-right">
                          อีก {r.daysUntil} วัน
                        </TableCell>
                      </TableRow>
                    ))}
                    {(legal.data?.rows ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground italic">
                          ไม่มีคดีนัดสืบในช่วงนี้
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </DetailDialog>
          )}
          {openCard === 'audit' && (
            <DetailDialog
              title="Audit summary"
              description={`สรุปกิจกรรม ${audit.data?.period === 'month' ? '30 วัน' : '7 วัน'} ที่ผ่านมา`}
            >
              {audit.isLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="space-y-4">
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">DENY events</div>
                    <div className="text-2xl font-semibold">{anomalyCount}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground mb-2">Top entities</div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Entity</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(audit.data?.actionsByType ?? []).slice(0, 10).map((r) => (
                          <TableRow key={r.entity}>
                            <TableCell>{r.entity}</TableCell>
                            <TableCell className="text-right">{r.count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </DetailDialog>
          )}
          {openCard === 'retention' && (
            <DetailDialog
              title="Voice memo retention"
              description={
                retention.data
                  ? `HOT > ${retention.data.hotDays} วัน → Glacier · > ${retention.data.deleteDays} วัน → Delete`
                  : ''
              }
            >
              {retention.isLoading ? (
                <Skeleton className="h-32" />
              ) : (
                <div className="space-y-3 text-sm leading-snug">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-muted-foreground">เข้าเงื่อนไขย้าย Glacier</span>
                    <span className="font-semibold">
                      {retention.data?.eligibleForGlacier.count ?? 0}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">เข้าเงื่อนไขลบ</span>
                    <span className="font-semibold">
                      {retention.data?.eligibleForDelete.count ?? 0}
                    </span>
                  </div>
                </div>
              )}
            </DetailDialog>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ComplianceCard({
  icon,
  label,
  value,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-3 rounded-lg border border-border bg-card hover:bg-accent transition focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div className="flex items-center gap-2 mb-1.5">{icon}</div>
      <div className="text-xs text-muted-foreground leading-snug mb-1">{label}</div>
      <div className="text-xl font-semibold leading-snug">
        {value === null ? <Skeleton className="h-7 w-12" /> : value}
      </div>
      <div className="text-[11px] text-muted-foreground leading-snug mt-1">{hint}</div>
    </button>
  );
}

function DetailDialog({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="max-h-[60vh] overflow-auto">{children}</div>
    </>
  );
}
