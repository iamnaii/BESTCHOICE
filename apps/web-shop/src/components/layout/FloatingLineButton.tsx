import { MessageCircle } from 'lucide-react';
import { shopInfo } from '@/lib/copy';

const LINE_URL = shopInfo.lineUrl;

/**
 * The guide's floating chat FAB — the ONE orange element on screen
 * (56px, warm shadow). Orange is reserved for the chat CTA; the button
 * still lands the customer in LINE OA.
 */
export default function FloatingLineButton() {
  return (
    <a
      href={LINE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="ทักแชทหาร้าน"
      className="fixed left-4 lg:left-auto lg:right-6 bottom-20 md:bottom-6 z-40 inline-flex items-center gap-2 rounded-full bg-cta text-cta-foreground shadow-[0_6px_18px_rgba(242,92,26,0.35)] hover:bg-orange-600 hover:scale-105 transition-transform motion-reduce:transform-none size-14 md:size-auto md:px-5 md:py-3.5 justify-center leading-snug"
    >
      <MessageCircle className="size-6 md:size-5 shrink-0" />
      <span className="hidden md:inline font-head text-sm font-semibold">ทักแชท</span>
    </a>
  );
}
