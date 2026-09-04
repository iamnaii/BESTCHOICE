# grants.sql — สรุปให้รีวิวก่อนรันบน prod

> สร้างอัตโนมัติ ห้ามแก้ด้วยมือ · แก้ที่ `policy.mjs` แล้ว `npm run grants` ใหม่

- ตารางทั้งหมด **203** · ให้สิทธิ์บางคอลัมน์ **200** · ไม่ให้เลยทั้งใบ **3**
- คอลัมน์ทั้งหมด **2964** · ให้ **2397** · ไม่ให้ **567**

🔒 = ตารางที่ถือ PII (ให้เฉพาะที่อยู่ใน allowlist) · ⛔ = ห้ามทั้งใบ

## ตารางที่ถือ PII — ตรวจให้ละเอียด

### 🔒 `ai_training_pairs`
ให้ 2 · ไม่ให้ 12

- **ให้**: `id` `created_at`
- **ไม่ให้**: `type` `source` `room_id` `customer_message` `ai_draft` `human_edit` `intent` `quality` `used_in_prompt` `embedding` `embedding_model` `embedded_at`

### 🔒 `audit_logs`
ให้ 5 · ไม่ให้ 10

- **ให้**: `id` `user_id` `action` `entity_id` `created_at`
- **ไม่ให้**: `entity` `old_value` `new_value` `ip_address` `user_agent` `duration` `archived_at` `sequence_number` `row_hash` `prev_row_hash`

### 🔒 `bot_detection_logs`
ให้ 2 · ไม่ให้ 7

- **ให้**: `id` `created_at`
- **ไม่ให้**: `ip_hash` `user_agent` `detected_type` `signals` `page_path` `action` `detected_at`

### 🔒 `chat_messages`
ให้ 19 · ไม่ให้ 8

- **ให้**: `id` `room_id` `role` `type` `intent` `confidence` `model_used` `input_tokens` `output_tokens` `cost_usd` `payment_id` `receipt_id` `created_at` `deleted_at` `staff_id` `delivered_at` `read_at` `delivery_status` `outbound_sent_at`
- **ไม่ให้**: `text` `media_url` `media_type` `tools_used` `vision_extracted` `external_message_id` `flex_json` `client_message_id`

### 🔒 `chat_rooms`
ให้ 26 · ไม่ให้ 7

- **ให้**: `id` `customer_id` `channel` `status` `verified_at` `verification_attempts` `handoff_mode` `handoff_tagged_at` `handoff_staff_id` `total_messages` `last_message_at` `created_at` `updated_at` `deleted_at` `priority` `assigned_to_id` `first_response_at` `resolved_at` `lead_score` `lead_temperature` `pinned_at` `pinned_by_id` `unread_count` `ai_paused` `ai_paused_at` `ai_paused_by_id`
- **ไม่ให้**: `line_user_id` `handoff_reason` `external_user_id` `attribution_id` `display_name` `picture_url` `ai_sales_state`

### 🔒 `contacts`
ให้ 4 · ไม่ให้ 11

