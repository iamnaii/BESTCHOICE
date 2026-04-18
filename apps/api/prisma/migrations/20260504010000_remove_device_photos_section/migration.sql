-- Remove the "รูปถ่ายโทรศัพท์จำนวน 6 ภาพแนบท้าย" section from any DB contract template
-- that may have been edited to include it. The photo grid + trailing signature line are
-- no longer wanted in the contract PDF.

UPDATE "contract_templates"
SET
  "content_html" = REGEXP_REPLACE(
    "content_html",
    '<div class="no-break"[^>]*>\s*<h3[^>]*>รูปถ่ายโทรศัพท์[^<]*</h3>.*?</div>\s*</div>',
    '',
    'gs'
  ),
  "updated_at" = NOW()
WHERE "content_html" LIKE '%รูปถ่ายโทรศัพท์%ภาพแนบท้าย%'
  AND "deleted_at" IS NULL;
