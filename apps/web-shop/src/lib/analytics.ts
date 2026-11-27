/// <reference types="vite/client" />

import { api } from '@/lib/api';
import {
  getConsentState,
  subscribeConsent,
  type ConsentCategory,
  type ConsentState,
} from '@/lib/consent';

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

export type ContactChannel = 'line' | 'phone' | 'messenger';

export type ShopEvent =
  | { name: 'view_product'; productId: string; productName?: string; price?: number }
  | { name: 'contact'; channel: ContactChannel }
  | { name: 'sell_lead'; flow: string; model?: string; storage?: string; grade?: string };

interface AnalyticsConfig {
  ga4MeasurementId: string | null;
  fbPixelId: string | null;
}

/** Test seam: withdrawal reloads the page through this object so tests can replace it. */
export const analyticsRuntime = { reload: () => window.location.reload() };

function cleanId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Env vars remain as a bootstrap/fallback (and as the path Vite uses in
// local dev when the backend isn't reachable). Runtime values come from
// /api/shop/public-config/analytics — backed by the IntegrationConfig table
// so the owner can rotate IDs from /settings/integrations without redeploy.
const ENV_GA4 = cleanId(import.meta.env.VITE_GA4_ID);
const ENV_PIXEL = cleanId(import.meta.env.VITE_FB_PIXEL_ID);

type Params = Record<string, unknown>;

/** Drop keys whose value is undefined so a tracker never receives `key: undefined`. */
function compact(params: Params): Params {
  const out: Params = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function finitePrice(price: number | undefined): number | undefined {
  return typeof price === 'number' && Number.isFinite(price) ? price : undefined;
}

/** Compile-time check that every ShopEvent is handled. */
function unhandled(_event: never): void {}

/** Run one vendor call; a vendor failure must never break the page or the other trackers. */
function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // telemetry must never break the user flow
  }
}

/**
 * One third-party tracker. The gating logic below (`syncTracker`, `track`) only
 * touches these fields, so another tracker (TikTok Pixel, LINE Tag) is one more
 * entry in `TRACKERS` plus its config field in `AnalyticsConfig`.
 */
interface Tracker {
  /** Consent category that must be granted before the tag may load or receive events. */
  readonly category: ConsentCategory;
  /** Field of the runtime config that carries this tracker's ID. */
  readonly configKey: keyof AnalyticsConfig;
  /** Resolved ID: env first, runtime config wins when present. null = unknown. */
  id: string | null;
  /** ID the tag was loaded with on this page; null = never loaded. */
  loadedId: string | null;
  /** Set once consent was withdrawn: no events, no reload of the tag, until the page reloads. */
  withdrawn: boolean;
  /** First load of the vendor tag. Called only when the ID is known and consent granted. */
  load(id: string, consent: ConsentState): void;
  /** The ID changed after load (runtime config): point the loaded tag at the new ID. */
  retarget(id: string): void;
  /** Loaded and still consented: react to a change in another consent category. */
  update?(consent: ConsentState): void;
  /** The vendor's documented consent revoke. */
  revoke(): void;
  /** First-party cookies this tracker writes (expired on withdrawal). */
  ownsCookie(name: string): boolean;
  /** Translate a shop event into the vendor call. */
  send(event: ShopEvent): void;
}

type ConsentValue = 'granted' | 'denied';

function adConsent(marketing: boolean): Record<string, ConsentValue> {
  const value: ConsentValue = marketing ? 'granted' : 'denied';
  return { ad_storage: value, ad_user_data: value, ad_personalization: value };
}

/** Marketing consent GA4 was last told about (consent default or the last update). */
let ga4AdGranted = false;