- **ให้**: `id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `contact_code` `peak_contact_code` `name` `tax_id` `national_id_hash` `phone` `email` `address` `line_id` `roles` `is_active`

### 🔒 `contracts`
ให้ 8 · ไม่ให้ 59

- **ให้**: `id` `contract_number` `customer_id` `product_id` `status` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `branch_id` `salesperson_id` `plan_type` `selling_price` `down_payment` `interest_rate` `total_months` `interest_total` `financed_amount` `monthly_payment` `parent_contract_id` `notes` `workflow_status` `reviewed_by_id` `reviewed_at` `review_notes` `payment_due_day` `interest_config_id` `pdpa_consent_id` `contract_hash` `has_ownership_clause` `has_repossession_clause` `has_early_payoff_clause` `has_no_transfer_clause` `has_acknowledgement` `retention_status` `retention_expiry` `legal_hold_reason` `customer_snapshot` `credit_balance` `dunning_stage` `dunning_escalated_at` `dunning_last_action_at` `store_commission` `vat_amount` `vat_pct` `assigned_to_id` `legacy_contract_code` `collection_notes` `last_contact_date` `mdm_locked_at` `shop_warranty_start_date` `shop_warranty_end_date` `device_received_at` `pending_dunning_stage` `pending_dunning_since` `block_auto_escalation` `no_answer_count` `needs_skip_tracing` `device_locked` `device_locked_at` `wallpaper_changed` `wallpaper_changed_at` `assigned_at` `kept_promise_count` `advance_balance` `exchanged_from_contract_id` `exchanged_at` `reschedule_advance_balance`

### 🔒 `credit_checks`
ให้ 5 · ไม่ให้ 29

- **ให้**: `id` `status` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `contract_id` `customer_id` `bank_name` `statement_files` `statement_months` `ai_analysis` `ai_score` `ai_summary` `ai_recommendation` `checked_by_id` `checked_at` `review_notes` `salary_verified` `employer_name` `salary_pay_day` `salary_slip_files` `statement_bank_name` `statement_avg_income` `statement_avg_expense` `statement_avg_balance` `risk_score` `debt_to_income_ratio` `risk_note` `original_status` `original_score` `overridden_at` `overridden_by_id` `override_reason` `check_type`

### 🔒 `customers`
ให้ 5 · ไม่ให้ 58

- **ให้**: `id` `created_at` `updated_at` `deleted_at` `status`
- **ไม่ให้**: `national_id` `name` `phone` `phone_secondary` `line_id_finance` `address_id_card` `address_current` `occupation` `workplace` `documents` `prefix` `nickname` `is_foreigner` `birth_date` `email` `facebook_link` `facebook_name` `facebook_friends` `google_map_link` `occupation_detail` `salary` `address_work` `references` `guardian_name` `guardian_national_id` `guardian_phone` `guardian_relation` `guardian_address` `referred_by_id` `loyalty_balance` `address_current_type` `salary_pay_day` `legacy_member_code` `chat_consent` `chat_consent_at` `notif_payment_reminder` `notif_overdue_notice` `notif_receipt` `referral_awarded_at` `national_id_encrypted` `national_id_hash` `phone_encrypted` `phone_hash` `phone_secondary_encrypted` `email_encrypted` `address_id_card_encrypted` `address_current_encrypted` `address_work_encrypted` `guardian_national_id_encrypted` `guardian_phone_encrypted` `guardian_address_encrypted` `references_encrypted` `facebook_user_id` `shipping_addresses` `credit_check_status` `line_id_shop` `acquisition_source` `contact_id`

### 🔒 `dsar_requests`
ให้ 4 · ไม่ให้ 12

- **ให้**: `id` `status` `created_at` `updated_at`
- **ไม่ให้**: `request_number` `customer_id` `request_type` `description` `response_notes` `processed_by_id` `submitted_at` `processed_at` `completed_at` `due_date` `deleted_at` `response_data`

### 🔒 `employee_profiles`
ให้ 4 · ไม่ให้ 10

- **ให้**: `id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `user_id` `position` `employment_type` `base_salary` `sso_eligible` `bank_name` `bank_account_no` `tax_id_override` `note` `resigned_date`

### 🔒 `imported_sales`
ให้ 1 · ไม่ให้ 18

- **ให้**: `id`
- **ไม่ให้**: `source` `barcode` `product_name` `category` `buyer_label` `shop_label` `order_number` `payment_type` `price_group` `sale_channel` `cost_total` `list_price` `sale_price` `profit` `salesperson_name` `sold_at` `import_batch` `imported_at`

### 🔒 `ip_rate_limits`
ให้ 0 · ไม่ให้ 8

- **ให้**: _ไม่มี_
- **ไม่ให้**: `ip_hash` `window_start` `request_count` `blocked_until` `block_reason` `pages_visited` `unique_pages_visited` `last_user_agent`

