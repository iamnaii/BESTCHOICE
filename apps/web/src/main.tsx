import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from '@/contexts/AuthContext';
import ErrorBoundary from '@/components/ErrorBoundary';
import App from './App';
import './index.css';

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
      staleTime: 2 * 60 * 1000, // 2 minutes - serve from RAM cache, reduce CPU/network
      gcTime: 10 * 60 * 1000, // 10 minutes - keep data in memory longer
      refetchOnMount: 'always', // still refresh on mount but serve stale data immediately
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <App />
            <Toaster position="top-right" />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
