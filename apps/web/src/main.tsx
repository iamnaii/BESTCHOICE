import '@/lib/env';
import * as Sentry from '@sentry/react';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/contexts/AuthContext';
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

const queryClient = new QueryClient({
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
              <Toaster position="top-right" richColors closeButton />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