### ⛔ `password_reset_tokens`
ให้ 0 · ไม่ให้ 7

- **ให้**: _ไม่มี_
- **ไม่ให้**: `id` `token` `user_id` `expires_at` `used_at` `created_at` `updated_at`

### 🔒 `refresh_tokens`
ให้ 5 · ไม่ให้ 4

- **ให้**: `id` `user_id` `expires_at` `revoked_at` `created_at`
- **ไม่ให้**: `token` `updated_at` `deleted_at` `is_revoked`

### 🔒 `staff_chat_activities`
ให้ 4 · ไม่ให้ 1

- **ให้**: `id` `staff_id` `action` `created_at`
- **ไม่ให้**: `metadata`

### 🔒 `trade_ins`
ให้ 5 · ไม่ให้ 51

- **ให้**: `id` `status` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `customer_id` `product_id` `device_brand` `device_model` `device_storage` `device_condition` `imei` `estimated_value` `offered_price` `agreed_price` `appraised_by_id` `notes` `branch_id` `device_color` `seller_name` `seller_phone` `seller_id_card_number` `seller_address` `id_card_photo_url` `id_card_source` `id_card_verified_at` `id_card_verified_by_id` `seller_signature_url` `seller_signature_base64` `seller_consent_signed` `police_report_acknowledged` `imei_blacklist_checked_at` `imei_blacklist_result` `payment_method` `transfer_bank_name` `transfer_account_number` `transfer_account_name` `voucher_number` `voucher_date` `voucher_pdf_url` `voucher_printed_at` `base_price_at_appraisal` `first_appraised_at` `appraisal_locked` `transfer_account_number_encrypted` `transfer_account_name_encrypted` `submission_source` `flow` `customer_notes` `customer_line_id` `photo_urls` `battery_health` `seller_contact_id` `condition_answers` `quote_breakdown` `preferred_visit_date`

### 🔒 `users`
ให้ 7 · ไม่ให้ 24

- **ให้**: `id` `role` `branch_id` `is_active` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `email` `password` `name` `saved_signature` `employee_id` `nickname` `phone` `line_id` `address` `avatar_url` `start_date` `national_id` `birth_date` `failed_login_attempts` `locked_until` `last_login_at` `is_system_user` `yeastar_extension` `collections_active` `preferences` `default_cash_account_code` `accessible_companies` `primary_company` `can_reverse_override`

### 🔒 `website_visits`
ให้ 1 · ไม่ให้ 16

- **ให้**: `id`
- **ไม่ให้**: `session_id` `customer_id` `ip_hash` `ip_country` `ip_province` `user_agent` `device` `browser` `os` `page_path` `referrer` `utm_source` `utm_medium` `utm_campaign` `visited_at` `duration_sec`

## ตารางอื่นที่มีคอลัมน์ถูกตัดออก

