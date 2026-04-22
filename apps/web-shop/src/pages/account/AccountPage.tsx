import { Link, useNavigate } from 'react-router';
import { BadgeCheck, FileText, LogOut, MapPin, Package, PiggyBank } from 'lucide-react';
import ShopLayout from '@/components/layout/ShopLayout';
import { useAuth } from '@/hooks/useAuth';
import { CategoryHero, Card, CardBody, Container, Stack } from '@/components';

interface HubItem {
  to?: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
}

export default function AccountPage() {
  const { customer, logout } = useAuth();
  const nav = useNavigate();
  if (!customer) {
    nav('/login');
    return null;
  }

  const hubs: HubItem[] = [
    { to: '/orders', label: 'ออเดอร์', icon: <Package className="size-6" /> },
    { to: '/account/addresses', label: 'ที่อยู่', icon: <MapPin className="size-6" /> },
    {
      to: '/account/saving-plans',
      label: 'แผนออมดาวน์',
      icon: <PiggyBank className="size-6" />,
    },
    { to: '/apply', label: 'ใบสมัครผ่อน', icon: <FileText className="size-6" /> },
    { label: 'ออกจากระบบ', icon: <LogOut className="size-6" />, onClick: logout },
  ];

  return (
    <ShopLayout>
      <CategoryHero title={customer.name ?? 'บัญชีของฉัน'} />
      <Container>
        <div className="py-6 md:py-8">
          <Stack gap={6}>
            <Card
              variant="elevated"
              className="bg-gradient-to-r from-emerald-50 to-emerald-100"
            >
              <CardBody>
                <div className="flex items-center gap-3 leading-snug">
                  <div className="flex size-12 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <BadgeCheck className="size-6" />
                  </div>
                  <div>
                    <div className="text-sm text-emerald-900">คะแนนสะสม</div>
                    <div className="leading-snug">
                      <span className="text-3xl font-bold text-emerald-600">
                        {customer.loyaltyBalance ?? 0}
                      </span>
                      <span className="ml-1 text-sm text-emerald-900">คะแนน</span>
                    </div>
                  </div>
                </div>
              </CardBody>
            </Card>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {hubs.map((h) =>
                h.to ? (
                  <Card key={h.label} variant="interactive">
                    <Link
                      to={h.to}
                      className="flex flex-col items-center gap-2 p-4 leading-snug"
                    >
                      <span className="text-emerald-500">{h.icon}</span>
                      <span className="text-sm font-medium text-foreground">{h.label}</span>
                    </Link>
                  </Card>
                ) : (
                  <Card key={h.label} variant="interactive">
                    <button
                      type="button"
                      onClick={h.onClick}
                      className="flex w-full flex-col items-center gap-2 p-4 leading-snug"
                    >
                      <span className="text-emerald-500">{h.icon}</span>
                      <span className="text-sm font-medium text-foreground">{h.label}</span>
                    </button>
                  </Card>
                ),
              )}
            </div>
          </Stack>
        </div>
      </Container>
    </ShopLayout>
  );
}
