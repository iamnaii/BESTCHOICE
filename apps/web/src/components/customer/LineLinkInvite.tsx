import { useQuery } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import api from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MessageCircle, CheckCircle2 } from 'lucide-react';

interface LinkInvite {
  configured: boolean;
  oaBasicId: string | null;
  addFriendUrl: string | null;
}

interface Props {
  /** LINE userId ที่ผูกไว้แล้ว — มีค่า = ผูกแล้ว ไม่ต้องชวนอีก */
  lineIdShop?: string | null;
  /** ชื่อลูกค้า ใช้ในข้อความชวน */
  customerName?: string;
}

/**
 * การ์ดชวนลูกค้าผูก LINE ร้าน — พนักงานยื่นจอให้ลูกค้าสแกนที่เคาน์เตอร์
 *
 * ทำไมต้องมี: การแจ้งประกันทาง LINE และหน้า "ประกันของฉัน" ใน LIFF ใช้
 * `customer.lineIdShop` เป็นตัวระบุ ⇒ ลูกค้าที่ยังไม่ผูกจะไม่ได้รับอะไรเลย
 * และการผูกทำได้ทางเดียวคือแอด OA ร้านแล้วพิมพ์เบอร์โทรเข้าไปในแชท
 * (`line-oa-chatbot.controller` → `selfLinkByPhone`)
 */
export default function LineLinkInvite({ lineIdShop, customerName }: Props) {
  const { data, isLoading } = useQuery<LinkInvite>({
    queryKey: ['line-link-invite'],
    queryFn: async () => (await api.get('/line-oa/link-invite')).data,
    // ค่านี้แทบไม่เปลี่ยน — ไม่ต้องยิงซ้ำทุกครั้งที่เปิดหน้าลูกค้า
    staleTime: 30 * 60 * 1000,
    enabled: !lineIdShop,
  });

  if (lineIdShop) {
    return (
      <div className="flex items-center gap-2 text-sm text-success leading-snug">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        ผูก LINE ร้านแล้ว — ลูกค้าได้รับแจ้งประกันและเช็คประกันเองในไลน์ได้
      </div>
    );
  }

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;

  // ยังไม่ได้ตั้ง LINE OA ID — บอกตรง ๆ ว่าต้องไปตั้งค่า ดีกว่าโชว์ QR ที่สแกนแล้วไม่ไปไหน
  if (!data?.configured || !data.addFriendUrl) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground leading-snug">
          ยังไม่ได้ตั้ง LINE OA ID ของร้าน — ให้เจ้าของไปตั้งที่ ตั้งค่ากลาง › เชื่อมต่อ ›
          LINE SHOP (ลูกค้า) แล้วหน้านี้จะแสดง QR ให้ลูกค้าสแกน
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="shrink-0 mx-auto sm:mx-0 bg-white p-2 rounded-lg border border-border">
            {/* พื้นขาวเสมอ — QR บนพื้นเข้มสแกนไม่ติด */}
            <QRCodeSVG value={data.addFriendUrl} size={132} level="M" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <MessageCircle className="size-4 text-primary shrink-0" aria-hidden="true" />
              <span className="font-semibold text-foreground leading-snug">
                ชวน{customerName ? `คุณ${customerName}` : 'ลูกค้า'}ผูก LINE ร้าน
              </span>
            </div>
            <ol className="text-sm text-muted-foreground leading-snug space-y-1 list-decimal list-inside">
              <li>ให้ลูกค้าสแกน QR นี้เพื่อเพิ่มเพื่อน {data.oaBasicId}</li>
              <li>
                พิมพ์ <span className="text-foreground font-medium">เบอร์โทรของตัวเอง</span>{' '}
                ส่งเข้าไปในแชท ระบบจะผูกบัญชีให้อัตโนมัติ
              </li>
            </ol>
            <p className="text-xs text-muted-foreground mt-2 leading-snug">
              ผูกแล้วลูกค้าจะได้รับแจ้งวันหมดประกันทางไลน์ และเปิดดูประกันเองได้ทุกเมื่อ
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
