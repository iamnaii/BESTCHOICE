import { MessageCircle } from '@/lib/icons';
import { shopInfo } from '@/lib/copy';
import { useHideOnScrollDown } from '@/hooks/useHideOnScrollDown';

const LINE_URL = shopInfo.lineUrl;

/**
 * The guide's floating chat FAB — the ONE orange element on screen
 * (56px, warm shadow). Orange is reserved for the chat CTA; the button
 * still lands the customer in LINE OA.
 *
 * The desktop label is 19px bold, same as the large orange buttons in
 * button.tsx: white on #F25C1A is 3.3:1, which passes only as LARGE text
 * (owner 2026-11-26, option B — keep the orange, enlarge the label).
 *
 * Phones: slides below the screen edge while the customer scrolls DOWN and comes back on any
 * scroll up (owner 2026-11-27) — on /products the fixed button otherwise sits on the left
 * card column's chips. Desktop (md+) is unaffected. Keyboard focus brings it back.
 */
export default function FloatingLineButton({ showOnMobile = true }: { showOnMobile?: boolean }) {
  const hidden = useHideOnScrollDown();
  const hiddenClasses = hidden
    ? 'max-md:translate-y-[calc(100%+6rem)] max-md:opacity-0 max-md:pointer-events-none focus-visible:translate-y-0 focus-visible:opacity-100 focus-visible:pointer-events-auto'
    : '';
  return (
    <a
      href={LINE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="ทักแชทหาร้าน"
      data-scroll-hidden={hidden ? 'true' : undefined}
      className={`${showOnMobile ? 'inline-flex' : 'hidden md:inline-flex'} fixed left-4 lg:left-auto lg:right-6 bottom-[calc(5rem+var(--cookie-banner-offset,0px))] md:bottom-[calc(1.5rem+var(--cookie-banner-offset,0px))] z-40 items-center gap-2 rounded-full bg-cta text-cta-foreground shadow-[0_6px_18px_rgba(242,92,26,0.35)] hover:bg-orange-600 hover:scale-105 transition-[translate,scale,opacity] duration-200 motion-reduce:transition-none motion-reduce:hover:scale-100 size-14 md:size-auto md:px-5 md:py-3.5 justify-center leading-snug ${hiddenClasses}`}
    >
      <MessageCircle className="size-6 md:size-5 shrink-0" />
      <span className="hidden md:inline font-head text-[1.1875rem] font-bold">ทักแชท</span>
    </a>
  );
}
