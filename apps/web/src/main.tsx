import '@/lib/env';
import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
  MutationCache,
} from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { EntityScopeProvider } from '@/contexts/EntityScopeContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import App from './App';
import './index.css';

// Initialize Sentry (only if DSN is configured)
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: import.meta.env.PROD ? 0.5 : 0,
    // Don't send PII to Sentry
    beforeSend(event) {
      if (event.request?.data) {
        const data = event.request.data as Record<string, unknown>;
        for (const key of ['nationalId', 'password', 'phone']) {
          if (key in data) data[key] = '[REDACTED]';
        }
      }
      return event;
    },
  });
}

/**
 * Report server errors (5xx) from react-query to Sentry. 4xx responses
 * are intentional (validation, auth, permission) — we skip them so the
 * Sentry signal isn't drowned out. Network errors have no `response` so
 * they go through as well.
 */
function reportQueryErrorToSentry(
  error: unknown,
  meta: { kind: 'query' | 'mutation'; key?: unknown },
) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return;
  }
  Sentry.withScope((scope) => {
    scope.setTag('query.kind', meta.kind);
    if (meta.key !== undefined) {
      scope.setExtra('queryKey', meta.key);
    }
    if (typeof status === 'number') {
      scope.setTag('http.status', String(status));
    }
    Sentry.captureException(error);
  });
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) =>
      reportQueryErrorToSentry(error, { kind: 'query', key: query.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      reportQueryErrorToSentry(error, {
        kind: 'mutation',
        key: mutation.options.mutationKey,
      }),
  }),
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        // Don't retry on 429 rate limit or 401 unauthorized
        if (status === 429 || status === 401) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
      staleTime: 3 * 60 * 1000, // 3 minutes - longer stale time reduces redundant API calls and CPU load
      gcTime: 10 * 60 * 1000, // 10 minutes - keep data in memory longer
      refetchOnMount: true, // only refetch on mount when data is stale (respects staleTime)
    },
  },
});

// LIFF consent redirect: LINE redirects to {endpoint}?liff.state={encodedPath}
// Must handle BEFORE React renders — works for ANY endpoint URL (/, /liff, /liff/contract, etc.)
// so the rich-menu URIs (https://liff.line.me/<id>/<path>) route correctly regardless of
// which Endpoint URL the admin set in LINE Developers Console.
const liffState = new URLSearchParams(window.location.search).get('liff.state');
if (liffState) {
  window.history.replaceState(null, '', liffState + window.location.search);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <EntityScopeProvider>
                <App />
                <Toaster position="top-right" richColors closeButton />
              </EntityScopeProvider>
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
