import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaxPricesTab } from './MaxPricesTab';
import { OverpriceRulesTab } from './OverpriceRulesTab';
import { RateFactorsTab } from './RateFactorsTab';
import { MatchPreviewPanel } from './MatchPreviewPanel';

export default function GfinConfigPage() {
  const [tab, setTab] = useState('max-prices');

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">ตั้งค่า GFIN</h1>
        <p className="text-sm text-muted-foreground leading-snug">
          ตารางราคาสูงสุด, Over Price rules และค่างวดต่อจำนวนเดือนของ GFIN
        </p>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="max-prices">ราคาสูงสุด</TabsTrigger>
          <TabsTrigger value="overprice">Over Price</TabsTrigger>
          <TabsTrigger value="rate-factors">ตารางค่างวด</TabsTrigger>
          <TabsTrigger value="match-preview">ทดสอบ Match</TabsTrigger>
        </TabsList>
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
      </Tabs>
    </div>
  );
}
