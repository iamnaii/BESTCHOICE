# grants.sql — สรุปให้รีวิวก่อนรันบน prod

> สร้างอัตโนมัติ ห้ามแก้ด้วยมือ · แก้ที่ `policy.mjs` แล้ว `npm run grants` ใหม่

- ตารางทั้งหมด **220** · ให้สิทธิ์บางคอลัมน์ **217** · ไม่ให้เลยทั้งใบ **3**
- คอลัมน์ทั้งหมด **3302** · ให้ **2632** · ไม่ให้ **670**

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
ให้ 21 · ไม่ให้ 6

- **ให้**: `id` `room_id` `role` `type` `text` `media_url` `intent` `confidence` `model_used` `input_tokens` `output_tokens` `cost_usd` `payment_id` `receipt_id` `created_at` `deleted_at` `staff_id` `delivered_at` `read_at` `delivery_status` `outbound_sent_at`
- **ไม่ให้**: `media_type` `tools_used` `vision_extracted` `external_message_id` `flex_json` `client_message_id`

### 🔒 `chat_rooms`
ให้ 27 · ไม่ให้ 9

- **ให้**: `id` `customer_id` `channel` `status` `verified_at` `verification_attempts` `handoff_mode` `handoff_tagged_at` `handoff_staff_id` `total_messages` `last_message_at` `created_at` `updated_at` `deleted_at` `priority` `assigned_to_id` `first_response_at` `resolved_at` `lead_score` `lead_temperature` `pinned_at` `pinned_by_id` `unread_count` `display_name` `ai_paused` `ai_paused_at` `ai_paused_by_id`
- **ไม่ให้**: `line_user_id` `handoff_reason` `external_user_id` `attribution_id` `picture_url` `ai_sales_state` `waiting_since` `last_customer_at` `dismissed_same_person_ids`

### 🔒 `contacts`
ให้ 4 · ไม่ให้ 11

