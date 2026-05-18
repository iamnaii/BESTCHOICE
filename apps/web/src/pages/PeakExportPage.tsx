import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Download, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

/**
 * P3-SP3: PEAK export page.
 * Pick a date range (≤6 months) and download a CSV of journal lines tagged
 * with their mapped PEAK code. The response includes `X-Skipped-Lines` so we
 * can warn when accounts are present in the period but unmapped.
 */

function firstOfPreviousMonth(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  return d.toISOString().slice(0, 10);
}
function lastOfPreviousMonth(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), 0); // day 0 of this month = last of previous
  return d.toISOString().slice(0, 10);
}

export default function PeakExportPage() {
  const [startDate, setStartDate] = useState<string>(firstOfPreviousMonth());
  const [endDate, setEndDate] = useState<string>(lastOfPreviousMonth());
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<{ rowCount: number; skipped: number } | null>(null);

  const rangeError = useMemo(() => {
    if (!startDate || !endDate) return 'กรุณาเลือกช่วงวันที่';
    if (new Date(endDate) < new Date(startDate)) return 'วันที่สิ้นสุดต้องไม่อยู่ก่อนวันเริ่มต้น';
    const days = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (24 * 60 * 60 * 1000);
    if (days > 186) return 'ช่วงเวลาส่งออกต้องไม่เกิน 6 เดือนต่อครั้ง';
    return null;
  }, [startDate, endDate]);

  async function handleDownload() {
    if (rangeError) {
      toast.error(rangeError);
      return;
    }
    setBusy(true);
    try {
      const res = await api.get(
        `/expenses/journal/export-peak?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
        { responseType: 'blob' },
      );
      const blob = res.data as Blob;
      const skipped = Number(res.headers['x-skipped-lines'] ?? 0);
      const rowCount = Number(res.headers['x-row-count'] ?? 0);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `peak-journal-${startDate}_${endDate}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      setLastResult({ rowCount, skipped });
      if (skipped > 0) {
        toast.warning(`ดาวน์โหลด ${rowCount} บรรทัด — ข้าม ${skipped} บรรทัด (บัญชียังไม่จับคู่ PEAK)`);
      } else {
        toast.success(`ดาวน์โหลด ${rowCount} บรรทัดสำเร็จ`);
      }
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl">
      <PageHeader
        title="ส่งออกสมุดรายวันสำหรับ PEAK"
        subtitle="สร้างไฟล์ CSV ของรายการบันทึกบัญชีในช่วงที่เลือก พร้อมรหัสบัญชีฝั่ง PEAK เพื่อนำเข้าโปรแกรม peakaccount.com"
        icon={<FileSpreadsheet className="size-5" aria-hidden />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="leading-snug">เลือกช่วงเวลา</CardTitle>
          <CardDescription className="leading-snug">
            CSV จะรวมเฉพาะรายการที่ POSTED แล้ว และข้ามบรรทัดที่บัญชีต้นทางยังไม่ได้จับคู่รหัส PEAK
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="start-date">วันที่เริ่มต้น</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="end-date">วันที่สิ้นสุด</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          {rangeError && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden />
              <AlertDescription className="leading-snug">{rangeError}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button onClick={handleDownload} disabled={busy || !!rangeError}>
              <Download className="size-4 mr-1" aria-hidden />
              {busy ? 'กำลังดาวน์โหลด...' : 'ดาวน์โหลด CSV'}
            </Button>
          </div>

          {lastResult && (
            <Alert variant={lastResult.skipped > 0 ? 'warning' : 'success'}>
              <AlertTriangle className="size-4" aria-hidden />
              <AlertDescription className="leading-snug">
                ส่งออก <Badge variant="primary">{lastResult.rowCount}</Badge> บรรทัด
                {lastResult.skipped > 0 && (
                  <>
                    {' '}— ข้าม <Badge variant="warning">{lastResult.skipped}</Badge> บรรทัดที่บัญชียังไม่จับคู่ PEAK{' '}
                    <Link to="/settings#peak-mapping" className="underline text-primary">
                      ไปจับคู่ที่หน้าตั้งค่า
                    </Link>
                  </>
                )}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
