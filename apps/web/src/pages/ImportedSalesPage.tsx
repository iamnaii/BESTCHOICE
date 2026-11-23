import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { formControlClass, formLabelClass } from '@/components/ui/form-styles';
import { NativeSelect } from '@/components/ui/native-select';
import ScreenTable from '@/components/ui/ScreenTable';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import api from '@/lib/api';

interface Summary {
  totals: {
    billCount: number;
    lineCount: number;
    sales: string;
    profit: string | null;
    cost: string | null;
  };
  coverage: {
    firstSoldAt: string | null;
    lastSoldAt: string | null;
    verifiedThrough: string | null;
  };
}
interface Row {
  id: string;
  barcode: string;
  orderNumber: string;
  productName: string;
  category: string;
  saleChannel: string;
  salePrice: string;
  profit: string | null;
  salespersonName: string;
  soldAt: string;
}
interface ListResp {
  data: Row[];
  total: number;
  page: number;
  limit: number;
}
const initial = { barcode: '', orderNumber: '', startDate: '', endDate: '', saleChannel: '' };
const channels = {
  CASH: 'เงินสด (ราคาปลีก)',
  INSTALLMENT: 'BESTCHOICE ไฟแนนซ์ (ราคา 2)',
  EXTERNAL_FINANCE: 'GFIN (ราคา 3)',
};
const dateTime = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Bangkok',
});

function baht(value: string | null) {
  if (value === null) return 'ไม่มีสิทธิ์ดู';
  // Decimal amounts arrive as strings. Group the integer without losing cents on large totals.
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  return `฿${value.startsWith('-') ? '-' : ''}${BigInt(whole).toLocaleString('th-TH')}.${fraction.padEnd(2, '0')}`;
}

export default function ImportedSalesPage() {
  useDocumentTitle('ยอดขายย้อนหลัง (Tooltify)');
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState<Partial<typeof initial>>({});
  const [page, setPage] = useState(1);
  const summaryQuery = useQuery({
    queryKey: ['imported-sales-summary', filters],
    queryFn: async () =>
      (await api.get<Summary>('/imported-sales/summary', { params: filters })).data,
  });
  const listQuery = useQuery({
    queryKey: ['imported-sales', filters, page],
    queryFn: async () =>
      (await api.get<ListResp>('/imported-sales', { params: { ...filters, page, limit: 50 } }))
        .data,
  });
  const summary = summaryQuery.data;
  const list = listQuery.data;
  const failed = summaryQuery.isError || listQuery.isError;
  const pending = summaryQuery.isPending || listQuery.isPending;
  const change = (key: keyof typeof initial, value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const dateError = draft.startDate && draft.endDate && draft.startDate > draft.endDate;
  return (
    <div className="min-w-0 space-y-5 p-4 md:p-6">
      <h1 className="text-2xl font-semibold text-foreground">
        ยอดขายย้อนหลัง (นำเข้าจาก Tooltify)
      </h1>
      <form
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (dateError) return;
          setFilters(
            Object.fromEntries(
              Object.entries(draft)
                .map(([key, value]) => [key, value.trim()])
                .filter(([, value]) => value),
            ),
          );
          setPage(1);
        }}
      >
        {(
          [
            ['barcode', 'บาร์โค้ด/IMEI'],
            ['orderNumber', 'เลขบิล'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key} className={formLabelClass}>
              {label}
            </label>
            <input
              id={key}
              className={formControlClass}
              value={draft[key]}
              maxLength={100}
              onChange={(e) => change(key, e.target.value)}
            />
          </div>
        ))}
        <div>
          <label htmlFor="saleChannel" className={formLabelClass}>
            ช่องทางขาย
          </label>
          <NativeSelect
            id="saleChannel"
            value={draft.saleChannel}
            onChange={(e) => change('saleChannel', e.target.value)}
          >
            <option value="">ทุกช่องทาง</option>
            {Object.entries(channels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        {(
          [
            ['startDate', 'จากวันที่'],
            ['endDate', 'ถึงวันที่'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label htmlFor={key} className={formLabelClass}>
              {label}
            </label>
            <ThaiDateInput
              id={key}
              className={formControlClass}
              value={draft[key]}
              min={key === 'endDate' ? draft.startDate : undefined}
              max={key === 'startDate' ? draft.endDate : undefined}
              onChange={(e) => change(key, e.target.value)}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" disabled={Boolean(dateError)}>
            ค้นหา
          </Button>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              setDraft(initial);
              setFilters({});
              setPage(1);
            }}
          >
            ล้างตัวกรอง
          </Button>
        </div>
        {dateError && <p role="alert">วันเริ่มต้นต้องไม่เกินวันสิ้นสุด</p>}
      </form>

      {failed ? (
        <div role="alert" className="flex items-center gap-3">
          โหลดประวัติการขายไม่สำเร็จ
          <Button
            variant="outline"
            onClick={() => {
              if (summaryQuery.isError) void summaryQuery.refetch();
              if (listQuery.isError) void listQuery.refetch();
            }}
          >
            ลองอีกครั้ง
          </Button>
        </div>
      ) : pending ? (
        <p role="status">กำลังโหลดประวัติการขาย…</p>
      ) : (
        summary &&
        list && (
          <>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {[
                ['จำนวนบิล', summary.totals.billCount.toLocaleString('th-TH')],
                ['จำนวนรายการ', summary.totals.lineCount.toLocaleString('th-TH')],
                ['ยอดขายรวม', baht(summary.totals.sales)],
                ['กำไรรวม', baht(summary.totals.profit)],
                ['ต้นทุนรวม', baht(summary.totals.cost)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-lg border border-border bg-card p-3">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="break-words text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              {(
                [
                  ['รายการแรกที่พบ', summary.coverage.firstSoldAt, 'ไม่พบรายการขาย'],
                  ['รายการล่าสุดที่พบ', summary.coverage.lastSoldAt, 'ไม่พบรายการขาย'],
                  [
                    'รับรองข้อมูลถึง',
                    summary.coverage.verifiedThrough,
                    'ยังไม่มีการรับรองช่วงที่ค้น',
                  ],
                ] as const
              ).map(([label, value, missing]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd>
                    {value ? (
                      <time dateTime={value}>{dateTime.format(new Date(value))}</time>
                    ) : (
                      missing
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {list.data.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">ไม่พบรายการ</p>
            ) : (
              <ScreenTable className="w-full text-sm" aria-label="รายการขาย Tooltify">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    {[
                      'เลขบิล',
                      'บาร์โค้ด/IMEI',
                      'สินค้า',
                      'หมวด',
                      'ช่องทาง',
                      'ราคาขาย',
                      'กำไร',
                      'คนขาย',
                      'วันที่',
                    ].map((h) => (
                      <th key={h} className="px-3 py-2 text-left">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.map((row) => (
                    <tr key={row.id} className="border-t border-border">
                      {[
                        row.orderNumber,
                        row.barcode,
                        row.productName,
                        row.category,
                        channels[row.saleChannel as keyof typeof channels] ?? row.saleChannel,
                        baht(row.salePrice),
                        baht(row.profit),
                        row.salespersonName,
                        dateTime.format(new Date(row.soldAt)),
                      ].map((value, i) => (
                        <td key={i} className="px-3 py-2 tabular-nums">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </ScreenTable>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ก่อนหน้า
              </Button>
              <span>
                หน้า {list.page} · ทั้งหมด {list.total.toLocaleString('th-TH')} รายการ
              </span>
              <Button
                variant="outline"
                disabled={page * list.limit >= list.total}
                onClick={() => setPage(page + 1)}
              >
                ถัดไป
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}
