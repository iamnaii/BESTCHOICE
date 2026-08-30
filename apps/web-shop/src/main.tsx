import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { initAnalytics } from './lib/analytics';
import { redirectLegacyHost } from './lib/canonical-host';
import './index.css';

function bootstrap() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, refetchOnWindowFocus: false } },
  });

  initAnalytics();

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <App />
            <Toaster richColors position="top-center" />
          </BrowserRouter>
        </AuthProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

// เด้งออกจากโดเมนเก่าก่อน แล้วค่อย mount — ถ้ากำลังเด้งอยู่ไม่ต้อง mount ให้เสียแรง
// (และไม่ต้องยิง analytics ซ้ำจาก origin ที่กำลังจะทิ้ง)
if (!redirectLegacyHost()) {
  bootstrap();
}
