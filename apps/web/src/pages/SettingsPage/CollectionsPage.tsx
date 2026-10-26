import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsConfigCard from './components/CollectionsConfigCard';

export default function CollectionsPage() {
  useDocumentTitle('ตั้งค่าการติดตามหนี้');

  return (
    <div>
      <PageHeader
        title="ตั้งค่าการติดตามหนี้"
        subtitle="กำหนดจำนวนงานสูงสุด เป้าหมายต่อรอบ และเวลารับผิดชอบงานสำหรับทีมติดตามหนี้"
      />
      <CollectionsConfigCard />
    </div>
  );
}
