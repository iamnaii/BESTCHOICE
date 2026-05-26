import { useState } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import api from '@/lib/api';
import { lettersToExcel } from '../utils/lettersToExcel';
import type { LettersListFilters, LettersListResponse } from '../types';

interface Props {
  filters: LettersListFilters;
}

const MAX_EXPORT = 10000;

export default function ExportExcelButton({ filters }: Props) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    setBusy(true);
    try {
      const { data } = await api.get<LettersListResponse>('/overdue/letters', {
        params: { ...filters, page: 1, limit: MAX_EXPORT },
      });
      if (data.total > MAX_EXPORT) {
        toast.error('เกินจำนวนที่ export ได้ — กรุณาแคบ filter');
        return;
      }
      const blob = await lettersToExcel(data.data as any);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `letters-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.xlsx`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success(`Export ${data.data.length} แถวสำเร็จ`);
    } catch (err: any) {
      toast.error(`Export ล้มเหลว: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={handleExport} disabled={busy}>
      <Download className="size-4 mr-1" /> {busy ? 'กำลัง export...' : 'Export Excel'}
    </Button>
  );
}
