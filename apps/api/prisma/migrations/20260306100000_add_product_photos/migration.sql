-- CreateEnum: Add PHOTO_PENDING to ProductStatus
ALTER TYPE "ProductStatus" ADD VALUE IF NOT EXISTS 'PHOTO_PENDING' AFTER 'QC_PENDING';

-- CreateTable
CREATE TABLE "product_photos" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "front" TEXT,
    "back" TEXT,
    "left" TEXT,
    "right" TEXT,
    "top" TEXT,
    "bottom" TEXT,
    "is_completed" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_photos_product_id_key" ON "product_photos"("product_id");

-- AddForeignKey
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_photos" ADD CONSTRAINT "product_photos_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
