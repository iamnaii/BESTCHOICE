import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

interface ProfileData {
  name: string;
  phone: string;
  lineDisplayName: string;
  contractCount: number;
}

export default function LiffProfile() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineId, setLineId] = useState('');
  const [unlinking, setUnlinking] = useState(false);
  const [unlinked, setUnlinked] = useState(false);

  useEffect(() => {
    initLiff();
  }, []);

  async function initLiff() {
    try {
      if (LIFF_ID) {
        await liff.init({ liffId: LIFF_ID });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        setLineId(profile.userId);
        await fetchProfile(profile.userId);
      } else {
        const params = new URLSearchParams(window.location.search);
        const qLineId = params.get('lineId');
        if (qLineId) {
          setLineId(qLineId);
          await fetchProfile(qLineId);
        } else {
          setError('ไม่สามารถระบุตัวตนได้ กรุณาเปิดผ่าน LINE');
        }
      }
    } catch (err) {
      console.error('LIFF init error:', err);
      const params = new URLSearchParams(window.location.search);
      const qLineId = params.get('lineId');
      if (qLineId) {
        setLineId(qLineId);
        await fetchProfile(qLineId);
      } else {
        setError('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาลองใหม่');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchProfile(id: string) {
    try {
      const res = await fetch(`${API_BASE}/line-oa/liff/profile?lineId=${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setError('ยังไม่ได้ลงทะเบียน กรุณาลงทะเบียนก่อน');
        return;
      }
      if (!res.ok) throw new Error('API error');
      const result = await res.json();
      setData(result);
    } catch {
      setError('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่');
    }
  }

  async function handleUnlink() {
    if (!confirm('ต้องการยกเลิกผูก LINE จริงหรือไม่?\n\nหลังจากยกเลิก จะไม่สามารถใช้งานผ่าน LINE ได้อีก ต้องลงทะเบียนใหม่')) {
      return;
    }

    setUnlinking(true);
    try {
      const res = await fetch(`${API_BASE}/line-oa/liff/unlink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId }),
      });
      const result = await res.json();
      if (result.error) {
        alert(result.error);
        return;
      }
      setUnlinked(true);
    } catch {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setUnlinking(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (unlinked) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-muted-foreground text-5xl mb-4">👋</div>
            <h2 className="text-lg font-bold mb-2">ยกเลิกผูก LINE แล้ว</h2>
            <p className="text-muted-foreground text-sm">
              บัญชี LINE ของคุณถูกยกเลิกการเชื่อมต่อกับระบบแล้ว
            </p>
            <Button variant="primary" size="lg" className="mt-6" asChild>
              <a href={`/liff/register${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                ลงทะเบียนใหม่
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">โปรไฟล์ของฉัน</h1>
      </div>

      {/* Profile Info */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">ข้อมูลส่วนตัว</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">ชื่อ</span>
              <span className="text-sm font-medium">{data.name}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">เบอร์โทร</span>
              <span className="text-sm font-medium">{data.phone}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border/50">
              <span className="text-sm text-muted-foreground">LINE</span>
              <span className="text-sm font-medium">{data.lineDisplayName}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">จำนวนสัญญา</span>
              <span className="text-sm font-medium">{data.contractCount} สัญญา</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <Button variant="primary" size="md" className="w-full mb-2" asChild>
            <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ดูสัญญาของฉัน
            </a>
          </Button>
          <Button variant="outline" size="md" className="w-full mb-2" asChild>
            <a href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ประวัติชำระเงิน
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Unlink */}
      <div className="text-center mt-6">
        <Button
          variant="ghost"
          mode="link"
          className="text-destructive text-xs"
          onClick={handleUnlink}
          disabled={unlinking}
        >
          {unlinking ? 'กำลังดำเนินการ...' : 'ยกเลิกผูก LINE'}
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
