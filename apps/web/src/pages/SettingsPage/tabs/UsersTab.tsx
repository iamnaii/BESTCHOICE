import { Link } from 'react-router';
import { MakerCheckerToggle } from '../components/MakerCheckerToggle';
import { PettyCashCustodianCard } from '../components/PettyCashCustodianCard';
import { ReversePermissionCard } from '../components/ReversePermissionCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users } from 'lucide-react';

export function UsersTab() {
  return (
    <div className="space-y-4">
      <MakerCheckerToggle />

      {/* InternalControlActionBar — Setting 1: reverse-permission mode +
          per-user override. Sits next to MakerCheckerToggle because both
          control segregation-of-duties / approval authority. */}
      <ReversePermissionCard />

      {/* D1.1.5.5 — Petty Cash custodian assignment (OWNER-only).
          Sits under MakerCheckerToggle since both deal with operational
          authority — segregation-of-duties + cash-drawer responsibility. */}
      <PettyCashCustodianCard />

      <Card>
        <CardHeader>
          <CardTitle>จัดการผู้ใช้งาน</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            จัดการบัญชีผู้ใช้งาน บทบาท และสิทธิ์การเข้าถึง
          </p>
          <Button asChild variant="outline">
            <Link to="/users" className="inline-flex items-center gap-2">
              <Users size={16} />
              ไปยังหน้าผู้ใช้งาน
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
