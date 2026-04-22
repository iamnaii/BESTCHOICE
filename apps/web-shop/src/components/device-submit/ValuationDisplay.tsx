interface Props {
  min: number;
  max: number;
  available: boolean;
}

export default function ValuationDisplay({ min, max, available }: Props) {
  if (!available) {
    return (
      <div className="rounded-xl border border-border bg-muted/40 p-4 leading-snug text-sm text-muted-foreground">
        ยังไม่มีราคาอ้างอิงสำหรับรุ่นนี้ — ทีมงานจะประเมินหลังได้รับรูป
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 leading-snug">
      <div className="text-xs text-muted-foreground">ช่วงราคาประเมิน</div>
      <div className="text-2xl font-bold text-primary">
        ฿{min.toLocaleString()} – ฿{max.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        ราคาจริงจะได้หลังทีมงานตรวจรูปจริงภายใน 24 ชั่วโมง
      </div>
    </div>
  );
}
