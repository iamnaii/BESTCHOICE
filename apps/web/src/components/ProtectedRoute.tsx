import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Navigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  children: React.ReactNode;
  roles?: string[];
}

export default function ProtectedRoute({ children, roles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user, sessionError, refresh } = useAuth();
  const [retrying, setRetrying] = useState(false);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" role="status" aria-label="กำลังโหลด"></div>
      </div>
    );
  }

  if (!isAuthenticated && sessionError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center space-y-4" role="alert">
          <p className="text-muted-foreground">{sessionError}</p>
          <Button disabled={retrying} onClick={async () => {
            setRetrying(true);
            try { await refresh(); } finally { setRetrying(false); }
          }}>ลองเชื่อมต่อใหม่</Button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (roles && user && !roles.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-2">ไม่มีสิทธิ์เข้าถึง</h1>
          <p className="text-muted-foreground">คุณไม่มีสิทธิ์ในการเข้าถึงหน้านี้</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
