import { lineOaMessageUrl } from '@/lib/copy';

/**
 * "Tell us what you're hunting for" block, borrowed from the reference's free
 * waiting list. There is no waitlist table yet, so it opens LINE OA with the
 * request pre-typed — the channel the shop already answers on.
 */
export function WaitlistCard() {
  return (
    <a
      href={lineOaMessageUrl('อยากได้รุ่นนี้ครับ/ค่ะ: ')}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-[40px] border-8 border-card bg-ink px-4 py-5 text-center shadow-lg transition-transform hover:-translate-y-0.5 motion-reduce:transform-none"
    >
      <p className="font-display text-2xl font-bold leading-snug text-ink-foreground">
        ฝากหา<span className="text-emerald-400">ฟรี</span>
      </p>
      <p className="mt-1 text-[12.5px] leading-snug text-white/60 text-balance">
        ไม่เจอรุ่นที่ต้องการ? บอกไว้ได้ ของเข้าแล้วเราทักกลับ
      </p>
      <span className="mt-3 inline-flex h-9 items-center rounded-full bg-card px-6 text-[13px] font-semibold text-foreground leading-snug">
        แจ้งรุ่นที่ต้องการ
      </span>
    </a>
  );
}