- **ให้**: `id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `contact_code` `peak_contact_code` `name` `tax_id` `national_id_hash` `phone` `email` `address` `line_id` `roles` `is_active`

### 🔒 `contracts`
ให้ 8 · ไม่ให้ 65

- **ให้**: `id` `contract_number` `customer_id` `product_id` `status` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `branch_id` `salesperson_id` `plan_type` `selling_price` `down_payment` `interest_rate` `total_months` `interest_total` `financed_amount` `monthly_payment` `parent_contract_id` `notes` `workflow_status` `reviewed_by_id` `reviewed_at` `review_notes` `payment_due_day` `interest_config_id` `pdpa_consent_id` `contract_hash` `has_ownership_clause` `has_repossession_clause` `has_early_payoff_clause` `has_no_transfer_clause` `has_acknowledgement` `retention_status` `retention_expiry` `legal_hold_reason` `customer_snapshot` `credit_balance` `dunning_stage` `dunning_escalated_at` `dunning_last_action_at` `store_commission` `vat_amount` `vat_pct` `legacy_contract_code` `assigned_to_id` `collection_notes` `last_contact_date` `mdm_locked_at` `shop_warranty_start_date` `shop_warranty_end_date` `no_answer_count` `needs_skip_tracing` `device_locked` `device_locked_at` `wallpaper_changed` `wallpaper_changed_at` `device_received_at` `pending_dunning_stage` `pending_dunning_since` `block_auto_escalation` `assigned_at` `kept_promise_count` `advance_balance` `trade_in_credit_snapshot` `exchanged_from_contract_id` `exchanged_at` `reschedule_advance_balance` `down_payment_method` `down_payment_received_at` `down_payment_reference` `product_disclosure` `bundle_product_ids`

### 🔒 `credit_approvals`
ให้ 12 · ไม่ให้ 12

- **ให้**: `id` `credit_check_id` `customer_id` `approved_by_id` `policy_version` `used_by_contract_id` `used_at` `used_first_payment_due` `superseded_at` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `verified_monthly_income` `living_expenses` `external_monthly_debt` `internal_monthly_debt` `remaining_income` `maximum_monthly_payment` `approved_monthly_payment` `salary_pay_day` `evidence_notes` `source_financial_hash` `customer_financial_hash` `commitments`

### 🔒 `credit_checks`
ให้ 5 · ไม่ให้ 29

- **ให้**: `id` `status` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `contract_id` `customer_id` `bank_name` `statement_files` `statement_months` `ai_analysis` `ai_score` `ai_summary` `ai_recommendation` `checked_by_id` `checked_at` `review_notes` `salary_verified` `employer_name` `salary_pay_day` `salary_slip_files` `statement_bank_name` `statement_avg_income` `statement_avg_expense` `statement_avg_balance` `risk_score` `debt_to_income_ratio` `risk_note` `original_status` `original_score` `overridden_at` `overridden_by_id` `override_reason` `check_type`

### 🔒 `customer_journey_entries`
ให้ 20 · ไม่ให้ 1

- **ให้**: `id` `customer_id` `origin_customer_id` `origin` `kind` `occurred_at` `actor_type` `actor_user_id` `room_id` `ref_type` `ref_id` `data` `channel` `outcome` `lost_reason` `heard_from` `dedupe_key` `created_at` `deleted_at` `deleted_by_id`
- **ไม่ให้**: `note`

### 🔒 `customers`
ให้ 6 · ไม่ให้ 58

- **ให้**: `id` `created_at` `updated_at` `deleted_at` `status` `merged_into_id`
- **ไม่ให้**: `national_id` `name` `phone` `phone_secondary` `line_id_finance` `address_id_card` `address_current` `occupation` `workplace` `documents` `prefix` `nickname` `is_foreigner` `birth_date` `email` `facebook_link` `facebook_name` `facebook_friends` `google_map_link` `occupation_detail` `salary` `address_work` `references` `guardian_name` `guardian_national_id` `guardian_phone` `guardian_relation` `guardian_address` `referred_by_id` `legacy_member_code` `loyalty_balance` `address_current_type` `salary_pay_day` `chat_consent` `chat_consent_at` `notif_payment_reminder` `notif_overdue_notice` `notif_receipt` `line_id_shop` `referral_awarded_at` `national_id_encrypted` `national_id_hash` `phone_encrypted` `phone_hash` `phone_secondary_encrypted` `email_encrypted` `address_id_card_encrypted` `address_current_encrypted` `address_work_encrypted` `guardian_national_id_encrypted` `guardian_phone_encrypted` `guardian_address_encrypted` `references_encrypted` `credit_check_status` `facebook_user_id` `shipping_addresses` `acquisition_source` `contact_id`

### 🔒 `dsar_requests`
ให้ 4 · ไม่ให้ 12

- **ให้**: `id` `status` `created_at` `updated_at`
- **ไม่ให้**: `request_number` `customer_id` `request_type` `description` `response_notes` `processed_by_id` `submitted_at` `processed_at` `completed_at` `due_date` `deleted_at` `response_data`

### 🔒 `employee_profiles`
ให้ 4 · ไม่ให้ 10

- **ให้**: `id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `user_id` `position` `employment_type` `base_salary` `sso_eligible` `bank_name` `bank_account_no` `tax_id_override` `note` `resigned_date`

### 🔒 `external_finance_application_events`
ให้ 6 · ไม่ให้ 3

- **ให้**: `id` `application_id` `kind` `actor_type` `actor_user_id` `created_at`
- **ไม่ให้**: `actor_name` `note` `meta`

### 🔒 `external_finance_application_files`
ให้ 14 · ไม่ให้ 2

- **ให้**: `id` `application_id` `slot` `mime_type` `size` `source` `source_message_id` `source_angle` `sort_order` `sent_at` `created_by_id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `storage_key` `original_name`

### 🔒 `external_finance_applications`
ให้ 23 · ไม่ให้ 7

- **ให้**: `id` `number` `finance_company_id` `room_id` `customer_id` `product_id` `branch_id` `status` `result_source` `sent_at` `sent_by_id` `sent_via` `share_expires_at` `share_revoked_at` `share_view_count` `share_last_viewed_at` `last_partner_event_at` `closed_at` `files_purged_at` `created_by_id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `summary` `message_text` `message_override` `occupation_override` `line_request_id` `share_token_hash` `share_token_enc`

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

### 🔒 `room_credit_analyses`
ให้ 8 · ไม่ให้ 2