const ga4: Tracker = {
  category: 'analytics',
  configKey: 'ga4MeasurementId',
  id: ENV_GA4,
  loadedId: null,
  withdrawn: false,
  load(measurementId, consent) {
    window.dataLayer = window.dataLayer || [];
    // Google's snippet pushes the `arguments` object itself — keep that shape.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer!.push(arguments);
    };
    // Consent Mode v2: the default must be queued before js/config and before the tag loads.
    window.gtag('consent', 'default', {
      ...adConsent(consent.marketing),
      analytics_storage: 'granted',
    });
    ga4AdGranted = consent.marketing;
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.appendChild(script);
    window.gtag('js', new Date());
    window.gtag('config', measurementId);
  },
  retarget(measurementId) {
    window.gtag?.('config', measurementId);
  },
  update(consent) {
    if (consent.marketing === ga4AdGranted) return;
    ga4AdGranted = consent.marketing;
    window.gtag?.('consent', 'update', adConsent(consent.marketing));
  },
  revoke() {
    window.gtag?.('consent', 'update', { ...adConsent(false), analytics_storage: 'denied' });
    // `analytics_storage: denied` only switches gtag.js to consent-mode behaviour, which can
    // still send cookieless pings, and the reload below can fire a page-hide engagement beacon.
    // Google's documented opt-out flag makes gtag.js drop every further hit, and a no-op gtag
    // stops anything queued afterwards.
    if (ga4.loadedId)
      (window as unknown as Record<string, unknown>)[`ga-disable-${ga4.loadedId}`] = true;
    window.gtag = () => {};
  },
  ownsCookie: (name) => name === '_ga' || name.startsWith('_ga_'),
  send(event) {
    const gtag = window.gtag;
    if (!gtag) return;
    switch (event.name) {
      case 'view_product': {
        const price = finitePrice(event.price);
        const item = compact({ item_id: event.productId, item_name: event.productName, price });
        const money = price === undefined ? {} : { currency: 'THB', value: price };
        gtag('event', 'view_item', { items: [item], ...money });
        return;
      }
      case 'contact':
        // GA4 has no recommended contact event; this is a custom event.
        gtag('event', 'contact', { method: event.channel });
        return;
      case 'sell_lead':
        gtag(
          'event',
          'generate_lead',
          compact({
            lead_source: 'sell_form',
            flow: event.flow,
            model: event.model,
            storage: event.storage,
            grade: event.grade,
          }),
        );
        return;
      default:
        unhandled(event);
    }
  },
};

const metaPixel: Tracker = {
  category: 'marketing',
  configKey: 'fbPixelId',
  id: ENV_PIXEL,
  loadedId: null,
  withdrawn: false,
  load(pixelId) {
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
        if (s?.parentNode) s.parentNode.insertBefore(t, s);
        else b.head.appendChild(t);
      })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    }
    window.fbq!('init', pixelId);
    window.fbq!('track', 'PageView');
  },
  retarget(pixelId) {
    window.fbq?.('init', pixelId);
    window.fbq?.('track', 'PageView');
  },
  revoke() {
    window.fbq?.('consent', 'revoke');
  },
  ownsCookie: (name) => name === '_fbp' || name === '_fbc',
  send(event) {
    const fbq = window.fbq;
    if (!fbq) return;
    switch (event.name) {
      case 'view_product': {
        const price = finitePrice(event.price);
        const money = price === undefined ? {} : { value: price, currency: 'THB' };
        fbq(
          'track',
          'ViewContent',
          compact({
            content_ids: [event.productId],
            content_type: 'product',
            content_name: event.productName,
            ...money,
          }),
        );
        return;
      }
      case 'contact':
        fbq('track', 'Contact');
        return;
      case 'sell_lead':
        fbq('track', 'Lead');
        return;
      default:
        unhandled(event);
    }
  },
};

const TRACKERS: readonly Tracker[] = [ga4, metaPixel];

