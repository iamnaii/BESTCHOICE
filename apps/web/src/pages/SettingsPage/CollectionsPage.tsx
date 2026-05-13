import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import PageHeader from '@/components/ui/PageHeader';
import CollectionsConfigCard from './components/CollectionsConfigCard';

export default function CollectionsPage() {
  useDocumentTitle('ตั้งค่าการติดตามหนี้');

  return (
    <div>
      <PageHeader
        title="ตั้งค่าการติดตามหนี้"
        subtitle="กำหนด workload cap, session target และ self-claim lock สำหรับทีม collections"
      />
      <CollectionsConfigCard />
    </div>
  );
}
