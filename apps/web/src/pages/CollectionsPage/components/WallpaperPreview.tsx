import { Checkbox } from '@/components/ui/checkbox';

interface WallpaperPreviewProps {
  wallpaperUrl: string | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Shown inside the MDM approve dialog. Lets the approver decide at
 * approve-time whether to attach the configured wallpaper to the lock.
 *
 * When the OWNER hasn't configured a wallpaper URL yet, the component
 * renders a hint linking to settings instead of a broken image.
 */
export function WallpaperPreview({ wallpaperUrl, checked, onChange }: WallpaperPreviewProps) {
  if (!wallpaperUrl) {
    return (
      <p className="text-xs text-muted-foreground leading-snug">
        ยังไม่ตั้ง wallpaper MDM —{' '}
        <a href="/settings" className="underline underline-offset-2">
          ไปตั้งค่าที่หน้า Dunning
        </a>
      </p>
    );
  }
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
      <img
        src={wallpaperUrl}
        alt="MDM wallpaper preview"
        className="h-16 w-16 rounded object-cover"
      />
      <div className="flex-1">
        <label className="flex items-start gap-2 text-sm leading-snug cursor-pointer">
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onChange(!!v)}
            className="mt-0.5"
          />
          <span>แนบภาพพื้นหลังนี้ให้เครื่องพร้อมล็อค</span>
        </label>
      </div>
    </div>
  );
}

export default WallpaperPreview;
