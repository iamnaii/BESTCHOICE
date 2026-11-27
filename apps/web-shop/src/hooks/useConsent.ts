import { useSyncExternalStore } from 'react';
import { getConsentState, subscribeConsent, type ConsentState } from '@/lib/consent';

export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribeConsent, getConsentState, getConsentState);
}
