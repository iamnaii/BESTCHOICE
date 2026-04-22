import { MessageCircle } from 'lucide-react';

const LINE_URL = 'https://line.me/R/ti/p/@bestchoice';

export default function FloatingLineButton() {
  return (
    <a
      href={LINE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="ติดต่อผ่าน LINE"
      className="fixed left-4 bottom-20 md:bottom-6 z-40 inline-flex items-center gap-2 rounded-full bg-emerald-500 text-white shadow-xl hover:bg-emerald-600 hover:scale-105 transition-transform motion-reduce:transform-none size-12 md:size-auto md:px-4 md:py-3 md:rounded-xl justify-center leading-snug"
    >
      <MessageCircle className="size-5 shrink-0" />
      <span className="hidden md:inline text-sm font-semibold">ทักไลน์</span>
    </a>
  );
}
