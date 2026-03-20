-- Update contract templates: change signature layout from dots to inline signature placeholders
-- Old format: ลงชื่อ..............................................ผู้ให้เช่าซื้อ  (separate {staff_signature} below)
-- New format: ลงชื่อ {staff_signature} ผู้ให้เช่าซื้อ  (signature inline)

-- Replace dot-based signature lines with inline placeholder format
-- and remove standalone signature placeholder lines that followed

UPDATE "contract_templates"
SET "content_html" = REGEXP_REPLACE(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        "content_html",
        E'ลงชื่อ[.…]{3,}ผู้ให้เช่าซื้อ(</p>\\s*\\n?\\s*\\{staff_signature\\})',
        E'ลงชื่อ {staff_signature} ผู้ให้เช่าซื้อ\\1',
        'g'
      ),
      E'ลงชื่อ[.…]{3,}ผู้เช่าซื้อ(</p>\\s*\\n?\\s*\\{customer_signature\\})',
      E'ลงชื่อ {customer_signature} ผู้เช่าซื้อ\\1',
      'g'
    ),
    E'ลงชื่อ[.…]{3,}พยาน(</p>\\s*\\n?\\s*\\{witness1_signature\\})',
    E'ลงชื่อ {witness1_signature} พยาน\\1',
    'g'
  ),
  E'ลงชื่อ[.…]{3,}พยาน(</p>\\s*\\n?\\s*\\{witness2_signature\\})',
  E'ลงชื่อ {witness2_signature} พยาน\\1',
  'g'
)
WHERE "content_html" LIKE '%ลงชื่อ%ผู้ให้เช่าซื้อ%'
  AND "content_html" LIKE '%{staff_signature}%';

-- Also clean up: remove standalone signature placeholder lines
-- that are no longer needed (they're now inline)
UPDATE "contract_templates"
SET "content_html" = REGEXP_REPLACE(
  REGEXP_REPLACE(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        "content_html",
        E'\\n\\{staff_signature\\}\\n',
        E'\\n',
        'g'
      ),
      E'\\n\\{customer_signature\\}\\n',
      E'\\n',
      'g'
    ),
    E'\\n\\{witness1_signature\\}\\n',
    E'\\n',
    'g'
  ),
  E'\\n\\{witness2_signature\\}\\n',
  E'\\n',
  'g'
)
WHERE "content_html" LIKE '%ลงชื่อ%{staff_signature}%ผู้ให้เช่าซื้อ%';
