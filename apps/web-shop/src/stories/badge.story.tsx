import { Badge } from '@/components/ui/badge';

export default function BadgeStory() {
  return (
    <div className="p-8 space-y-6">
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Variants</h2>
        <div className="flex flex-wrap gap-2">
          <Badge>default</Badge>
          <Badge variant="primary">primary</Badge>
          <Badge variant="success">success</Badge>
          <Badge variant="warning">warning</Badge>
          <Badge variant="danger">danger</Badge>
          <Badge variant="outline">outline</Badge>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Condition (used-iPhone)</h2>
        <div className="flex flex-wrap gap-2">
          <Badge variant="condition-a">A — สภาพดีมาก</Badge>
          <Badge variant="condition-b">B — ใช้งาน</Badge>
          <Badge variant="condition-c">C — มีรอย</Badge>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Sizes</h2>
        <div className="flex flex-wrap gap-2 items-center">
          <Badge size="sm" variant="primary">sm</Badge>
          <Badge size="md" variant="primary">md</Badge>
          <Badge size="lg" variant="primary">lg</Badge>
        </div>
      </section>
    </div>
  );
}
