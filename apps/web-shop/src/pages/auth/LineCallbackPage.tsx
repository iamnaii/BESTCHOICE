import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { MessageCircle } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import { Button, Card, CardBody, Container, LoadingState, Stack } from '@/components';
import { api } from '@/lib/api';
import { copy, shopInfo } from '@/lib/copy';
import { useAuth } from '@/hooks/useAuth';
import {
  LINE_LOGIN_RETURN_TO_KEY,
  LINE_LOGIN_STATE_KEY,
  sanitizeReturnTo,
} from './LoginPage';

interface SocialLoginResult {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    lineId: string | null;
    loyaltyBalance: number;
  } | null;
  token: string | null;
  requiresPhoneBinding: boolean;
}

type Status = 'working' | 'not-linked' | 'error';

export default function LineCallbackPage() {
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const { setAuth } = useAuth();
  const [status, setStatus] = useState<Status>('working');
  // React 18 StrictMode mounts effects twice in dev — the OAuth code is
  // single-use, so guard against a double exchange.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const expectedState = sessionStorage.getItem(LINE_LOGIN_STATE_KEY);
    const returnTo = sanitizeReturnTo(sessionStorage.getItem(LINE_LOGIN_RETURN_TO_KEY));
    sessionStorage.removeItem(LINE_LOGIN_STATE_KEY);
    sessionStorage.removeItem(LINE_LOGIN_RETURN_TO_KEY);

    // Scrub code+state from the address bar right away so analytics
    // page-view events (GA4/FB Pixel capture the full URL) never see the
    // single-use OAuth code.
    window.history.replaceState(null, '', '/auth/line-callback');

    if (!code || !state || !expectedState || state !== expectedState) {
      setStatus('error');
      return;
    }

    api
      .post('/api/shop/auth/line/callback', { code })
      .then((r) => {
        const result: SocialLoginResult = r.data;
        if (result.token && result.customer) {
          setAuth(result.customer, result.token);
          nav(returnTo, { replace: true });
        } else if (result.requiresPhoneBinding) {
          setStatus('not-linked');
        } else {
          setStatus('error');
        }
      })
      .catch(() => setStatus('error'));
  }, [searchParams, setAuth, nav]);

  return (
    <ShopLayout>
      <Container>
        <div className="py-10 md:py-14 max-w-md mx-auto">
          {status === 'working' ? (
            <Stack gap={4}>
              <p className="text-sm text-muted-foreground leading-snug text-center">
                {copy.login.loggingIn}
              </p>
              <LoadingState variant="list" rows={2} />
            </Stack>
          ) : (
            <Card>
              <CardBody>
                <Stack gap={4}>
                  <div className="leading-snug">
                    <h2 className="text-lg font-semibold">
                      {status === 'not-linked' ? copy.login.notLinkedTitle : copy.login.errorTitle}
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {status === 'not-linked'
                        ? copy.login.notLinkedDescription
                        : copy.login.errorDescription}
                    </p>
                  </div>
                  {status === 'not-linked' && (
                    <Button asChild variant="primary" size="lg" fullWidth>
                      <a href={shopInfo.lineUrl} target="_blank" rel="noopener noreferrer">
                        <MessageCircle className="size-5" aria-hidden="true" />
                        ทักไลน์ {shopInfo.lineHandle}
                      </a>
                    </Button>
                  )}
                  <Button asChild variant="outline" size="lg" fullWidth>
                    <Link to="/login">{copy.login.backToLogin}</Link>
                  </Button>
                </Stack>
              </CardBody>
            </Card>
          )}
        </div>
      </Container>
    </ShopLayout>
  );
}
