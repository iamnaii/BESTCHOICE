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
    <span className="relative flex h-3 w-3">
      {ok && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
    </span>
  );
}

function ConnectionLine({ ok }: { ok: boolean }) {
  return (
    <div className="flex items-center justify-center py-1">
      <div className={`w-0.5 h-8 ${ok ? 'bg-green-300' : 'bg-red-300'}`} />
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
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
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

  return (
    <div>
      <PageHeader
        title="สถานะระบบ"
        subtitle="ตรวจสอบการเชื่อมต่อ API, ฐานข้อมูล และ AI"
        action={
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            รีเฟรช
          </button>
        }
      />

      {/* Overall Status Banner */}
      <div className={`rounded-xl p-4 mb-6 flex items-center gap-3 ${allOk ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
        <StatusDot ok={allOk} />
        <div>
          <p className={`font-medium ${allOk ? 'text-green-800' : 'text-amber-800'}`}>
            {allOk ? 'ระบบทั้งหมดทำงานปกติ' : 'มีบางบริการที่ไม่พร้อมใช้งาน'}
          </p>
          <p className="text-xs text-gray-500">ตรวจสอบล่าสุด: {new Date(data!.timestamp).toLocaleTimeString('th-TH')} (รีเฟรชอัตโนมัติทุก 30 วินาที)</p>
        </div>
      </div>

      {/* Connection Diagram */}
      <div className="max-w-md mx-auto">
        {/* Frontend */}
        <ServiceCard
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          }
          title="Frontend (เว็บแอป)"
          status="ok"
          statusText="กำลังใช้งาน"
          details={[
            { label: 'สถานะ', value: 'เชื่อมต่อแล้ว' },
          ]}
          color="blue"
        />

        <ConnectionLine ok={data!.api.status === 'ok'} />

        {/* API Server */}
        <ServiceCard
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
          }
          title="API Server"
          status={data!.api.status === 'ok' ? 'ok' : 'error'}
          statusText={data!.api.status === 'ok' ? 'ทำงานปกติ' : 'มีปัญหา'}
          details={[
            { label: 'เวอร์ชัน', value: data!.api.version },
            { label: 'Uptime', value: formatUptime(data!.api.uptime) },
            { label: 'Node.js', value: data!.api.nodeVersion },
            { label: 'RAM', value: `${data!.memory.heapUsedMB} / ${data!.memory.heapTotalMB} MB` },
          ]}
          color="indigo"
        />

        {/* Split into Database and AI */}
        <div className="flex justify-center gap-16 relative">
          {/* Left branch line */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-8">
            <svg className="w-full h-full" viewBox="0 0 160 32">
              <path d={`M80,0 L80,16 L20,16 L20,32`} fill="none" stroke={data!.database.connected ? '#86efac' : '#fca5a5'} strokeWidth="2" />
              <path d={`M80,0 L80,16 L140,16 L140,32`} fill="none" stroke={data!.ai.connected ? '#86efac' : '#fca5a5'} strokeWidth="2" />
            </svg>
          </div>

          <div className="flex gap-4 pt-8">
            {/* Database */}
            <ServiceCard
              icon={
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
              }
              title="Database"
              status={data!.database.connected ? 'ok' : 'error'}
              statusText={data!.database.connected ? 'เชื่อมต่อแล้ว' : 'ไม่สามารถเชื่อมต่อ'}
              details={[
                { label: 'Latency', value: data!.database.connected ? `${data!.database.latencyMs}ms` : '-' },
                ...(data!.database.error ? [{ label: 'Error', value: data!.database.error }] : []),
              ]}
              color="emerald"
              compact
            />

            {/* AI */}
            <ServiceCard
              icon={
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              }
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
              color="purple"
              compact
            />
          </div>
        </div>
      </div>

      {/* Features dependent on AI */}
      <div className="mt-8 bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">ฟีเจอร์ที่ต้องใช้ AI</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { name: 'สร้างเทมเพลตจากไฟล์', needs: 'ai' },
            { name: 'อ่านบัตรประชาชน (OCR)', needs: 'ai' },
            { name: 'อ่านสลิปการโอน', needs: 'ai' },
            { name: 'อ่านสมุดบัญชี', needs: 'ai' },
          ].map(f => {
            const ok = f.needs === 'ai' ? data!.ai.connected : true;
            return (
              <div key={f.name} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                <StatusDot ok={ok} />
                <span>{f.name}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ServiceCard({
  icon,
  title,
  status,
  statusText,
  details,
  color,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  status: 'ok' | 'warn' | 'error';
  statusText: string;
  details: { label: string; value: string }[];
  color: string;
  compact?: boolean;
}) {
  const bgColors: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    indigo: 'bg-indigo-50 border-indigo-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    purple: 'bg-purple-50 border-purple-200',
  };
  const iconColors: Record<string, string> = {
    blue: 'text-blue-600',
    indigo: 'text-indigo-600',
    emerald: 'text-emerald-600',
    purple: 'text-purple-600',
  };
  const statusColors: Record<string, string> = {
    ok: 'text-green-700',
    warn: 'text-amber-700',
    error: 'text-red-700',
  };

  return (
    <div className={`rounded-xl border ${bgColors[color] || 'bg-gray-50 border-gray-200'} ${compact ? 'p-3 w-48' : 'p-4'}`}>
      <div className="flex items-center gap-2 mb-2">
        <div className={iconColors[color] || 'text-gray-600'}>{icon}</div>
        <h3 className={`font-semibold ${compact ? 'text-sm' : 'text-base'} text-gray-800`}>{title}</h3>
      </div>
      <div className="flex items-center gap-1.5 mb-2">
        <StatusDot ok={status === 'ok'} />
        <span className={`text-sm font-medium ${statusColors[status]}`}>{statusText}</span>
      </div>
      <div className="space-y-1">
        {details.map(d => (
          <div key={d.label} className="flex justify-between text-xs">
            <span className="text-gray-500">{d.label}</span>
            <span className="text-gray-700 font-mono truncate max-w-[120px]" title={d.value}>{d.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
