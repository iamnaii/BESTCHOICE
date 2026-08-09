import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface InspectionResultRow {
  id: string;
  passFail: boolean | null;
  grade: string | null;
  notes: string | null;
  templateItem: { itemName: string; category: string; sortOrder: number };
}

interface InspectionDetail {
  id: string;
  isCompleted: boolean;
  results: InspectionResultRow[];
}

/**
 * ผลตรวจ QC รายข้อ จาก GET /inspections/:id — results ไม่ถูก orderBy ที่ service
 * (inspections.service.ts findOneInspection) ดังนั้น sort ตาม templateItem.sortOrder เอง
 */
export default function QcResultsCard({ inspectionId }: { inspectionId: string }) {
  const { data } = useQuery<InspectionDetail>({
    queryKey: ['inspection', inspectionId],
    queryFn: async () => {
      const res = await api.get(`/inspections/${inspectionId}`);
      return res.data;
    },
    enabled: !!inspectionId,
    retry: false,
  });

  const results = data?.results ?? [];
  if (results.length === 0) return null;

  const sorted = [...results].sort(
    (a, b) => (a.templateItem?.sortOrder ?? 0) - (b.templateItem?.sortOrder ?? 0),
  );

  return (
    <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>ผลตรวจรายข้อ ({sorted.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5">
          {sorted.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-sm leading-snug">
              {r.passFail === false ? (
                <X className="size-4 mt-0.5 shrink-0 text-destructive" aria-label="ไม่ผ่าน" />
              ) : (
                <Check className="size-4 mt-0.5 shrink-0 text-success" aria-label="ผ่าน" />
              )}
              <span>
                <span className="text-foreground">{r.templateItem?.itemName}</span>
                <span className="text-xs text-muted-foreground"> · {r.templateItem?.category}</span>
                {r.notes && <span className="block text-xs text-muted-foreground">{r.notes}</span>}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
