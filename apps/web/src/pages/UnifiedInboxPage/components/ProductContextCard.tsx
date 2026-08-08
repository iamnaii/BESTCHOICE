import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import api from '@/lib/api';
import { ImageOff, Send, Smartphone, Tag, BadgePercent } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface DetectedProduct {
  id: string;
  name: string;
  brand: string;
  model: string;
  price: number;
  stock: number;
  imageUrl: string | null;
  installmentPrice: number | null;
  conditionGrade: string | null;
  pricingOptions: {
    downPaymentMin: number;
    monthlyPayment: number;
    installments: number;
  }[];
  activePromotions: { id: string; name: string; description: string }[];
}

interface ProductContextCardProps {
  roomId: string;
}

const baht = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 });

export default function ProductContextCard({ roomId }: ProductContextCardProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery<DetectedProduct[]>({
    queryKey: ['chat-products', roomId],
    queryFn: () =>
      api.get(`/staff-chat/rooms/${roomId}/products`).then((r: any) => r.data?.data ?? r.data),
    enabled: !!roomId,
    staleTime: 60_000,
  });

  // clientMessageId ต่อ "สินค้า 1 ชิ้นในลิสต์" — คงค่าเดิมไว้จนกว่าจะส่งสำเร็จเต็ม
  // หรือเปลี่ยนห้อง (idempotency contract จาก backend: unique [roomId, clientMessageId]),
  // เหมือน pattern เดียวกับ ProductPickerDialog.tsx. ถ้า generate ใหม่ทุกครั้งที่กด "ส่ง"
  // การ retry หลังพังบางส่วน (เช่น รูปส่งสำเร็จแต่ข้อความพัง) จะกลายเป็นส่งรูปซ้ำให้ลูกค้า
  // แทนที่จะข้ามไปส่งเฉพาะส่วนที่ยังไม่สำเร็จ — คีย์ด้วย productId เพราะการ์ดนี้มีหลายสินค้า
  // ให้กดส่งพร้อมกันได้ ไม่ใช่เลือกทีละชิ้นแบบ dialog
  const clientMessageIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    clientMessageIdsRef.current = new Map();
  }, [roomId]);

  const sendMut = useMutation({
    mutationFn: (productId: string) => {
      let clientMessageId = clientMessageIdsRef.current.get(productId);
      if (!clientMessageId) {
        clientMessageId = crypto.randomUUID();
        clientMessageIdsRef.current.set(productId, clientMessageId);
      }
      return api.post(`/staff-chat/rooms/${roomId}/product-card`, {
        productId,
        clientMessageId,
        parts: ['PHOTO', 'TEXT'],
      });
    },
    onSuccess: (res: any, productId) => {
      const data = res?.data ?? res;
      // การ์ดถูกบันทึกเป็น ChatMessage ฝั่ง server (บาง bubble อาจสำเร็จแล้วแม้ผลรวมจะ
      // error) → ดึงข้อความ/รายการห้องใหม่เสมอ ไม่ว่าจะสำเร็จเต็มหรือบางส่วน
      queryClient.invalidateQueries({ queryKey: ['chat-messages', roomId] });
      queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });

      if (data?.errors?.length) {
        // ส่งไม่ครบ (HTTP 200 แต่มี errors) — ห้ามล้าง ref ของสินค้าชิ้นนี้: ปล่อยให้กด
        // ปุ่มเดิมซ้ำได้ clientMessageId เดิม ไม่งั้น bubble ที่ลูกค้าได้รับไปแล้ว (เช่นรูป)
        // จะถูกส่งซ้ำ เพราะ server dedupe ด้วย `${clientMessageId}-img`/`-txt` ตาม id ที่ส่งมา
        toast.error(`ส่งไม่ครบ — ${data.errors[0]} · กดปุ่มเดิมอีกครั้งเพื่อส่งซ้ำเฉพาะส่วนที่ยังไม่สำเร็จ`);
        return;
      }
      clientMessageIdsRef.current.delete(productId);
      if (data?.photoSkipped) toast.warning('ส่งข้อความแล้ว — เครื่องนี้ยังไม่มีรูปขึ้นเว็บ');
      else toast.success('ส่งให้ลูกค้าแล้ว');
    },
    onError: () => toast.error('ส่งข้อมูลสินค้าไม่สำเร็จ'),
  });

  if (isLoading || !products || products.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center gap-2 mb-2 px-4">
        <Smartphone className="size-3.5 text-primary opacity-60" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
          สินค้าที่กำลังคุย
        </span>
      </div>

      <div className="space-y-2 px-4">
        {products.map((product) => (
          <div key={product.id} className="bg-muted/40 rounded-lg p-3 text-[12px]">
            <div className="flex items-start gap-2.5">
              <button
                type="button"
                onClick={() => navigate(`/products/${product.id}`)}
                title="เปิดหน้าสินค้า"
                className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background"
              >
                {product.imageUrl ? (
                  <img src={product.imageUrl} alt={product.name} className="size-full object-cover" />
                ) : (
                  <ImageOff className="size-4 text-muted-foreground" />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => navigate(`/products/${product.id}`)}
                  className="block max-w-full truncate text-left text-[13px] font-semibold leading-snug hover:underline"
                >
                  {product.name}
                </button>
                <p className="truncate text-muted-foreground leading-snug">
                  {product.brand} {product.model}
                  {product.conditionGrade ? ` · สภาพ ${product.conditionGrade}` : ''}
                </p>
              </div>

              <Badge
                variant={product.stock > 0 ? 'success' : 'destructive'}
                className="shrink-0 text-[10px]"
              >
                {product.stock > 0 ? `${product.stock} เครื่อง` : 'หมด'}
              </Badge>
            </div>

            <p className="text-primary font-bold mt-1.5">฿{baht(product.price)}</p>

            {product.pricingOptions?.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {product.pricingOptions.slice(0, 2).map((opt, i) => (
                  <p key={i} className="text-muted-foreground flex items-center gap-1 leading-snug">
                    <Tag className="size-3 opacity-40" />
                    ผ่อน {opt.installments} งวด งวดละ {baht(opt.monthlyPayment)} บาท (ดาวน์{' '}
                    {baht(opt.downPaymentMin)} บาท)
                  </p>
                ))}
              </div>
            )}

            {product.activePromotions?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {product.activePromotions.map((promo) => (
                  <Badge key={promo.id} variant="secondary" className="text-[10px]">
                    <BadgePercent className="size-2.5 mr-0.5" />
                    {promo.name}
                  </Badge>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={() => sendMut.mutate(product.id)}
              disabled={sendMut.isPending}
              className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-medium leading-snug text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              <Send className="size-3" />
              ส่งให้ลูกค้า
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
