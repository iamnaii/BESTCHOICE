import ProductPhotosPanel from '@/components/product/ProductPhotosPanel';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';

interface ProductPhotosProps {
  productId: string;
  canEdit: boolean;
  legacyPhotos: string[];
}

export default function ProductPhotos({ productId, canEdit, legacyPhotos }: ProductPhotosProps) {
  return (
    <div>
      <ProductPhotosPanel productId={productId} canEdit={canEdit} />

      {/* Legacy Photos (from goods receiving) */}
      {legacyPhotos.length > 0 && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle className="text-sm">รูปถ่ายจากการตรวจรับ</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {legacyPhotos.map((photo, i) => (
                <div key={i} className="w-20 h-20 rounded overflow-hidden border border-border">
                  <img src={photo} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
