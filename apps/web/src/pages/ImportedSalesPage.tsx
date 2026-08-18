import { useState } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';

interface Bucket { key: string; count: number; sales: string; profit: string }
interface Summary {
  totals: { count: number; sales: string; profit: string; cost: string };
  byMonth: Bucket[]; byChannel: Bucket[]; bySalesperson: Bucket[]; byCategory: Bucket[];
}
interface Row {
  id: string; barcode: string; productName: string; category: string;
  saleChannel: string; salePrice: string; profit: string; salespersonName: string; soldAt: string;
}
interface ListResp { data: Row[]; total: number; page: number; limit: number }

const baht = (s: string) => Number(s).toLocaleString('th-TH', { maximumFractionDigits: 0 });

export default function ImportedSalesPage() {
  useDocumentTitle('ยอดขายย้อนหลัง (Tooltify)');
  const [channel, setChannel] = useState('');
  const [page, setPage] = useState(1);
  const params = () => {
    const p = new URLSearchParams({ page: String(page), limit: '50' });
    if (channel) p.set('saleChannel', channel);
    return p.toString();
  };

  const { data: summary } = useQuery<Summary>({
    queryKey: ['imported-sales-summary', channel],
    queryFn: async () => (await api.get(`/imported-sales/summary?${channel ? `saleChannel=${channel}` : ''}`)).data,
  });
  const { data: list } = useQuery<ListResp>({
    queryKey: ['imported-sales', channel, page],
    queryFn: async () => (await api.get(`/imported-sales?${params()}`)).data,
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground leading-snug">ยอดขายย้อนหลัง (นำเข้าจาก Tooltify)</h1>
        <p className="text-muted-foreground text-sm leading-snug">สถิติดูอย่างเดียว — ไม่กระทบบัญชี/คอมมิชชั่น</p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { l: 'จำนวนบิล/รายการ', v: summary.totals.count.toLocaleString('th-TH') },
            { l: 'ยอดขายรวม', v: `฿${baht(summary.totals.sales)}` },
            { l: 'กำไรรวม', v: `฿${baht(summary.totals.profit)}` },
            { l: 'ต้นทุนรวม', v: `฿${baht(summary.totals.cost)}` },
          ].map((s) => (
            <div key={s.l} className="rounded-lg border border-border bg-card p-4">
              <div className="text-2xl font-semibold text-foreground">{s.v}</div>
              <div className="text-xs text-muted-foreground mt-1 leading-snug">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <select
          className="border border-border bg-background text-foreground rounded-md px-3 py-2 text-sm"
          value={channel}
          onChange={(e) => { setChannel(e.target.value); setPage(1); }}
        >
          <option value="">ทุกช่องทาง</option>
          <option value="CASH">เงินสด (ราคาปลีก)</option>
          <option value="INSTALLMENT">BESTCHOICE ไฟแนนซ์ (ราคา 2)</option>
          <option value="EXTERNAL_FINANCE">GFIN (ราคา 3)</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              {['บาร์โค้ด/IMEI', 'สินค้า', 'หมวด', 'ช่องทาง', 'ราคาขาย', 'กำไร', 'คนขาย', 'วันที่'].map((h) => (
                <th key={h} className="text-left px-3 py-2 font-medium leading-snug">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list?.data.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono text-xs text-foreground">{r.barcode}</td>
                <td className="px-3 py-2 text-foreground leading-snug">{r.productName}</td>
                <td className="px-3 py-2 text-foreground leading-snug">{r.category}</td>
                <td className="px-3 py-2 text-foreground leading-snug">{r.saleChannel}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">฿{baht(r.salePrice)}</td>
                <td className="px-3 py-2 tabular-nums text-foreground">฿{baht(r.profit)}</td>
                <td className="px-3 py-2 text-foreground leading-snug">{r.salespersonName}</td>
                <td className="px-3 py-2 text-foreground">{new Date(r.soldAt).toLocaleDateString('th-TH')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list && list.data.length === 0 && (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground leading-snug">ไม่พบรายการ</div>
        )}
      </div>

      {list && (
        <div className="flex items-center gap-3 text-sm">
          <button
            className="px-3 py-1 rounded border border-border text-foreground disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ก่อนหน้า
          </button>
          <span className="text-muted-foreground leading-snug">หน้า {list.page} · ทั้งหมด {list.total.toLocaleString('th-TH')} รายการ</span>
          <button
            className="px-3 py-1 rounded border border-border text-foreground disabled:opacity-50"
            disabled={page * list.limit >= list.total}
            onClick={() => setPage((p) => p + 1)}
          >
            ถัดไป
          </button>
        </div>
      )}
    </div>
  );
}