- **ให้**: `id` `room_id` `file_ids` `status` `credit_check_id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `result` `error`

### 🔒 `room_credit_files`
ให้ 8 · ไม่ให้ 2

- **ให้**: `id` `room_id` `mime_type` `size` `source_message_id` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `key` `name`

### 🔒 `shop_cash_closes`
ให้ 26 · ไม่ให้ 3

- **ให้**: `id` `branch_id` `status` `attempt_no` `period_start` `float_amount` `cash_in` `cash_out` `expected_amount` `counted_amount` `variance_amount` `variance_reason` `send_amount` `counted_by_id` `counted_at` `received_amount` `receive_variance` `destination` `confirmed_by_id` `confirmed_at` `sent_back_by_id` `sent_back_at` `sent_back_reason` `created_at` `updated_at` `journal_entry_id`
- **ไม่ให้**: `receive_note` `deposit_slip_key` `deposit_reference`

### 🔒 `shop_cash_deposits`
ให้ 9 · ไม่ให้ 3

- **ให้**: `id` `branch_id` `source` `amount` `deposited_by_id` `deposited_at` `journal_entry_id` `created_at` `updated_at`
- **ไม่ให้**: `reference` `slip_key` `note`

### 🔒 `staff_chat_activities`
ให้ 4 · ไม่ให้ 1

- **ให้**: `id` `staff_id` `action` `created_at`
- **ไม่ให้**: `metadata`

### 🔒 `trade_ins`
ให้ 5 · ไม่ให้ 63

- **ให้**: `id` `status` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `customer_id` `product_id` `device_brand` `device_model` `device_storage` `device_condition` `imei` `estimated_value` `offered_price` `agreed_price` `appraised_by_id` `notes` `branch_id` `device_color` `seller_name` `seller_phone` `seller_id_card_number` `seller_address` `id_card_photo_url` `id_card_source` `id_card_verified_at` `id_card_verified_by_id` `seller_signature_url` `seller_signature_base64` `seller_consent_signed` `police_report_acknowledged` `imei_blacklist_checked_at` `imei_blacklist_result` `payment_method` `transfer_bank_name` `transfer_account_number` `transfer_account_name` `voucher_number` `voucher_date` `voucher_pdf_url` `voucher_printed_at` `base_price_at_appraisal` `first_appraised_at` `appraisal_locked` `transfer_account_number_encrypted` `transfer_account_name_encrypted` `submission_source` `flow` `customer_notes` `customer_line_id` `photo_urls` `battery_health` `seller_declaration_snapshot` `serial_number` `quick_buy_request_id` `quick_buy_request_hash` `quick_buy_requested_by_id` `imei_missing_reason` `serial_number_missing_reason` `credit_base_amount` `credit_bonus_amount` `credit_issued_at` `credit_issue_journal_id` `current_redemption_id` `seller_contact_id` `condition_answers` `quote_breakdown` `preferred_visit_date`

### 🔒 `users`
ให้ 7 · ไม่ให้ 24

- **ให้**: `id` `role` `branch_id` `is_active` `created_at` `updated_at` `deleted_at`
- **ไม่ให้**: `email` `password` `name` `saved_signature` `employee_id` `nickname` `phone` `line_id` `address` `avatar_url` `start_date` `national_id` `birth_date` `failed_login_attempts` `locked_until` `is_system_user` `yeastar_extension` `last_login_at` `collections_active` `preferences` `default_cash_account_code` `accessible_companies` `primary_company` `can_reverse_override`

### 🔒 `website_visits`
ให้ 1 · ไม่ให้ 16

- **ให้**: `id`
- **ไม่ให้**: `session_id` `customer_id` `ip_hash` `ip_country` `ip_province` `user_agent` `device` `browser` `os` `page_path` `referrer` `utm_source` `utm_medium` `utm_campaign` `visited_at` `duration_sec`

## ตารางอื่นที่มีคอลัมน์ถูกตัดออก

| ตาราง | ให้ | ไม่ให้ | คอลัมน์ที่ไม่ให้ |
|---|---:|---:|---|
| `suppliers` | 11 | 11 | `name` `contact_name` `phone` `phone_secondary` `line_id` `address` `tax_id` `notes` `nickname` `title_name` `contact_phone` |
| `company_info` | 16 | 8 | `tax_id` `address` `phone` `director_name` `director_national_id` `director_address` `bank_account_name` `bank_account_number` |
| `other_incomes` | 32 | 8 | `counterparty_name` `counterparty_tax_id` `counterparty_address` `counterparty_phone` `customer_note` `reverse_note` `approve_note` `reject_note` |
| `receipts` | 30 | 7 | `payer_name` `receiver_name` `file_hash` `payer_address` `payer_tax_id` `item_description` `public_token` |
| `expense_documents` | 25 | 6 | `vendor_name` `vendor_tax_id` `description` `receipt_image_url` `reference` `note` |
| `external_finance_companies` | 10 | 6 | `name` `contact_phone` `bank_account_info` `notes` `email` `tax_id` |
| `finance_company_contacts` | 9 | 5 | `name` `phone` `email` `line_id` `notes` |
| `fixed_assets` | 59 | 5 | `name` `description` `supplier_name` `supplier_tax_id` `note` |
| `online_installment_applications` | 17 | 5 | `full_name` `phone` `national_id` `line_user_id` `notes` |
| `purchase_orders` | 24 | 5 | `notes` `payment_notes` `attachments` `bank_account_snapshot` `bank_name_snapshot` |
| `signatures` | 12 | 5 | `signature_image` `ip_address` `signature_svg` `signer_name` `contract_hash` |
| `contract_exchange_requests` | 38 | 4 | `condition_note` `condition_photos` `base_price_snapshot` `ncv_snapshot` |
| `invite_tokens` | 10 | 4 | `token` `email` `otp_hash` `phone` |
| `kyc_verifications` | 15 | 4 | `otp_hash` `otp_phone` `id_card_image_url` `ip_address` |
| `products` | 40 | 4 | `name` `photos` `online_description` `cosmetic_notes` |
| `after_sales_cases` | 32 | 3 | `photo_keys` `purchase_photo_keys` `warranty_snapshot` |
| `bank_accounts` | 9 | 3 | `account_name` `account_number` `notes` |
| `canned_response_bubbles` | 15 | 3 | `text` `media_url` `address` |
| `document_audit_logs` | 6 | 3 | `document_id` `ip_address` `user_agent` |
| `journal_entries` | 13 | 3 | `description` `reference_type` `reference_id` |
| `legal_cases` | 8 | 3 | `lawyer_name` `lawyer_phone` `notes` |
| `login_audit_logs` | 7 | 3 | `email_tried` `ip_address` `user_agent` |
| `payment_evidences` | 10 | 3 | `line_user_id` `image_url` `review_note` |
| `payroll_lines` | 8 | 3 | `employee_name` `employee_tax_id` `base_salary` |
| `repair_tickets` | 28 | 3 | `defect_description` `expense_document_id` `notes` |
| `shareholders` | 8 | 3 | `name` `tax_id` `note` |
| `accounting_periods` | 19 | 2 | `report_snapshot` `notes` |
| `branch_receiving_items` | 9 | 2 | `condition_notes` `photos` |
| `branches` | 10 | 2 | `name` `phone` |
| `call_logs` | 35 | 2 | `notes` `settlement_notes` |
| `canned_response_quick_replies` | 9 | 2 | `payload` `message` |
| `canned_responses` | 12 | 2 | `content` `media_url` |
| `chart_of_accounts` | 11 | 2 | `name` `notes` |
| `chat_auto_triggers` | 10 | 2 | `payload` `reference_key` |
| `chatbot_otp_requests` | 7 | 2 | `line_user_id` `phone` |
| `commission_rules` | 10 | 2 | `name` `description` |
| `contract_documents` | 15 | 2 | `notes` `file_hash` |
| `credit_note_details` | 2 | 2 | `document_id` `original_document_id` |
| `daily_assignments` | 20 | 2 | `skipNote` `notes` |
| `equity_shareholder_lines` | 9 | 2 | `document_id` `shareholder_name` |
| `expense_adjustments` | 7 | 2 | `document_id` `note` |
| `expense_lines` | 17 | 2 | `description` `supplier_name` |
| `external_finance_commissions` | 13 | 2 | `sale_reference_id` `notes` |
| `fee_waiver_approvals` | 4 | 2 | `ip_address` `user_agent` |
| `inspections` | 12 | 2 | `photos` `notes` |
| `journal_post_audit_logs` | 5 | 2 | `ip_address` `user_agent` |
| `notification_logs` | 19 | 2 | `recipient` `message` |
| `notification_templates` | 15 | 2 | `name` `description` |
| `other_income_items` | 15 | 2 | `account_name` `description` |
| `payment_approval_requests` | 15 | 2 | `payload` `snapshot` |
| `payments` | 31 | 2 | `notes` `tolerance_journal_line_id` |
| `payroll_custom_deduction` | 5 | 2 | `payroll_line_id` `name` |
| `payroll_custom_income` | 6 | 2 | `payroll_line_id` `name` |
| `pdpa_consents` | 13 | 2 | `ip_address` `signature_image` |
| `promotions` | 13 | 2 | `name` `description` |
| `repossessions` | 24 | 2 | `photos` `notes` |
| `sales` | 28 | 2 | `notes` `trade_in_credit_snapshot` |
| `sales_commissions` | 23 | 2 | `notes` `snapshot_salesperson_id` |
| `sms_templates` | 9 | 2 | `name` `body` |
| `sso_config` | 8 | 2 | `salary_ceiling` `note` |
| `stock_adjustments` | 11 | 2 | `notes` `photos` |
| `stock_transfers` | 15 | 2 | `notes` `tracking_note` |
| `supplier_payment_methods` | 9 | 2 | `bank_account_name` `bank_account_number` |
| `template_categories` | 4 | 2 | `name` `description` |
| `todos` | 15 | 2 | `description` `attachments` |
| `webhook_anomalies` | 5 | 2 | `ip_address` `user_agent` |
| `webhook_subscriptions` | 8 | 2 | `name` `secret` |
| `account_role_map` | 7 | 1 | `note` |
| `ads_campaigns` | 13 | 1 | `ad_photo_url` |
| `after_sales_events` | 5 | 1 | `note` |
| `bad_debt_provisions` | 17 | 1 | `notes` |
| `bad_debt_write_off_audit_logs` | 10 | 1 | `notes` |
| `booking_items` | 7 | 1 | `description` |
| `bookings` | 21 | 1 | `notes` |
| `branch_receivings` | 7 | 1 | `notes` |
| `broadcast_messages` | 15 | 1 | `content` |
| `chat_notes` | 8 | 1 | `content` |
| `chat_side_messages` | 5 | 1 | `text` |
| `chat_snoozes` | 6 | 1 | `note` |
| `commission_payouts` | 15 | 1 | `notes` |
| `contract_letters` | 17 | 1 | `evidence_photo_url` |
| `contract_templates` | 10 | 1 | `name` |
| `crm_notes` | 4 | 1 | `content` |
| `customer_access_tokens` | 6 | 1 | `token` |
| `customer_line_links` | 8 | 1 | `line_user_id` |
| `data_audit_logs` | 11 | 1 | `acknowledge_notes` |
| `device_returns` | 30 | 1 | `notes` |
| `dunning_rules` | 15 | 1 | `name` |
| `e_documents` | 8 | 1 | `file_hash` |
| `equity_attachments` | 7 | 1 | `document_id` |
| `equity_documents` | 22 | 1 | `description` |
| `expense_details` | 1 | 1 | `document_id` |
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
| `online_orders` | 30 | 1 | `shipping_address` |
| `other_income_adjustments` | 6 | 1 | `note` |
| `other_income_templates` | 11 | 1 | `name` |
| `outbox_events` | 13 | 1 | `payload` |
| `partial_payment_links` | 15 | 1 | `token` |
| `payment_drafts` | 19 | 1 | `notes` |
| `payment_links` | 10 | 1 | `token` |
| `payroll_details` | 2 | 1 | `document_id` |
| `promise_slots` | 11 | 1 | `notes` |
| `quote_items` | 7 | 1 | `description` |
| `quotes` | 19 | 1 | `notes` |
| `refunds` | 20 | 1 | `bank_reversal_notes` |
| `repair_status_logs` | 6 | 1 | `note` |
| `reviews` | 14 | 1 | `comment` |
| `settlement_lines` | 5 | 1 | `cleared_document_id` |
| `shop_tenders` | 16 | 1 | `reference` |
| `sticker_templates` | 9 | 1 | `name` |
| `stock_count_items` | 9 | 1 | `condition_notes` |
| `stock_counts` | 10 | 1 | `notes` |
| `tax_reports` | 19 | 1 | `notes` |
| `todo_comments` | 4 | 1 | `content` |
| `trade_in_valuations` | 9 | 1 | `note` |
| `vendor_settlement_details` | 0 | 1 | `document_id` |
| `webhook_deliveries` | 9 | 1 | `payload` |
| `website_sessions` | 18 | 1 | `ip_hash` |