| ตาราง | ให้ | ไม่ให้ | คอลัมน์ที่ไม่ให้ |
|---|---:|---:|---|
| `suppliers` | 14 | 8 | `name` `phone` `phone_secondary` `line_id` `address` `notes` `nickname` `contact_phone` |
| `company_info` | 18 | 6 | `address` `phone` `director_national_id` `director_address` `bank_account_name` `bank_account_number` |
| `external_finance_companies` | 11 | 5 | `name` `contact_phone` `bank_account_info` `notes` `email` |
| `finance_company_contacts` | 9 | 5 | `name` `phone` `email` `line_id` `notes` |
| `online_installment_applications` | 17 | 5 | `full_name` `phone` `national_id` `line_user_id` `notes` |
| `expense_documents` | 27 | 4 | `description` `receipt_image_url` `reference` `note` |
| `invite_tokens` | 10 | 4 | `token` `email` `otp_hash` `phone` |
| `kyc_verifications` | 15 | 4 | `otp_hash` `otp_phone` `id_card_image_url` `ip_address` |
| `purchase_orders` | 25 | 4 | `notes` `attachments` `bank_account_snapshot` `bank_name_snapshot` |
| `receipts` | 33 | 4 | `file_hash` `payer_address` `item_description` `public_token` |
| `signatures` | 13 | 4 | `signature_image` `ip_address` `signature_svg` `contract_hash` |
| `canned_response_bubbles` | 15 | 3 | `text` `media_url` `address` |
| `contract_exchange_requests` | 39 | 3 | `condition_photos` `base_price_snapshot` `ncv_snapshot` |
| `document_audit_logs` | 6 | 3 | `document_id` `ip_address` `user_agent` |
| `fixed_assets` | 61 | 3 | `name` `description` `note` |
| `journal_entries` | 13 | 3 | `description` `reference_type` `reference_id` |
| `login_audit_logs` | 7 | 3 | `email_tried` `ip_address` `user_agent` |
| `products` | 39 | 3 | `name` `photos` `online_description` |
| `repair_tickets` | 28 | 3 | `defect_description` `expense_document_id` `notes` |
| `accounting_periods` | 19 | 2 | `report_snapshot` `notes` |
| `bank_accounts` | 10 | 2 | `account_number` `notes` |
| `branches` | 9 | 2 | `name` `phone` |
| `canned_response_quick_replies` | 9 | 2 | `payload` `message` |
| `canned_responses` | 12 | 2 | `content` `media_url` |
| `chart_of_accounts` | 11 | 2 | `name` `notes` |
| `chat_auto_triggers` | 10 | 2 | `payload` `reference_key` |
| `chatbot_otp_requests` | 7 | 2 | `line_user_id` `phone` |
| `commission_rules` | 10 | 2 | `name` `description` |
| `contract_documents` | 15 | 2 | `notes` `file_hash` |
| `credit_note_details` | 2 | 2 | `document_id` `original_document_id` |
| `expense_adjustments` | 7 | 2 | `document_id` `note` |
| `external_finance_commissions` | 13 | 2 | `sale_reference_id` `notes` |
| `fee_waiver_approvals` | 4 | 2 | `ip_address` `user_agent` |
| `inspections` | 12 | 2 | `photos` `notes` |
| `journal_post_audit_logs` | 5 | 2 | `ip_address` `user_agent` |
| `legal_cases` | 9 | 2 | `lawyer_phone` `notes` |
| `notification_templates` | 15 | 2 | `name` `description` |
| `other_incomes` | 38 | 2 | `counterparty_address` `counterparty_phone` |
| `payment_evidences` | 11 | 2 | `line_user_id` `image_url` |
| `payments` | 31 | 2 | `notes` `tolerance_journal_line_id` |
| `payroll_custom_deduction` | 5 | 2 | `payroll_line_id` `name` |
| `payroll_custom_income` | 6 | 2 | `payroll_line_id` `name` |
| `pdpa_consents` | 13 | 2 | `ip_address` `signature_image` |
| `promotions` | 13 | 2 | `name` `description` |
| `repossessions` | 24 | 2 | `photos` `notes` |
| `sales_commissions` | 23 | 2 | `notes` `snapshot_salesperson_id` |
| `shareholders` | 9 | 2 | `name` `note` |
| `sms_templates` | 9 | 2 | `name` `body` |
| `sso_config` | 8 | 2 | `salary_ceiling` `note` |
| `stock_adjustments` | 11 | 2 | `notes` `photos` |
| `supplier_payment_methods` | 9 | 2 | `bank_account_name` `bank_account_number` |
| `template_categories` | 4 | 2 | `name` `description` |
| `todos` | 14 | 2 | `description` `attachments` |
| `webhook_anomalies` | 5 | 2 | `ip_address` `user_agent` |
| `webhook_subscriptions` | 8 | 2 | `name` `secret` |
| `account_role_map` | 7 | 1 | `note` |
| `bad_debt_provisions` | 17 | 1 | `notes` |
| `bad_debt_write_off_audit_logs` | 10 | 1 | `notes` |
| `booking_items` | 7 | 1 | `description` |
| `bookings` | 21 | 1 | `notes` |
| `branch_receiving_items` | 10 | 1 | `photos` |
| `branch_receivings` | 7 | 1 | `notes` |
| `broadcast_messages` | 15 | 1 | `content` |
| `call_logs` | 36 | 1 | `notes` |
| `chat_notes` | 6 | 1 | `content` |
| `chat_side_messages` | 5 | 1 | `text` |
| `chat_snoozes` | 6 | 1 | `note` |
| `commission_payouts` | 15 | 1 | `notes` |
| `contract_letters` | 17 | 1 | `evidence_photo_url` |
| `contract_templates` | 10 | 1 | `name` |
| `crm_notes` | 4 | 1 | `content` |
| `customer_access_tokens` | 6 | 1 | `token` |
| `customer_line_links` | 8 | 1 | `line_user_id` |
| `daily_assignments` | 21 | 1 | `notes` |
| `dunning_rules` | 15 | 1 | `name` |
| `e_documents` | 8 | 1 | `file_hash` |
| `equity_attachments` | 7 | 1 | `document_id` |
| `equity_documents` | 22 | 1 | `description` |
| `equity_shareholder_lines` | 10 | 1 | `document_id` |
| `expense_details` | 1 | 1 | `document_id` |
| `expense_lines` | 18 | 1 | `description` |
| `expense_templates` | 12 | 1 | `name` |
| `filter_presets` | 9 | 1 | `name` |
| `finance_receivable_contact_logs` | 15 | 1 | `notes` |
| `finance_receivables` | 22 | 1 | `note` |
| `goods_receiving_items` | 17 | 1 | `photos` |
| `goods_receivings` | 7 | 1 | `notes` |
| `inspection_results` | 10 | 1 | `notes` |
| `inspection_templates` | 6 | 1 | `name` |
| `inter_co_settlement_batches` | 24 | 1 | `note` |
| `inter_company_transactions` | 27 | 1 | `note` |
| `interest_configs` | 12 | 1 | `name` |
| `journal_lines` | 8 | 1 | `description` |
| `known_devices` | 8 | 1 | `ip_address` |
| `notification_logs` | 20 | 1 | `message` |
| `online_orders` | 30 | 1 | `shipping_address` |
| `other_income_adjustments` | 6 | 1 | `note` |
| `other_income_items` | 16 | 1 | `description` |
| `other_income_templates` | 11 | 1 | `name` |
| `outbox_events` | 13 | 1 | `payload` |
| `partial_payment_links` | 15 | 1 | `token` |
| `payment_drafts` | 18 | 1 | `notes` |
| `payment_links` | 10 | 1 | `token` |
| `payroll_details` | 2 | 1 | `document_id` |
| `payroll_lines` | 10 | 1 | `base_salary` |
| `promise_slots` | 11 | 1 | `notes` |
| `quote_items` | 7 | 1 | `description` |
| `quotes` | 19 | 1 | `notes` |
| `repair_status_logs` | 6 | 1 | `note` |
| `reviews` | 14 | 1 | `comment` |
| `sales` | 27 | 1 | `notes` |
| `settlement_lines` | 5 | 1 | `cleared_document_id` |
| `sticker_templates` | 9 | 1 | `name` |
| `stock_counts` | 10 | 1 | `notes` |
| `stock_transfers` | 16 | 1 | `notes` |
| `tax_reports` | 19 | 1 | `notes` |
| `todo_comments` | 4 | 1 | `content` |
| `trade_in_valuations` | 9 | 1 | `note` |
| `vendor_settlement_details` | 0 | 1 | `document_id` |
| `webhook_deliveries` | 9 | 1 | `payload` |
| `website_sessions` | 18 | 1 | `ip_hash` |
