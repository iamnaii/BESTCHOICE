-- Replace {salesperson_name} with {lessor_name} ONLY under the ผู้ให้เช่าซื้อ (lessor) signature block.
-- The ผู้ให้เช่าซื้อ section is identified by the preceding {staff_signature} placeholder.
-- The customer side uses {customer_signature} + {customer_name}, so it is unaffected.

UPDATE "contract_templates"
SET
  "content_html" = REPLACE(
    "content_html",
    $REPL${staff_signature}
<p>( {salesperson_name} )</p>$REPL$,
    $REPL${staff_signature}
<p>( {lessor_name} )</p>$REPL$
  ),
  "updated_at" = NOW()
WHERE "content_html" LIKE '%{staff_signature}%{salesperson_name}%'
  AND "deleted_at" IS NULL;
