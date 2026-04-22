/// <reference types="vite/client" />

import { api } from './api';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

interface AnalyticsConfig {
  ga4MeasurementId: string | null;
  fbPixelId: string | null;
}

// Env vars remain as a bootstrap/fallback (and as the path Vite uses in
// local dev when the backend isn't reachable). Runtime values come from
// /api/shop/public-config/analytics — backed by the IntegrationConfig table
// so the owner can rotate IDs from /settings/integrations without redeploy.
const ENV_GA4 = (import.meta.env.VITE_GA4_ID as string | undefined)?.trim() || null;
const ENV_PIXEL = (import.meta.env.VITE_FB_PIXEL_ID as string | undefined)?.trim() || null;

let ga4Inited: string | null = null;
let pixelInited: string | null = null;

function installGa4(measurementId: string): void {
  if (ga4Inited === measurementId) return;
  if (ga4Inited && ga4Inited !== measurementId) {
    // Same session, different ID — this shouldn't happen in practice;
    // re-config the existing gtag rather than loading a second loader.
    window.gtag?.('config', measurementId);
    ga4Inited = measurementId;
    return;
  }
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag(...args: unknown[]) {
    window.dataLayer!.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);
  ga4Inited = measurementId;
}

function installFbPixel(pixelId: string): void {
  if (pixelInited === pixelId) return;
  if (!window.fbq) {
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
  }
  window.fbq!('init', pixelId);
  window.fbq!('track', 'PageView');
  pixelInited = pixelId;
}

async function fetchRuntimeConfig(): Promise<AnalyticsConfig | null> {
  try {
    const res = await api.get<AnalyticsConfig>('/api/shop/public-config/analytics');
    return res.data;
  } catch {
    return null;
  }
}

/**
 * Bootstraps analytics providers. Uses env vars immediately (so events can
 * flow on first paint when they're present), then asynchronously fetches
 * runtime overrides from /api/shop/public-config/analytics — which lets
 * the owner rotate GA4/Pixel IDs from /settings/integrations without redeploy.
 */
export function initAnalytics(): void {
  if (typeof window === 'undefined') return;

  if (ENV_GA4) installGa4(ENV_GA4);
  if (ENV_PIXEL) installFbPixel(ENV_PIXEL);

  void fetchRuntimeConfig().then((cfg) => {
    if (!cfg) return;
    if (cfg.ga4MeasurementId) installGa4(cfg.ga4MeasurementId);
    if (cfg.fbPixelId) installFbPixel(cfg.fbPixelId);
  });
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
