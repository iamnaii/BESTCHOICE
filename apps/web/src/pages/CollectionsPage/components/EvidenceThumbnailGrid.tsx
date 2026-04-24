import { useState } from 'react';
import { X, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface EvidenceThumbnailGridProps {
  urls: string[];
  onRemove?: (index: number) => void;
  maxPreview?: number;
}

export function EvidenceThumbnailGrid({ urls, onRemove, maxPreview = 3 }: EvidenceThumbnailGridProps) {
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  if (urls.length === 0) {
    return (
      <p className="text-xs text-muted-foreground leading-snug">
        ยังไม่ได้อัปโหลดหลักฐาน
      </p>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {urls.slice(0, maxPreview).map((url, i) => (
          <div key={`${url}-${i}`} className="relative aspect-square overflow-hidden rounded border border-border">
            <img
              src={url}
              alt={`หลักฐาน ${i + 1}`}
              className="h-full w-full cursor-zoom-in object-cover"
              onClick={() => setLightboxUrl(url)}
            />
            <div className="absolute right-1 top-1 flex gap-1">
              <Button
                size="icon"
                variant="secondary"
                className="h-6 w-6"
                onClick={() => setLightboxUrl(url)}
                type="button"
                aria-label="ขยาย"
              >
                <ZoomIn className="h-3 w-3" />
              </Button>
              {onRemove && (
                <Button
                  size="icon"
                  variant="destructive"
                  className="h-6 w-6"
                  onClick={() => onRemove(i)}
                  type="button"
                  aria-label="ลบ"
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      {urls.length > maxPreview && (
        <p className="mt-1 text-xs text-muted-foreground">+{urls.length - maxPreview} รูปเพิ่มเติม</p>
      )}

      <Dialog open={!!lightboxUrl} onOpenChange={(o) => !o && setLightboxUrl(null)}>
        <DialogContent className="max-w-3xl p-0">
          {lightboxUrl && (
            <img src={lightboxUrl} alt="หลักฐาน (ขยาย)" className="w-full rounded" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
