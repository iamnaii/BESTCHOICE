import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

const THEMES = {
  history: {
    background:
      'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.09), transparent 60%),' +
      'radial-gradient(500px 380px at 100% 20%, rgb(59 130 246 / 0.08), transparent 65%),' +
      'radial-gradient(400px 320px at 50% 100%, rgb(99 102 241 / 0.05), transparent 60%)',
    avatarBackground:
      'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 60%, rgb(13 148 136) 100%)',
    avatarShadow: 'shadow-emerald-500/30',
  },
  profile: {
    background:
      'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.09), transparent 60%),' +
      'radial-gradient(500px 380px at 100% 20%, rgb(251 191 36 / 0.08), transparent 65%),' +
      'radial-gradient(400px 320px at 50% 100%, rgb(99 102 241 / 0.05), transparent 60%)',
    avatarBackground:
      'linear-gradient(135deg, rgb(16 185 129) 0%, rgb(5 150 105) 60%, rgb(13 148 136) 100%)',
    avatarShadow: 'shadow-emerald-500/30',
  },
  payment: {
    background:
      'radial-gradient(600px 400px at 10% -5%, rgb(16 185 129 / 0.10), transparent 60%),' +
      'radial-gradient(500px 380px at 100% 20%, rgb(52 211 153 / 0.07), transparent 65%),' +
      'radial-gradient(400px 320px at 50% 100%, rgb(99 102 241 / 0.05), transparent 60%)',
    avatarBackground:
      'linear-gradient(135deg, rgb(52 211 153) 0%, rgb(16 185 129) 60%, rgb(5 150 105) 100%)',
    avatarShadow: 'shadow-emerald-500/30',
  },
  'early-payoff': {
    background:
      'radial-gradient(600px 400px at 10% -5%, rgb(251 191 36 / 0.10), transparent 60%),' +
      'radial-gradient(500px 380px at 100% 20%, rgb(16 185 129 / 0.07), transparent 65%),' +
      'radial-gradient(400px 320px at 50% 100%, rgb(99 102 241 / 0.05), transparent 60%)',
    avatarBackground:
      'linear-gradient(135deg, rgb(251 191 36) 0%, rgb(245 158 11) 60%, rgb(217 119 6) 100%)',
    avatarShadow: 'shadow-amber-500/30',
  },
};

type LiffTheme = keyof typeof THEMES;

export function LiffShell({ children, theme }: { children: ReactNode; theme: LiffTheme }) {
  return (
    <div className="relative min-h-screen overflow-x-hidden" style={{ backgroundColor: '#fafaf7' }}>
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: THEMES[theme].background,
        }}
      />
      <div className="relative mx-auto max-w-[430px] pb-16">{children}</div>
    </div>
  );
}

export function LiffTopBar({
  title,
  initial,
  theme,
}: {
  title: string;
  initial: string;
  theme: LiffTheme;
}) {
  return (
    <header
      className="sticky top-0 z-20 flex items-center justify-between px-5 py-3.5 backdrop-blur-xl border-b border-border/50"
      style={{ backgroundColor: 'rgb(250 250 247 / 0.85)' }}
    >
      <button
        type="button"
        aria-label="ย้อนกลับ"
        className="grid h-9 w-9 place-items-center rounded-full text-foreground hover:bg-accent -ml-1.5"
        onClick={() => window.history.back()}
      >
        <ChevronLeft className="size-5" strokeWidth={1.75} />
      </button>
      <div className="text-[13px] font-medium text-foreground tracking-tight leading-snug">
        {title}
      </div>
      <div className="relative -mr-1.5">
        <div
          className={`grid h-9 w-9 place-items-center rounded-full text-[12px] font-semibold text-white shadow-lg ${THEMES[theme].avatarShadow}`}
          style={{
            background: THEMES[theme].avatarBackground,
          }}
        >
          {initial}
        </div>
        {theme === 'profile' && (
          <span
            className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2"
            style={{ boxShadow: '0 0 0 2px #fafaf7' }}
          />
        )}
      </div>
    </header>
  );
}
