import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components';

interface ClickToLoadMapProps {
  src: string;
  title: string;
}

/**
 * แผนที่ฝังแบบกดแล้วค่อยโหลด — ก่อนกดไม่ติดต่อ Google เลย (ไม่มี iframe/รูป/preconnect)
 * ไม่ผูกกับตัวเลือกคุกกี้: ลูกค้ากดเองถือเป็นการขอดูแผนที่ครั้งนั้น
 */
export default function ClickToLoadMap({ src, title }: ClickToLoadMapProps) {
  const [shown, setShown] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (shown) frameRef.current?.focus();
  }, [shown]);

  if (shown) {
    return (
      <iframe
        ref={frameRef}
        src={src}
        title={title}
        className="block h-64 w-full border-0 md:h-80"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
    );
  }

  return (
    <div className="flex h-64 w-full flex-col items-center justify-center gap-3 bg-muted px-4 text-center md:h-80">
      <Button type="button" variant="outline" size="md" onClick={() => setShown(true)}>
        แสดงแผนที่
      </Button>
      <p className="text-xs leading-snug text-muted-foreground">
        แผนที่มาจาก Google Maps เมื่อกดแสดง Google จะได้รับข้อมูลการใช้งานของคุณ
      </p>
    </div>
  );
}
