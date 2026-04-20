import { api } from './api';
import { getSessionId } from './session';

export async function trackPageView(pagePath: string): Promise<void> {
  try {
    const params = new URLSearchParams(window.location.search);
    await api.post('/api/shop/track', {
      sessionId: getSessionId(),
      pagePath,
      referrer: document.referrer,
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
    });
  } catch {
    // silent fail — analytics shouldn't break user experience
  }
}
