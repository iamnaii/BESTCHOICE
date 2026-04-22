import { Button } from '@/components/ui/button';
import { ArrowRight, LogIn } from 'lucide-react';

export default function ButtonStory() {
  return (
    <div className="p-8 space-y-6">
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Variants</h2>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">primary</Button>
          <Button variant="mono">mono</Button>
          <Button variant="outline">outline</Button>
          <Button variant="ghost">ghost</Button>
          <Button variant="destructive">destructive</Button>
          <Button variant="dim">dim</Button>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">Sizes</h2>
        <div className="flex flex-wrap gap-3 items-center">
          <Button size="sm">small</Button>
          <Button size="md">medium</Button>
          <Button size="lg">large</Button>
          <Button size="icon" aria-label="next"><ArrowRight /></Button>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">States</h2>
        <div className="flex flex-wrap gap-3">
          <Button>default</Button>
          <Button disabled>disabled</Button>
          <Button loading>loading</Button>
          <Button fullWidth>full width</Button>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-bold">With icons</h2>
        <div className="flex flex-wrap gap-3">
          <Button><LogIn /> Sign in</Button>
          <Button variant="outline">Continue <ArrowRight /></Button>
        </div>
      </section>
    </div>
  );
}
