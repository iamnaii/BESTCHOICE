import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Phone } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface BranchData {
  id: string;
  name: string;
  location: string | null;
  phone: string | null;
  isPrimary: boolean;
}

export default function LiffBranches() {
  const { lineId, loading, error } = useLiffInit();

  const { data, isLoading, error: dataError } = useQuery<{ branches: BranchData[] }>({
    queryKey: ['liff-branches', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get('/line-oa/liff/branches');
      return data;
    },
    enabled: !!lineId,
  });

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (error || dataError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถโหลดข้อมูลได้</h2>
            <p className="text-muted-foreground text-sm">{error || (dataError as Error)?.message}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const branches = data?.branches || [];

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">สาขาของเรา</h1>
        <p className="text-xs opacity-80 mt-1">{branches.length} สาขา</p>
      </div>

      {/* Branch List */}
      <div className="space-y-3">
        {branches.map((branch) => (
          <Card key={branch.id}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-bold">{branch.name}</h3>
                {branch.isPrimary && (
                  <Badge variant="success" size="sm">สาขาของคุณ</Badge>
                )}
              </div>

              {branch.location && (
                <div className="flex items-start gap-2 text-sm text-muted-foreground mb-2">
                  <MapPin className="size-4 mt-0.5 shrink-0" />
                  <span>{branch.location}</span>
                </div>
              )}

              {branch.phone && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
                  <Phone className="size-4 shrink-0" />
                  <a href={`tel:${branch.phone}`} className="text-primary">{branch.phone}</a>
                </div>
              )}

              <div className="flex gap-2">
                {branch.phone && (
                  <Button variant="primary" size="sm" className="flex-1" asChild>
                    <a href={`tel:${branch.phone}`}>โทร</a>
                  </Button>
                )}
                {branch.location && (
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.name + ' ' + branch.location)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      แผนที่
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Back */}
      <div className="text-center mt-4">
        <Button variant="ghost" mode="link" className="text-primary" asChild>
          <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
            ← กลับไปดูสัญญา
          </a>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
