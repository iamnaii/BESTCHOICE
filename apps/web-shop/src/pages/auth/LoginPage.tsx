import { useQuery } from '@tanstack/react-query';
import { Navigate, useSearchParams } from 'react-router';
import { MessageCircle } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  LoadingState,
  Stack,
} from '@/components';
import { api } from '@/lib/api';
import { copy, shopInfo } from '@/lib/copy';
import { useAuth } from '@/hooks/useAuth';

interface PublicAuthConfig {
  lineLoginEnabled: boolean;
  lineLoginChannelId: string | null;
  lineLoginRedirectUri: string | null;
}

export const LINE_LOGIN_STATE_KEY = 'shop_line_login_state';
export const LINE_LOGIN_RETURN_TO_KEY = 'shop_line_login_return_to';

/**
 * Only same-site paths — never absolute URLs — so returnTo can't open-redirect.
 * Backslashes are rejected too: browsers normalize '/\evil.com' into a
 * protocol-relative URL, and the history API throws on it.
 */
export function sanitizeReturnTo(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) return raw;
  return '/account';
}

export default function LoginPage() {
  const { customer, hydrating } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));

  const { data: config, isLoading } = useQuery<PublicAuthConfig>({
    queryKey: ['shop', 'public-config', 'auth'],
    queryFn: () => api.get('/api/shop/public-config/auth').then((r) => r.data),
    staleTime: 5 * 60_000,
  });

  if (!hydrating && customer) {
    return <Navigate to={returnTo} replace />;
  }

  function startLineLogin() {
    if (!config?.lineLoginEnabled || !config.lineLoginChannelId || !config.lineLoginRedirectUri) {
      return;
    }
    const state = crypto.randomUUID();
    sessionStorage.setItem(LINE_LOGIN_STATE_KEY, state);
    sessionStorage.setItem(LINE_LOGIN_RETURN_TO_KEY, returnTo);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.lineLoginChannelId,
      redirect_uri: config.lineLoginRedirectUri,
      state,
      scope: 'profile openid',
    });
    window.location.assign(`https://access.line.me/oauth2/v2.1/authorize?${params}`);
  }

  return (
    <ShopLayout>
      <CategoryHero
        title={copy.login.pageTitle}
        description={copy.login.intro}
        breadcrumbs={[{ label: 'หน้าแรก', to: '/' }, { label: copy.login.pageTitle }]}
      />
      <Container>
        <div className="py-10 md:py-14 max-w-md mx-auto">
          {isLoading || hydrating ? (
            <LoadingState variant="list" rows={3} />
          ) : config?.lineLoginEnabled ? (
            <Card>
              <CardBody>
                <Stack gap={4}>
                  <p className="text-sm text-muted-foreground leading-snug">
                    {copy.login.intro}
                  </p>
                  <Button variant="primary" size="lg" fullWidth onClick={startLineLogin}>
                    <MessageCircle className="size-5" aria-hidden="true" />
                    {copy.login.lineCta}
                  </Button>
                </Stack>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody>
                <Stack gap={4}>
                  <div className="leading-snug">
                    <h2 className="text-lg font-semibold">{copy.login.disabledTitle}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {copy.login.disabledDescription}
                    </p>
                  </div>
                  <Button asChild variant="primary" size="lg" fullWidth>
                    <a href={shopInfo.lineUrl} target="_blank" rel="noopener noreferrer">
                      <MessageCircle className="size-5" aria-hidden="true" />
                      ทักไลน์ {shopInfo.lineHandle}
                    </a>
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