/** Best effort: expire the tracker's cookies on this host and its parent domains. */
function expireCookies(owns: (name: string) => boolean): void {
  const names = new Set(
    document.cookie
      .split(';')
      .map((part) => part.split('=')[0].trim())
      .filter((name) => name && owns(name)),
  );
  if (names.size === 0) return;
  const host = window.location.hostname;
  const labels = host.split('.');
  const domains: Array<string | null> = [null, `.${host}`];
  if (labels.length > 2) domains.push(`.${labels.slice(1).join('.')}`);
  for (const name of names) {
    for (const domain of domains) {
      const domainAttr = domain ? `; domain=${domain}` : '';
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; max-age=0; path=/${domainAttr}`;
    }
  }
}

/** Bring one tracker in line with the current ID and consent. Returns true when it was withdrawn. */
function syncTracker(tracker: Tracker, consent: ConsentState): boolean {
  if (tracker.withdrawn) return false;
  const granted = consent[tracker.category];
  const id = tracker.id;

  if (tracker.loadedId === null) {
    if (granted && id) {
      // Mark first so a load that throws half-way is never retried (no second <script>).
      tracker.loadedId = id;
      attempt(() => tracker.load(id, consent));
    }
    return false;
  }

  if (!granted) {
    tracker.withdrawn = true;
    attempt(() => tracker.revoke());
    attempt(() => expireCookies(tracker.ownsCookie));
    return true;
  }

  if (id && id !== tracker.loadedId) {
    tracker.loadedId = id;
    attempt(() => tracker.retarget(id));
  }
  attempt(() => tracker.update?.(consent));
  return false;
}

function syncTrackers(): void {
  const consent = getConsentState();
  let withdrew = false;
  for (const tracker of TRACKERS) {
    if (syncTracker(tracker, consent)) withdrew = true;
  }
  if (withdrew) {
    // Vendor docs do not guarantee that an already-loaded tag stops every request
    // after a consent revoke. Reloading under the denied choice guarantees the
    // script is never loaded again on this page.
    analyticsRuntime.reload();
  }
}

async function fetchRuntimeConfig(): Promise<AnalyticsConfig | null> {
  try {
    const res = await api.get<AnalyticsConfig>('/api/shop/public-config/analytics');
    return res.data;
  } catch {
    return null;
  }
}

const LINE_HOSTS = new Set(['line.me', 'lin.ee']);
const MESSENGER_HOSTS = new Set(['m.me', 'www.messenger.com', 'messenger.com']);

/** Maps an anchor href to a contact channel, or null. Exported for tests. */
export function contactChannelFromHref(href: string): ContactChannel | null {
  const value = href.trim();
  if (value.toLowerCase().startsWith('tel:')) return 'phone';
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return null;
  }
  // Exact hosts only: access.line.me is the LINE Login authorize page, not a chat.
  if (LINE_HOSTS.has(hostname)) return 'line';
  if (MESSENGER_HOSTS.has(hostname)) return 'messenger';
  return null;
}

/** Capture phase, so it runs even when a page handler stops propagation. Never cancels navigation. */
function onDocumentClick(event: MouseEvent): void {
  try {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest('a[href]');
    if (!anchor) return;
    const channel = contactChannelFromHref(anchor.getAttribute('href') ?? '');
    if (channel) track({ name: 'contact', channel });
  } catch {
    // telemetry must never break the user flow
  }
}

let initialized = false;

/** Resolve tracker IDs, subscribe to consent, install the contact-click listener. Idempotent. */
export function initAnalytics(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  subscribeConsent(() => syncTrackers());
  document.addEventListener('click', onDocumentClick, true);
  syncTrackers();

  void fetchRuntimeConfig().then((cfg) => {
    if (!cfg) return;
    for (const tracker of TRACKERS) {
      const runtimeId = cleanId(cfg[tracker.configKey]);
      if (runtimeId) tracker.id = runtimeId;
    }
    syncTrackers();
  });
}

/** The only exit to third-party trackers. Sends to each installed tracker whose category is consented. Never throws. */
export function track(event: ShopEvent): void {
  if (typeof window === 'undefined') return;
  try {
    const consent = getConsentState();
    for (const tracker of TRACKERS) {
      if (tracker.loadedId === null || tracker.withdrawn || !consent[tracker.category]) continue;
      attempt(() => tracker.send(event));
    }
  } catch {
    // telemetry must never break the user flow
  }
}
