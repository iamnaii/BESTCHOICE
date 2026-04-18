import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { checkCardReaderStatus, type CardReaderStatus } from '@/lib/cardReader';

const CARD_READER_DOWNLOAD_URL =
  'https://github.com/iamnaii/BESTCHOICE/releases/latest/download/BestchoiceCardReader.zip';

// ── CardReaderSetup ──

function CardReaderSetup() {
  const [status, setStatus] = useState<CardReaderStatus | null | 'checking'>('checking');

  const checkStatus = useCallback(async () => {
    setStatus('checking');
    const result = await checkCardReaderStatus();
    setStatus(result);
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const isConnected =
    status !== null &&
    status !== 'checking' &&
    typeof status === 'object' &&
    ['waiting', 'card_inserted', 'reading'].includes(status.status);

  const statusInfo = (() => {
    if (status === 'checking') return { color: 'gray', icon: '⏳', text: 'กำลังตรวจสอบ...' };
    if (status === null)
      return { color: 'red', icon: '❌', text: 'ยังไม่ได้ติดตั้ง หรือโปรแกรมไม่ได้เปิดอยู่' };
    switch (status.status) {
      case 'waiting':
        return { color: 'green', icon: '✅', text: `เชื่อมต่อแล้ว — ${status.readerName || 'รอเสียบบัตร'}` };
      case 'card_inserted':
        return { color: 'green', icon: '✅', text: 'พร้อมอ่านบัตร' };
      case 'reading':
        return { color: 'blue', icon: '📖', text: 'กำลังอ่านบัตร...' };
      case 'no_reader':
        return { color: 'yellow', icon: '⚠️', text: 'โปรแกรมทำงานอยู่ แต่ไม่พบเครื่องอ่านบัตร USB' };
      case 'no_pcsc':
        return { color: 'red', icon: '❌', text: 'ไม่พบ Smart Card Service บนเครื่อง' };
      case 'error':
        return { color: 'red', icon: '❌', text: status.error || 'เกิดข้อผิดพลาด' };
      default:
        return { color: 'gray', icon: '❓', text: 'ไม่ทราบสถานะ' };
    }
  })();

  const bgColor =
    {
      green: 'bg-success/5 dark:bg-success/10 border-success/20',
      yellow: 'bg-warning/5 dark:bg-warning/10 border-warning/20',
      red: 'bg-destructive/5 dark:bg-destructive/10 border-destructive/20',
      blue: 'bg-primary/10 border-primary/20',
      gray: 'bg-muted border-border',
    }[statusInfo.color] || 'bg-muted border-border';

  const textColor =
    {
      green: 'text-success',
      yellow: 'text-warning',
      red: 'text-destructive',
      blue: 'text-primary',
      gray: 'text-muted-foreground',
    }[statusInfo.color] || 'text-muted-foreground';

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <svg
              className="w-5 h-5 text-primary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
            เครื่องอ่านบัตรประชาชน
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            โปรแกรมสำหรับอ่านบัตรประชาชนผ่านเครื่องอ่านบัตร USB — ติดตั้งบนเครื่องคอมที่ร้าน
          </p>
          <div
            className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${bgColor} ${textColor}`}
          >
            <span>{statusInfo.icon}</span>
            <span>{statusInfo.text}</span>
            <button
              onClick={checkStatus}
              className="ml-1 text-muted-foreground hover:text-foreground"
              title="ตรวจสอบใหม่"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          {!isConnected && (
            <div className="mt-4 text-sm text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">วิธีติดตั้ง:</p>
              <ol className="list-decimal list-inside space-y-0.5 ml-1">
                <li>
                  กดปุ่ม <strong>"ดาวน์โหลด"</strong> ด้านขวา
                </li>
                <li>
                  โหลดไฟล์ <code className="bg-muted px-1 rounded text-xs">.zip</code> → คลิกขวา →{' '}
                  <strong>Extract All</strong>
                </li>
                <li>
                  เปิดโฟลเดอร์ → ดับเบิลคลิก <strong>setup.bat</strong>
                </li>
                <li>
                  เสร็จ! ดับเบิลคลิก <strong>"BESTCHOICE Card Reader"</strong> บน Desktop
                </li>
              </ol>
            </div>
          )}
        </div>
        <div className="flex flex-col items-center gap-2 shrink-0">
          <a
            href={CARD_READER_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-5 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center gap-2 shadow-card"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
              />
            </svg>
            ดาวน์โหลด
          </a>
          <span className="text-xs text-muted-foreground">Windows 10+</span>
        </div>
      </div>
    </div>
  );
}

// ── ExternalLinks: LINE OA / Interest / SMS quick-nav ──

function ExternalLinks() {
  const navigate = useNavigate();

  return (
    <>
      <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-primary">ตั้งค่าอัตราดอกเบี้ยตามประเภทสินค้า</div>
          <div className="text-xs text-primary mt-0.5">
            ตั้งค่าดอกเบี้ย เงินดาวน์ขั้นต่ำ จำนวนงวด แยกตามประเภทสินค้า (มือ1, มือ2, แท็บเล็ต ฯลฯ)
          </div>
        </div>
        <button
          onClick={() => navigate('/settings/interest-config')}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 whitespace-nowrap"
        >
          ตั้งค่าดอกเบี้ย
        </button>
      </div>
    </>
  );
}

// ── SystemSettings: card reader + external links ──

export default function SystemSettings() {
  return (
    <>
      <CardReaderSetup />
      <ExternalLinks />
    </>
  );
}
