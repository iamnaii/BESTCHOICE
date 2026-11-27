import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { CONSENT_POLICY_VERSION, CONSENT_STORAGE_KEY } from './consent';

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }));
vi.mock('./api', () => ({ api: { get: mocks.apiGet } }));

type AnalyticsModule = typeof import('./analytics');
type ConsentModule = typeof import('./consent');

interface EnvIds {
  ga4?: string;
  pixel?: string;
}

const BOTH_IDS: EnvIds = { ga4: 'G-TEST', pixel: '123' };
const NO_IDS: EnvIds = {};

let reload: Mock<() => void>;
let removeAddedDocumentListeners: () => void = () => {};

function storeConsent(analytics: boolean, marketing: boolean): void {
  localStorage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({
      version: CONSENT_POLICY_VERSION,
      analytics,
      marketing,
      decidedAt: '2026-11-27T00:00:00.000Z',
    }),
  );
}

/** Fresh module graph per test: analytics holds module-level state. */
async function load(env: EnvIds = BOTH_IDS): Promise<{
  analytics: AnalyticsModule;
  consent: ConsentModule;
}> {
  vi.stubEnv('VITE_GA4_ID', env.ga4 ?? '');
  vi.stubEnv('VITE_FB_PIXEL_ID', env.pixel ?? '');
  vi.resetModules();
  const analytics = await import('./analytics');
  const consent = await import('./consent');
  analytics.analyticsRuntime.reload = reload;
  return { analytics, consent };
}

async function start(env: EnvIds = BOTH_IDS) {
  const modules = await load(env);
  modules.analytics.initAnalytics();
  return modules;
}

function scriptsWithSrc(needle: string): HTMLScriptElement[] {
  return Array.from(document.querySelectorAll('script')).filter((s) =>
    (s.getAttribute('src') ?? '').includes(needle),
  );
}
const gaScripts = () => scriptsWithSrc('googletagmanager.com');
const fbScripts = () => scriptsWithSrc('connect.facebook.net');

function toArray(entry: unknown): unknown[] {
  return Array.from(entry as ArrayLike<unknown>);
}
function dataLayer(): unknown[][] {
  return (window.dataLayer ?? []).map(toArray);
}
function fbQueue(): unknown[][] {
  const fbq = window.fbq as unknown as { queue?: unknown[] } | undefined;
  return (fbq?.queue ?? []).map(toArray);
}
function gaEvents(name: string): unknown[][] {
  return dataLayer().filter((e) => e[0] === 'event' && e[1] === name);
}
function fbTracks(name: string): unknown[][] {
  return fbQueue().filter((e) => e[0] === 'track' && e[1] === name);
}

