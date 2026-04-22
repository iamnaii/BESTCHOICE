/// <reference types="vite/client" />

const GA_ID = import.meta.env.VITE_GA4_ID as string | undefined;
const FB_PIXEL_ID = import.meta.env.VITE_FB_PIXEL_ID as string | undefined;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export function initAnalytics(): void {
  if (typeof window === 'undefined') return;

  if (GA_ID) {
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function gtag(...args: unknown[]) {
      window.dataLayer!.push(args);
    };
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  if (FB_PIXEL_ID) {
    (function (f: Window, b: Document, e: string, v: string) {
      if (f.fbq) return;
      const n = function (...args: unknown[]) {
        const q = (n as unknown as { queue: unknown[]; callMethod?: (...a: unknown[]) => void })
          .queue;
        const cm = (n as unknown as { callMethod?: (...a: unknown[]) => void }).callMethod;
        if (cm) cm.apply(n, args);
        else q.push(args);
      };
      (n as unknown as { queue: unknown[] }).queue = [];
      (n as unknown as { loaded: boolean }).loaded = true;
      (n as unknown as { version: string }).version = '2.0';
      f.fbq = n;
      if (!f._fbq) f._fbq = n;
      const t = b.createElement(e) as HTMLScriptElement;
      t.async = true;
      t.src = v;
      const s = b.getElementsByTagName(e)[0];
      s.parentNode?.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq!('init', FB_PIXEL_ID);
    window.fbq!('track', 'PageView');
  }
}

export function track(event: string, params?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    window.gtag?.('event', event, params ?? {});
    window.fbq?.('trackCustom', event, params ?? {});
  } catch {
    // telemetry must never break the user flow
  }
}
