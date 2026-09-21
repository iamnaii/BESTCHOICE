-- Reject/cancel does not always restore the contract (REPOSSESSION never does).
-- Correct only the original seeded default; preserve owner-customized messages
-- and all delivery settings/placeholders. No historical migration is rewritten.
UPDATE notification_templates
SET message_template = 'ใบรับเครื่องคืน ${docNumber} สัญญา ${contractNumber} ถูกยกเลิก หากมีข้อสงสัยติดต่อสาขา ${branchName}',
    updated_at = now()
WHERE event_type = 'DEVICE_RETURN_CANCELED'
  AND message_template = 'ใบรับเครื่องคืน ${docNumber} สัญญา ${contractNumber} ถูกยกเลิก สัญญาเดินต่อตามเดิม หากมีข้อสงสัยติดต่อสาขา ${branchName}';
