import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasCompanyAccess } from '@installment/shared';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface PreparedOffer {
  roomId: string;
  status: 'draft';
  aiStatus: 'ready' | 'unavailable' | 'invalid_response';
  summary: string;
  query: string;
  maxPriceThb: number | null;
  budgetSource: 'manual' | 'chat' | null;
  createdAt: string;
  sources: { messageId: string; createdAt: string; excerpt?: string }[];
  products: {
    productId: string;
    name: string;
    branchName: string | null;
    cashPriceThb: number;
    productPath: string;
    contractPath: string | null;
    quote: { monthlyThb: number; tenureMonths: number; downAmountThb: number } | null;
    draft: string;
  }[];
  nextStep: string;
}

const money = (amount: number) => amount.toLocaleString('th-TH', { maximumFractionDigits: 2 });

export default function PrepareOfferDialog({ roomId, onInsert }: { roomId: string; onInsert: (text: string) => void }) {
  const { user } = useAuth();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [budget, setBudget] = useState('');
  const [months, setMonths] = useState('12');
  const [inputError, setInputError] = useState('');
  const offer = useMutation({
    mutationFn: async () => (await api.post<PreparedOffer>(`/staff-chat/rooms/${roomId}/prepare-offer`, {
      query: query.trim() || undefined,
      maxPriceThb: budget.trim() ? Number(budget) : undefined,
      tenureMonths: Number(months),
    })).data,
    onSuccess: () => { void client.invalidateQueries({ queryKey: ['ai-usage'] }); },
  });
  // accessibleCompanies ที่ยังว่าง = ยังไม่ถูก backfill ไม่ใช่ "ไม่มีสิทธิ์" — เช็คผ่าน resolver
  // ตัวเดียวกับฝั่ง API ไม่งั้นปุ่มนี้หายเงียบ ๆ จากทุกคนเหมือนที่เกิดกับ prod
  if (!user || !['OWNER', 'BRANCH_MANAGER', 'SALES'].includes(user.role) || !hasCompanyAccess(user.role, user.accessibleCompanies, 'SHOP')) return null;

  const prepare = () => {
    if (!Number.isInteger(Number(months)) || Number(months) < 1 || Number(months) > 60 ||
      (budget.trim() && (!Number.isFinite(Number(budget)) || Number(budget) <= 0 || Number(budget) > 1000000))) {
      setInputError('ระบุจำนวนงวด 1–60 และงบมากกว่า 0 ไม่เกิน 1,000,000 บาท');
      return;
    }
    setInputError('');
    offer.reset();
    offer.mutate();
  };
  const result = offer.data?.roomId === roomId ? offer.data : null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="min-h-10 gap-2 text-primary">
          <Sparkles className="size-4" aria-hidden="true" /> เตรียมข้อเสนอ
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สรุปความต้องการและเตรียมข้อเสนอ</DialogTitle>
          <DialogDescription className="leading-snug">AI อ่านข้อความลูกค้าเพื่อหารุ่นที่สนใจ ค้นสินค้าที่เปิดขายออนไลน์และพร้อมขายในสาขาที่คุณมีสิทธิ์ ราคาและค่างวดมาจากข้อมูลสินค้าและเครื่องคิดกลาง</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="offer-query">รุ่นหรือความต้องการ</Label>
            <Input id="offer-query" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120} placeholder="ไม่ใส่ = ให้ AI อ่านจากแชท เช่น iPhone 15" disabled={offer.isPending} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="offer-budget" className="leading-snug">งบราคาเงินสดสูงสุด (บาท)</Label>
              <Input id="offer-budget" type="number" min="1" max="1000000" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="ใช้งบจากแชท" disabled={offer.isPending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offer-months">จำนวนงวดที่ต้องการ</Label>
              <Input id="offer-months" type="number" min="1" max="60" step="1" value={months} onChange={(event) => setMonths(event.target.value)} disabled={offer.isPending} />
            </div>
          </div>
          {inputError && <p role="alert" className="text-sm text-destructive leading-snug">{inputError}</p>}
          <Button type="submit" disabled={offer.isPending} className="min-h-11 w-full gap-2">
            {offer.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Sparkles className="size-4" aria-hidden="true" />}
            {offer.isPending ? 'กำลังสรุปและค้นสต็อก…' : 'สรุปและค้นข้อเสนอ'}
          </Button>
        </form>
        {offer.isError && <p role="alert" className="text-sm text-destructive leading-snug">{getErrorMessage(offer.error)} กดสรุปและค้นข้อเสนอเพื่อลองอีกครั้ง</p>}
        {result && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm leading-snug">
              <p className="font-semibold">ร่างข้อเสนอ · ยังไม่ได้ส่งหรือบันทึกการขาย</p>
              <p className="mt-2 whitespace-pre-wrap break-words">{result.summary}</p>
              {result.maxPriceThb != null && <p className="mt-2">งบราคาเงินสดไม่เกิน {money(result.maxPriceThb)} บาท · {result.budgetSource === 'chat' ? 'อ่านจากข้อความลูกค้า ปรับได้ในช่องงบด้านบน' : 'ตามงบที่ระบุ'}</p>}
              {result.aiStatus !== 'ready' && <p className="mt-2 text-muted-foreground">AI ยังสรุปไม่ได้ ผลสินค้าด้านล่างค้นจากข้อมูลจริงตามรุ่นที่ระบุ</p>}
              <p className="mt-2 text-xs text-muted-foreground">อ้างอิงข้อความลูกค้า {result.sources.length} ข้อความ · ตรวจสต็อกเมื่อ {new Date(result.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</p>
              {result.sources.length > 0 && <details className="mt-3 text-xs">
                <summary className="cursor-pointer font-medium">ดูข้อความลูกค้าที่ใช้อ้างอิง</summary>
                <ol className="mt-2 space-y-2">
                  {result.sources.map((source) => <li key={source.messageId} className="rounded border border-border bg-background p-2">
                    <time dateTime={source.createdAt} className="text-muted-foreground">{new Date(source.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</time>
                    <p className="mt-1 whitespace-pre-wrap break-words">{source.excerpt ?? 'เปิดดูข้อความนี้ในประวัติแชท'}</p>
                  </li>)}
                </ol>
              </details>}
            </div>
            {result.products.length === 0 && <p role="status" className="text-sm text-muted-foreground leading-snug">ไม่พบเครื่องพร้อมขายตามเงื่อนไข ลองระบุรุ่นหรือปรับงบอีกครั้ง</p>}
            {result.products.map((product) => (
              <article key={product.productId} className="rounded-lg border border-border p-3 text-sm leading-snug">
                <Link to={product.productPath} onClick={() => setOpen(false)} className="inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">{product.name}<ExternalLink className="size-3.5 shrink-0" aria-hidden="true" /></Link>
                <p className="mt-1 text-muted-foreground">{product.branchName ?? 'ไม่ระบุสาขา'} · เงินสด {money(product.cashPriceThb)} บาท</p>
                {product.quote ? <p className="mt-2">ดาวน์ {money(product.quote.downAmountThb)} บาท · {money(product.quote.monthlyThb)} บาท/งวด × {product.quote.tenureMonths} งวด</p> : <p className="mt-2 text-muted-foreground">ยังไม่มีแผนผ่อนสำหรับจำนวนงวดนี้ ลองเลือกจำนวนงวดอื่น</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" className="min-h-10" onClick={() => { onInsert(product.draft); setOpen(false); }}>แทรกร่างในช่องพิมพ์</Button>
                  {product.contractPath && product.quote && <Button variant="outline" size="sm" className="min-h-10" asChild><Link to={product.contractPath} onClick={() => setOpen(false)}>ตรวจเครดิตและทำสัญญา</Link></Button>}
                </div>
              </article>
            ))}
            <p className="text-xs text-muted-foreground leading-snug">{result.nextStep} · สต็อกและราคาอาจเปลี่ยนได้ กรุณาตรวจร่างก่อนส่ง</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
