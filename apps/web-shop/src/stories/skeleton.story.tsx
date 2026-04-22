import { Skeleton } from '@/components/ui/skeleton';

export default function SkeletonStory() {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h3 className="font-semibold mb-2">Line</h3>
        <Skeleton shape="line" />
        <Skeleton shape="line" className="mt-2 w-3/4" />
      </div>
      <div>
        <h3 className="font-semibold mb-2">Avatar</h3>
        <Skeleton shape="avatar" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="font-semibold mb-2">Card</h3>
          <Skeleton shape="card" />
        </div>
        <div>
          <h3 className="font-semibold mb-2">Thumbnail</h3>
          <Skeleton shape="thumbnail" />
        </div>
      </div>
      <div>
        <h3 className="font-semibold mb-2">Product card (composed)</h3>
        <div className="rounded-2xl border border-zinc-200 p-4 space-y-3">
          <Skeleton shape="thumbnail" />
          <Skeleton shape="line" />
          <Skeleton shape="line" className="w-2/3" />
        </div>
      </div>
    </div>
  );
}
