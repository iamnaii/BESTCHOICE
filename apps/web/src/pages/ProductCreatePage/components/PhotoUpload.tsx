import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';

const MAX_PHOTOS = 10;

interface PhotoUploadProps {
  photoPreviews: string[];
  onAdd: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (index: number) => void;
}

export default function PhotoUpload({ photoPreviews, onAdd, onRemove }: PhotoUploadProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>รูปถ่ายสินค้า</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-3">
          {photoPreviews.map((preview, index) => (
            <div key={index} className="relative w-24 h-24 rounded-lg overflow-hidden border">
              <img src={preview} alt={`Photo ${index + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(index)}
                className="absolute top-0.5 right-0.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full text-xs flex items-center justify-center hover:bg-destructive/90"
              >
                &times;
              </button>
            </div>
          ))}
          <label className="w-24 h-24 border-2 border-dashed border-input rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors">
            <span className="text-2xl text-muted-foreground">+</span>
            <span className="text-xs text-muted-foreground">เพิ่มรูป</span>
            <input type="file" accept="image/*" multiple onChange={onAdd} className="hidden" />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          รองรับ JPG, PNG สูงสุด {MAX_PHOTOS} รูป (ไม่เกิน 5MB/รูป) - ใช้ไป{' '}
          {photoPreviews.length}/{MAX_PHOTOS}
        </p>
      </CardContent>
    </Card>
  );
}
