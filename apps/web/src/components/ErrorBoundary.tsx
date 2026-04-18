import { Component, ErrorInfo, ReactNode } from 'react';
import * as Sentry from '@sentry/react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const CHUNK_RELOAD_KEY = 'bc:chunk-load-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;

function isChunkLoadError(error: Error): boolean {
  const msg = error?.message || '';
  return (
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Loading chunk \d+ failed/i.test(msg) ||
    /Loading CSS chunk/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // If bundle was redeployed, user's stale index.html points to JS chunks
    // that no longer exist. A single full reload fetches the fresh chunk map.
    // Cooldown prevents infinite reload loop if the error isn't stale-bundle.
    if (isChunkLoadError(error)) {
      const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
      if (Date.now() - last > CHUNK_RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
        window.location.reload();
        return;
      }
    }

    // Forward the crash to Sentry so we learn about it in production.
    // Sentry.init() is a no-op when VITE_SENTRY_DSN is not configured,
    // so this is also safe in dev.
    Sentry.withScope((scope) => {
      scope.setTag('error.boundary', 'root');
      scope.setExtras({
        componentStack: errorInfo.componentStack,
      });
      Sentry.captureException(error);
    });
  }

  componentDidUpdate(prevProps: Props) {
    // Reset error state when children change (e.g. route navigation)
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-center max-w-md px-6">
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-foreground mb-2">เกิดข้อผิดพลาด</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {this.state.error?.message || 'ระบบเกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={this.handleReset}
                className="px-4 py-2 border border-border text-foreground rounded-lg text-sm font-medium hover:bg-muted"
              >
                ลองใหม่
              </button>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90"
              >
                โหลดหน้าใหม่
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
