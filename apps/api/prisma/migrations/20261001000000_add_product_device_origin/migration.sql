-- Existing stock remains unclassified until staff verify each device.
CREATE TYPE "DeviceOrigin" AS ENUM ('THAI', 'IMPORTED');
ALTER TABLE "products" ADD COLUMN "device_origin" "DeviceOrigin";
