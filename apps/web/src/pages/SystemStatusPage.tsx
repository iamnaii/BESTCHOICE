import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';

interface SystemStatus {
  api: { status: string; version: string; uptime: number; nodeVersion: string };
  database: { connected: boolean; latencyMs: number; error?: string };
  ai: { configured: boolean; connected: boolean; model: string; error?: string };
  memory: { heapUsedMB: number; heapTotalMB: number; rssMB: number };
  timestamp: string;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d} วัน ${h} ชม.`;
  if (h > 0) return `${h} ชม. ${m} นาที`;
  return `${m} นาที`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex h-3 w-3 shrink-0">
      {ok && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75 print:hidden" />}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
    </span>
  );
}

/* ─── A4 Page Wrapper ─── */
function A4Page({ pageNum, totalPages, children }: { pageNum: number; totalPages: number; children: React.ReactNode }) {
  return (
    <div
      className="bg-card border border-border shadow-xs shadow-black/5 mx-auto mb-6 relative"
      style={{ width: '210mm', minHeight: '297mm', maxWidth: '100%', padding: '20mm 18mm 25mm 18mm' }}
    >
      {children}
      {/* Page number footer */}
      <div className="absolute bottom-[10mm] left-0 right-0 text-center text-xs text-muted-foreground">
        {pageNum}/{totalPages}
      </div>
    </div>
  );
}

export default function SystemStatusPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery<SystemStatus>({
    queryKey: ['system-status'],
    queryFn: async () => { const { data } = await api.get('/system-status'); return data; },
    refetchInterval: 30000,
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="สถานะระบบ" subtitle="ตรวจสอบการเชื่อมต่อ API, ฐานข้อมูล และ AI" />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="สถานะระบบ" subtitle="ตรวจสอบการเชื่อมต่อ API, ฐานข้อมูล และ AI" />
        <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center max-w-lg mx-auto mt-8">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" /></svg>
          </div>
          <p className="text-red-700 font-medium mb-1">ไม่สามารถเชื่อมต่อ API ได้</p>
          <p className="text-red-600 text-sm mb-4">{getErrorMessage(error)}</p>
          <button onClick={() => refetch()} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">ลองใหม่</button>
        </div>
      </div>
    );
  }

  const allOk = data!.api.status === 'ok' && data!.database.connected && data!.ai.connected;
  const totalPages = 2;

  return (
    <div>
      <PageHeader
        title="สถานะระบบ"
        subtitle="ตรวจสอบการเชื่อมต่อ API, ฐานข้อมูล และ AI"
        action={
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted/50 disabled:opacity-50 flex items-center gap-2 print:hidden"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            รีเฟรช
          </button>
        }
      />

      {/* ═══════════════════ Page 1: Connection Diagram ═══════════════════ */}
      <A4Page pageNum={1} totalPages={totalPages}>
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-foreground">รายงานสถานะระบบ</h1>
          <p className="text-sm text-muted-foreground mt-1">
            วันที่: {new Date(data!.timestamp).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}
            {' '}เวลา: {new Date(data!.timestamp).toLocaleTimeString('th-TH')}
          </p>
        </div>

        {/* Overall Status */}
        <div className={`rounded-lg p-4 mb-8 flex items-center gap-3 ${allOk ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <StatusDot ok={allOk} />
          <div>
            <p className={`font-semibold ${allOk ? 'text-green-800' : 'text-amber-800'}`}>
              {allOk ? 'ระบบทั้งหมดทำงานปกติ' : 'มีบางบริการที่ไม่พร้อมใช้งาน'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">รีเฟรชอัตโนมัติทุก 30 วินาที</p>
          </div>
        </div>

        {/* Architecture Diagram */}
        <h2 className="text-base font-bold text-foreground mb-4 border-b pb-2">แผนภาพการเชื่อมต่อระบบ</h2>

        <div className="flex flex-col items-center">
          {/* Frontend */}
          <ServiceCard
            icon={<MonitorIcon />}
            title="Frontend (เว็บแอป)"
            status="ok"
            statusText="กำลังใช้งาน"
            details={[{ label: 'สถานะ', value: 'เชื่อมต่อแล้ว' }]}
            color="blue"
          />

          <VerticalLine ok={data!.api.status === 'ok'} />

          {/* API Server */}
          <ServiceCard
            icon={<ServerIcon />}
            title="API Server (Backend)"
            status={data!.api.status === 'ok' ? 'ok' : 'error'}
            statusText={data!.api.status === 'ok' ? 'ทำงานปกติ' : 'มีปัญหา'}
            details={[
              { label: 'เวอร์ชัน', value: data!.api.version },
              { label: 'Uptime', value: formatUptime(data!.api.uptime) },
              { label: 'Node.js', value: data!.api.nodeVersion },
              { label: 'RAM ใช้งาน', value: `${data!.memory.heapUsedMB} / ${data!.memory.heapTotalMB} MB` },
            ]}
            color="indigo"
          />

          {/* Branch lines to DB and AI */}
          <div className="w-80 h-10 relative">
            <svg className="w-full h-full" viewBox="0 0 320 40" preserveAspectRatio="none">
              <path d="M160,0 L160,20 L60,20 L60,40" fill="none" stroke={data!.database.connected ? '#86efac' : '#fca5a5'} strokeWidth="2" />
              <path d="M160,0 L160,20 L260,20 L260,40" fill="none" stroke={data!.ai.connected ? '#86efac' : '#fca5a5'} strokeWidth="2" />
            </svg>
          </div>

          {/* Database & AI side by side */}
          <div className="flex gap-6 w-full max-w-lg">
            <div className="flex-1">
              <ServiceCard
                icon={<DatabaseIcon />}
                title="Database (PostgreSQL)"
                status={data!.database.connected ? 'ok' : 'error'}
                statusText={data!.database.connected ? 'เชื่อมต่อแล้ว' : 'ไม่สามารถเชื่อมต่อ'}
                details={[
                  { label: 'Latency', value: data!.database.connected ? `${data!.database.latencyMs} ms` : '-' },
                  ...(data!.database.error ? [{ label: 'Error', value: data!.database.error }] : []),
                ]}
                color="emerald"
                full
              />
            </div>
            <div className="flex-1">
              <ServiceCard
                icon={<AiIcon />}
                title="AI (Claude)"
                status={data!.ai.connected ? 'ok' : data!.ai.configured ? 'warn' : 'error'}
                statusText={
                  data!.ai.connected ? 'เชื่อมต่อแล้ว' :
                  data!.ai.configured ? 'ตั้งค่าแล้ว แต่เชื่อมต่อไม่ได้' :
                  'ยังไม่ได้ตั้งค่า'
                }
                details={[
                  { label: 'Model', value: data!.ai.model },
                  { label: 'API Key', value: data!.ai.configured ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า' },
                  ...(data!.ai.error ? [{ label: 'Error', value: data!.ai.error }] : []),
                ]}
                color="blue"
                full
              />
            </div>
          </div>
        </div>
      </A4Page>

      {/* ═══════════════════ Page 2: Detail & Features ═══════════════════ */}
      <A4Page pageNum={2} totalPages={totalPages}>
        <div className="text-center mb-8">
          <h1 className="text-xl font-bold text-foreground">รายงานสถานะระบบ (ต่อ)</h1>
        </div>

        {/* Summary Table */}
        <h2 className="text-base font-bold text-foreground mb-4 border-b pb-2">สรุปสถานะบริการ</h2>
        <table className="w-full text-sm mb-8 border-collapse">
          <thead>
            <tr className="bg-muted">
              <th className="text-left p-3 border border-border font-semibold text-foreground">บริการ</th>
              <th className="text-left p-3 border border-border font-semibold text-foreground">สถานะ</th>
              <th className="text-left p-3 border border-border font-semibold text-foreground">รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="p-3 border border-border font-medium">Frontend</td>
              <td className="p-3 border border-border">
                <span className="inline-flex items-center gap-1.5"><StatusDot ok={true} /> เชื่อมต่อแล้ว</span>
              </td>
              <td className="p-3 border border-border text-muted-foreground">เว็บแอปทำงานปกติ</td>
            </tr>
            <tr>
              <td className="p-3 border border-border font-medium">API Server</td>
              <td className="p-3 border border-border">
                <span className="inline-flex items-center gap-1.5"><StatusDot ok={data!.api.status === 'ok'} /> {data!.api.status === 'ok' ? 'ทำงานปกติ' : 'มีปัญหา'}</span>
              </td>
              <td className="p-3 border border-border text-muted-foreground">v{data!.api.version} | Uptime: {formatUptime(data!.api.uptime)} | {data!.api.nodeVersion}</td>
            </tr>
            <tr>
              <td className="p-3 border border-border font-medium">Database</td>
              <td className="p-3 border border-border">
                <span className="inline-flex items-center gap-1.5"><StatusDot ok={data!.database.connected} /> {data!.database.connected ? 'เชื่อมต่อแล้ว' : 'ไม่สามารถเชื่อมต่อ'}</span>
              </td>
              <td className="p-3 border border-border text-muted-foreground">
                {data!.database.connected ? `Latency: ${data!.database.latencyMs} ms` : data!.database.error || '-'}
              </td>
            </tr>
            <tr>
              <td className="p-3 border border-border font-medium">AI (Claude)</td>
              <td className="p-3 border border-border">
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot ok={data!.ai.connected} />
                  {data!.ai.connected ? 'เชื่อมต่อแล้ว' : data!.ai.configured ? 'เชื่อมต่อไม่ได้' : 'ยังไม่ตั้งค่า'}
                </span>
              </td>
              <td className="p-3 border border-border text-muted-foreground">
                Model: {data!.ai.model}{data!.ai.error ? ` | Error: ${data!.ai.error}` : ''}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Memory */}
        <h2 className="text-base font-bold text-foreground mb-4 border-b pb-2">ทรัพยากรระบบ</h2>
        <div className="grid grid-cols-3 gap-4 mb-8">
          <MemoryCard label="Heap ใช้งาน" value={`${data!.memory.heapUsedMB} MB`} total={`${data!.memory.heapTotalMB} MB`} pct={Math.round((data!.memory.heapUsedMB / data!.memory.heapTotalMB) * 100)} />
          <MemoryCard label="Heap ทั้งหมด" value={`${data!.memory.heapTotalMB} MB`} />
          <MemoryCard label="RSS (ทั้งหมด)" value={`${data!.memory.rssMB} MB`} />
        </div>

        {/* AI Features */}
        <h2 className="text-base font-bold text-foreground mb-4 border-b pb-2">ฟีเจอร์ที่ต้องใช้ AI</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { name: 'สร้างเทมเพลตจากไฟล์', desc: 'สร้าง contract template จากไฟล์ PDF/รูปภาพ' },
            { name: 'อ่านบัตรประชาชน (OCR)', desc: 'สแกนข้อมูลจากบัตรประชาชนอัตโนมัติ' },
            { name: 'อ่านสลิปการโอน', desc: 'อ่านข้อมูลจากสลิปการโอนเงิน' },
            { name: 'อ่านสมุดบัญชี', desc: 'อ่านข้อมูลจากสมุดบัญชีธนาคาร' },
          ].map(f => {
            const ok = data!.ai.connected;
            return (
              <div key={f.name} className={`flex items-start gap-3 p-3 rounded-lg border ${ok ? 'bg-green-50 border-green-200' : 'bg-muted border-border'}`}>
                <StatusDot ok={ok} />
                <div>
                  <p className={`text-sm font-medium ${ok ? 'text-green-800' : 'text-muted-foreground'}`}>{f.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </A4Page>
    </div>
  );
}

/* ─── Sub-components ─── */

function VerticalLine({ ok }: { ok: boolean }) {
  return (
    <div className="flex items-center justify-center">
      <div className={`w-0.5 h-8 ${ok ? 'bg-green-300' : 'bg-red-300'}`} />
    </div>
  );
}

function MemoryCard({ label, value, total, pct }: { label: string; value: string; total?: string; pct?: number }) {
  return (
    <div className="border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {total && pct !== undefined && (
        <>
          <div className="w-full bg-muted rounded-full h-1.5 mt-2">
            <div className={`h-1.5 rounded-full ${pct > 80 ? 'bg-red-500' : pct > 60 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-1">{pct}% ของ {total}</p>
        </>
      )}
    </div>
  );
}

function ServiceCard({
  icon, title, status, statusText, details, color, full,
}: {
  icon: React.ReactNode;
  title: string;
  status: 'ok' | 'warn' | 'error';
  statusText: string;
  details: { label: string; value: string }[];
  color: string;
  full?: boolean;
}) {
  const bgColors: Record<string, string> = {
    blue: 'bg-primary-50 border-primary-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    emerald: 'bg-emerald-50 border-emerald-200',
  };
  const iconColors: Record<string, string> = {
    blue: 'text-primary',
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
  };
  const statusColors: Record<string, string> = {
    ok: 'text-green-700',
    warn: 'text-amber-700',
    error: 'text-red-700',
  };

  return (
    <div className={`rounded-lg border p-4 ${bgColors[color] || 'bg-muted border-border'} ${full ? 'w-full' : 'w-72'}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={iconColors[color] || 'text-muted-foreground'}>{icon}</div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <StatusDot ok={status === 'ok'} />
        <span className={`text-sm font-medium ${statusColors[status]}`}>{statusText}</span>
      </div>
      <div className="space-y-1">
        {details.map(d => (
          <div key={d.label} className="flex justify-between text-xs">
            <span className="text-muted-foreground">{d.label}</span>
            <span className="text-foreground font-mono truncate max-w-[150px]" title={d.value}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Icons ─── */
function MonitorIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>;
}
function ServerIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>;
}
function DatabaseIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>;
}
function AiIcon() {
  return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>;
}