function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((part) => part.split('=')[0].trim())
    .filter(Boolean);
}
function clearCookies(): void {
  for (const name of cookieNames()) {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const ALL_DENIED = {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
};

beforeEach(() => {
  localStorage.clear();
  clearCookies();
  document.querySelectorAll('script').forEach((s) => s.remove());
  document.body.innerHTML = '';
  // The Meta loader inserts before the first <script> in the document.
  document.head.appendChild(document.createElement('script'));
  delete window.gtag;
  for (const key of Object.keys(window))
    if (key.startsWith('ga-disable-')) delete (window as never as Record<string, unknown>)[key];
  delete window.dataLayer;
  delete window.fbq;
  delete window._fbq;
  mocks.apiGet.mockReset();
  mocks.apiGet.mockRejectedValue(new Error('offline'));
  reload = vi.fn();
  // Each fresh module graph adds its own click listener; drop them so earlier
  // graphs cannot react to clicks in later tests.
  const addSpy = vi.spyOn(document, 'addEventListener');
  removeAddedDocumentListeners = () => {
    for (const [type, listener, options] of addSpy.mock.calls) {
      document.removeEventListener(type, listener, options);
    }
  };
});

afterEach(() => {
  removeAddedDocumentListeners();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('nothing loads without consent', () => {
  test('IDs present, no decision → no tracker scripts or globals', async () => {
    await start();
    expect(gaScripts()).toHaveLength(0);
    expect(fbScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
    expect(window.fbq).toBeUndefined();
  });

  test('both categories declined before init → no tracker scripts or globals', async () => {
    storeConsent(false, false);
    await start();
    expect(gaScripts()).toHaveLength(0);
    expect(fbScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
    expect(window.fbq).toBeUndefined();
  });

  test('consent given but no ID known → nothing loads', async () => {
    storeConsent(true, true);
    await start(NO_IDS);
    await flush();
    expect(gaScripts()).toHaveLength(0);
    expect(fbScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(window.fbq).toBeUndefined();
  });
});

describe('install under consent', () => {
  test('analytics only → GA4 with consent default before js/config, no Meta', async () => {
    storeConsent(true, false);
    let dataLayerWhenScriptAppended: unknown[][] | null = null;
    const appendChild = document.head.appendChild.bind(document.head);
    vi.spyOn(document.head, 'appendChild').mockImplementation((node) => {
      if (node instanceof HTMLScriptElement && node.src.includes('googletagmanager.com')) {
        dataLayerWhenScriptAppended = dataLayer();
      }
      return appendChild(node);
    });

    await start();

    expect(gaScripts()).toHaveLength(1);
    expect(gaScripts()[0].src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST');
    expect(gaScripts()[0].async).toBe(true);
    expect(fbScripts()).toHaveLength(0);
    expect(window.fbq).toBeUndefined();

    const entries = dataLayer();
    const defaultIdx = entries.findIndex((e) => e[0] === 'consent' && e[1] === 'default');
    const jsIdx = entries.findIndex((e) => e[0] === 'js');
    const configIdx = entries.findIndex((e) => e[0] === 'config');
    expect(entries[defaultIdx]).toEqual([
      'consent',
      'default',
      {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'granted',
      },
    ]);
    expect(entries[jsIdx][1]).toBeInstanceOf(Date);
    expect(entries[configIdx]).toEqual(['config', 'G-TEST']);
    expect(defaultIdx).toBeGreaterThanOrEqual(0);
    expect(defaultIdx).toBeLessThan(jsIdx);
    expect(jsIdx).toBeLessThan(configIdx);

    // the Google tag is added only after the consent default is queued
    expect(dataLayerWhenScriptAppended).toEqual([entries[defaultIdx]]);
  });

  test('marketing only → Meta loads with init then PageView, no GA4', async () => {
    storeConsent(false, true);
    await start();
    expect(fbScripts()).toHaveLength(1);
    expect(fbScripts()[0].src).toBe('https://connect.facebook.net/en_US/fbevents.js');
    expect(gaScripts()).toHaveLength(0);
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();

    const queue = fbQueue();
    const initIdx = queue.findIndex((e) => e[0] === 'init' && e[1] === '123');
    const pageViewIdx = queue.findIndex((e) => e[0] === 'track' && e[1] === 'PageView');
    expect(initIdx).toBeGreaterThanOrEqual(0);
    expect(pageViewIdx).toBeGreaterThan(initIdx);
  });

  test('undecided then accept all → both load once; same choice again adds nothing', async () => {
    const { consent } = await start();
    expect(gaScripts()).toHaveLength(0);

    consent.saveConsent({ analytics: true, marketing: true });
    expect(gaScripts()).toHaveLength(1);
    expect(fbScripts()).toHaveLength(1);
    expect(dataLayer()).toContainEqual([
      'consent',
      'default',
      {
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted',
        analytics_storage: 'granted',
      },
    ]);

    const before = { data: dataLayer().length, fb: fbQueue().length };
    consent.saveConsent({ analytics: true, marketing: true });
    expect(gaScripts()).toHaveLength(1);
    expect(fbScripts()).toHaveLength(1);
    expect(dataLayer()).toHaveLength(before.data);
    expect(fbQueue()).toHaveLength(before.fb);
    expect(reload).not.toHaveBeenCalled();
  });

  test('GA4 loaded with marketing denied, marketing then granted → consent update', async () => {
    storeConsent(true, false);
    const { consent } = await start();
    consent.saveConsent({ analytics: true, marketing: true });
    expect(dataLayer()).toContainEqual([
      'consent',
      'update',
      { ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' },
    ]);
    expect(gaScripts()).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });

  test('initAnalytics twice does not load a tracker twice', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.initAnalytics();
    expect(gaScripts()).toHaveLength(1);
    expect(fbScripts()).toHaveLength(1);
    expect(dataLayer().filter((e) => e[0] === 'config')).toHaveLength(1);
    expect(fbQueue().filter((e) => e[0] === 'init')).toHaveLength(1);
  });
});

describe('withdrawal', () => {
  test('analytics withdrawn → GA4 consent denied, GA cookies expired, one reload', async () => {
    storeConsent(true, true);
    document.cookie = '_ga=GA1.1.111.222; path=/';
    document.cookie = '_ga_ABC123=GS1.1.333; path=/';
    document.cookie = '_fbp=fb.1.444; path=/';
    document.cookie = 'unrelated=1; path=/';
    const { consent } = await start();

    consent.saveConsent({ analytics: false, marketing: true });

    expect(dataLayer()).toContainEqual(['consent', 'update', ALL_DENIED]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(cookieNames()).not.toContain('_ga');
    expect(cookieNames()).not.toContain('_ga_ABC123');
    expect(cookieNames()).toContain('_fbp');
    expect(cookieNames()).toContain('unrelated');
    expect(fbQueue()).not.toContainEqual(['consent', 'revoke']);

    // the same choice again does not withdraw (or reload) a second time
    consent.saveConsent({ analytics: false, marketing: true });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('analytics withdrawn → GA4 opt-out flag set and nothing more reaches the dataLayer', async () => {
    storeConsent(true, true);
    const { analytics, consent } = await start();
    const id = BOTH_IDS.ga4 as string;

    consent.saveConsent({ analytics: false, marketing: true });

    expect((window as never as Record<string, unknown>)[`ga-disable-${id}`]).toBe(true);
    const before = dataLayer().length;
    expect(() => analytics.track({ name: 'view_product', productId: 'x' })).not.toThrow();
    expect(() => window.gtag?.('event', 'page_view')).not.toThrow();
    expect(dataLayer()).toHaveLength(before);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('marketing withdrawn → Meta revoke, Meta cookies expired, GA4 ad consent denied, one reload', async () => {
    storeConsent(true, true);
    document.cookie = '_fbp=fb.1.444; path=/';
    document.cookie = '_fbc=fb.1.555; path=/';
    document.cookie = '_ga=GA1.1.111.222; path=/';
    const { consent } = await start();

    consent.saveConsent({ analytics: true, marketing: false });

    expect(fbQueue()).toContainEqual(['consent', 'revoke']);
    expect(dataLayer()).toContainEqual([
      'consent',
      'update',
      { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' },
    ]);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(cookieNames()).not.toContain('_fbp');
    expect(cookieNames()).not.toContain('_fbc');
    expect(cookieNames()).toContain('_ga');
  });

  test('both withdrawn → one reload for the change', async () => {
    storeConsent(true, true);
    const { consent } = await start();
    consent.saveConsent({ analytics: false, marketing: false });
    expect(dataLayer()).toContainEqual(['consent', 'update', ALL_DENIED]);
    expect(fbQueue()).toContainEqual(['consent', 'revoke']);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('undecided then decline all → no reload, nothing loads', async () => {
    const { consent } = await start();
    consent.saveConsent({ analytics: false, marketing: false });
    expect(reload).not.toHaveBeenCalled();
    expect(window.gtag).toBeUndefined();
    expect(window.fbq).toBeUndefined();
  });

  test('consent is checked at call time, even before trackers have re-synced', async () => {
    storeConsent(true, true);
    const { analytics, consent } = await load();
    // subscribed before initAnalytics, so it runs before the trackers react to the change
    consent.subscribeConsent(() => analytics.track({ name: 'contact', channel: 'line' }));
    analytics.initAnalytics();
    consent.saveConsent({ analytics: false, marketing: false });
    expect(gaEvents('contact')).toHaveLength(0);
    expect(fbTracks('Contact')).toHaveLength(0);
  });

  test('a withdrawn tracker receives no more events', async () => {
    storeConsent(true, true);
    const { analytics, consent } = await start();
    consent.saveConsent({ analytics: true, marketing: false });
    analytics.track({ name: 'contact', channel: 'line' });
    expect(gaEvents('contact')).toHaveLength(1);
    expect(fbTracks('Contact')).toHaveLength(0);
  });
});

describe('tracker IDs', () => {
  test('runtime config supplies the ID when env has none', async () => {
    storeConsent(true, true);
    mocks.apiGet.mockResolvedValue({ data: { ga4MeasurementId: 'G-RT', fbPixelId: null } });
    await start(NO_IDS);
    await flush();
    expect(mocks.apiGet).toHaveBeenCalledWith('/api/shop/public-config/analytics');
    expect(gaScripts()).toHaveLength(1);
    expect(gaScripts()[0].src).toContain('id=G-RT');
    expect(fbScripts()).toHaveLength(0);
  });

  test('runtime config resolved before consent → loads with that ID once consent is given', async () => {
    mocks.apiGet.mockResolvedValue({ data: { ga4MeasurementId: 'G-RT', fbPixelId: '999' } });
    const { consent } = await start(NO_IDS);
    await flush();
    expect(gaScripts()).toHaveLength(0);
    expect(fbScripts()).toHaveLength(0);

    consent.saveConsent({ analytics: true, marketing: true });
    expect(gaScripts()[0].src).toContain('id=G-RT');
    expect(fbQueue()).toContainEqual(['init', '999']);
  });

  test('runtime ID wins over env ID without loading a second script', async () => {
    storeConsent(true, true);
    mocks.apiGet.mockResolvedValue({ data: { ga4MeasurementId: 'G-RT', fbPixelId: '999' } });
    await start();
    await flush();
    expect(gaScripts()).toHaveLength(1);
    expect(fbScripts()).toHaveLength(1);
    expect(dataLayer()).toContainEqual(['config', 'G-RT']);
    expect(fbQueue()).toContainEqual(['init', '999']);
  });

  test('a failed config fetch is silent and keeps env IDs', async () => {
    storeConsent(true, true);
    await start();
    await flush();
    expect(gaScripts()[0].src).toContain('id=G-TEST');
    expect(fbQueue()).toContainEqual(['init', '123']);
  });
});

describe('track()', () => {
  test('view_product with name and price', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.track({
      name: 'view_product',
      productId: 'p1',
      productName: 'iPhone 15',
      price: 15900,
    });
    expect(dataLayer()).toContainEqual([
      'event',
      'view_item',
      {
        items: [{ item_id: 'p1', item_name: 'iPhone 15', price: 15900 }],
        currency: 'THB',
        value: 15900,
      },
    ]);
    expect(fbQueue()).toContainEqual([
      'track',
      'ViewContent',
      {
        content_ids: ['p1'],
        content_type: 'product',
        content_name: 'iPhone 15',
        value: 15900,
        currency: 'THB',
      },
    ]);
  });

  test('view_product without optional fields sends exactly the required params', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.track({ name: 'view_product', productId: 'p1' });
    expect(gaEvents('view_item')).toHaveLength(1);
    expect(gaEvents('view_item')[0][2]).toStrictEqual({ items: [{ item_id: 'p1' }] });
    expect(fbTracks('ViewContent')).toHaveLength(1);
    expect(fbTracks('ViewContent')[0][2]).toStrictEqual({
      content_ids: ['p1'],
      content_type: 'product',
    });
  });

  test('view_product with a non-finite price omits price, currency and value', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.track({ name: 'view_product', productId: 'p1', price: Number.NaN });
    expect(gaEvents('view_item')[0][2]).toStrictEqual({ items: [{ item_id: 'p1' }] });
    expect(fbTracks('ViewContent')[0][2]).toStrictEqual({
      content_ids: ['p1'],
      content_type: 'product',
    });
  });

  test('contact', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.track({ name: 'contact', channel: 'line' });
    expect(dataLayer()).toContainEqual(['event', 'contact', { method: 'line' }]);
    expect(fbTracks('Contact')).toEqual([['track', 'Contact']]);
  });

  test('sell_lead omits undefined keys', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.track({ name: 'sell_lead', flow: 'BUYBACK', model: 'iPhone 13' });
    expect(gaEvents('generate_lead')).toHaveLength(1);
    expect(gaEvents('generate_lead')[0]).toStrictEqual([
      'event',
      'generate_lead',
      { lead_source: 'sell_form', flow: 'BUYBACK', model: 'iPhone 13' },
    ]);
    expect(fbTracks('Lead')).toEqual([['track', 'Lead']]);
  });

  test('never uses trackCustom', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    analytics.track({ name: 'view_product', productId: 'p1', price: 100 });
    analytics.track({ name: 'contact', channel: 'phone' });
    analytics.track({ name: 'sell_lead', flow: 'TRADE_IN' });
    expect(fbQueue().filter((e) => e[0] === 'trackCustom')).toHaveLength(0);
  });

  test('only analytics consented → reaches GA4, Meta never created', async () => {
    storeConsent(true, false);
    const { analytics } = await start();
    analytics.track({ name: 'contact', channel: 'phone' });
    expect(dataLayer()).toContainEqual(['event', 'contact', { method: 'phone' }]);
    expect(window.fbq).toBeUndefined();
  });

  test('no decision → track does not throw and creates no globals', async () => {
    const { analytics } = await start();
    expect(() => {
      analytics.track({ name: 'view_product', productId: 'p1', price: 100 });
      analytics.track({ name: 'contact', channel: 'messenger' });
      analytics.track({ name: 'sell_lead', flow: 'BUYBACK' });
    }).not.toThrow();
    expect(window.gtag).toBeUndefined();
    expect(window.dataLayer).toBeUndefined();
    expect(window.fbq).toBeUndefined();
  });

  test('a throwing tracker does not throw out of track()', async () => {
    storeConsent(true, true);
    const { analytics } = await start();
    window.gtag = () => {
      throw new Error('vendor broke');
    };
    expect(() => analytics.track({ name: 'contact', channel: 'line' })).not.toThrow();
    // Meta still receives the event
    expect(fbTracks('Contact')).toHaveLength(1);
  });
});

describe('contactChannelFromHref', () => {
  test.each([
    ['tel:+66955678887', 'phone'],
    ['https://line.me/R/ti/p/@bestchoice', 'line'],
    ['https://line.me/R/oaMessage/%40bestchoice/?hi', 'line'],
    ['https://lin.ee/abc', 'line'],
    ['https://m.me/bestchoicelopburi?ref=p:1', 'messenger'],
    ['https://www.messenger.com/t/bestchoicelopburi', 'messenger'],
    ['https://messenger.com/t/bestchoicelopburi', 'messenger'],
    ['https://access.line.me/oauth2/v2.1/authorize?x=1', null],
    ['https://www.facebook.com/bestchoicelopburi', null],
    ['mailto:a@b.c', null],
    ['not a url', null],
    ['/products', null],
    ['', null],
  ])('%s → %s', async (href, expected) => {
    const { analytics } = await load();
    expect(analytics.contactChannelFromHref(href)).toBe(expected);
  });
});

describe('contact-click listener', () => {
  function appendContactLink(href: string): { span: HTMLSpanElement; prevented: () => boolean } {
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    const span = document.createElement('span');
    anchor.appendChild(span);
    document.body.appendChild(anchor);
    let defaultPreventedBeforePage: boolean | null = null;
    // stands in for the browser: record whether anything before us cancelled, then stop jsdom navigating
    anchor.addEventListener('click', (event) => {
      defaultPreventedBeforePage = event.defaultPrevented;
      event.preventDefault();
    });
    return { span, prevented: () => defaultPreventedBeforePage === true };
  }

  test('click inside a tel: link sends one Contact and does not cancel navigation', async () => {
    storeConsent(false, true);
    const { analytics } = await start();
    analytics.initAnalytics();
    const link = appendContactLink('tel:+66955678887');

    link.span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(fbTracks('Contact')).toEqual([['track', 'Contact']]);
    expect(link.prevented()).toBe(false);
  });

  test('click on a non-contact link sends nothing', async () => {
    storeConsent(true, true);
    await start();
    const link = appendContactLink('https://www.facebook.com/bestchoicelopburi');
    link.span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fbTracks('Contact')).toHaveLength(0);
    expect(gaEvents('contact')).toHaveLength(0);
  });
});
