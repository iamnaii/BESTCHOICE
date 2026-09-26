import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { MaxPricesTab } from './MaxPricesTab';
import { OverpriceRulesTab } from './OverpriceRulesTab';
import { RateFactorsTab } from './RateFactorsTab';
import { MatchPreviewPanel } from './MatchPreviewPanel';
import { GfinSettingsPanel } from './GfinSettingsPanel';
import { GfinPrecheckSettingsPanel } from './GfinPrecheckSettingsPanel';

export default function GfinConfigPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [tab, setTab] = useState(isOwner ? 'max-prices' : 'line-group');

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">ตั้งค่า GFIN</h1>
        <p className="text-sm text-muted-foreground leading-snug">
          {isOwner
            ? 'ตารางราคาสูงสุด, Over Price rules (+ ผ่อนสูงสุด), เรทต่อ (งวด, % คอมมิชชั่น), ค่าตั้งต้น และกลุ่มไลน์/แม่แบบชุดเช็ค'
            : 'กลุ่มไลน์ที่รับชุดเช็ค GFIN และแม่แบบข้อความ 12 ข้อ'}
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {isOwner && (
            <>
              <TabsTrigger value="max-prices">ราคาสูงสุด</TabsTrigger>
              <TabsTrigger value="overprice">Over Price</TabsTrigger>
              <TabsTrigger value="rate-factors">ตารางค่างวด</TabsTrigger>
              <TabsTrigger value="settings">ค่าตั้งต้น</TabsTrigger>
              <TabsTrigger value="match-preview">ทดสอบ Match</TabsTrigger>
            </>
          )}
          <TabsTrigger value="line-group">กลุ่มไลน์ &amp; ข้อความ</TabsTrigger>
        </TabsList>
        <TabsContent value="line-group" className="mt-4">
          <GfinPrecheckSettingsPanel />
        </TabsContent>
        {isOwner && (
          <>
            <TabsContent value="settings" className="mt-4">
              <GfinSettingsPanel />
            </TabsContent>
            <TabsContent value="max-prices" className="mt-4">
              <MaxPricesTab />
            </TabsContent>
            <TabsContent value="overprice" className="mt-4">
              <OverpriceRulesTab />
            </TabsContent>
            <TabsContent value="rate-factors" className="mt-4">
              <RateFactorsTab />
            </TabsContent>
            <TabsContent value="match-preview" className="mt-4">
              <MatchPreviewPanel />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
