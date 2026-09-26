-- สร้างอัตโนมัติจาก .claude/mcp/sql/generate-grants.mjs — ห้ามแก้ด้วยมือ
-- โครงตารางจาก pg_catalog ของฐานจริง · role = mcp_ro
--
-- ห้ามเปลี่ยนเป็น GRANT SELECT ON <table> (ทั้งตาราง) เด็ดขาด:
-- ACL ระดับตารางครอบคอลัมน์ที่ migration เพิ่มทีหลังโดยอัตโนมัติ = fail-OPEN

BEGIN;

REVOKE ALL ON public."_b0_default_price_dedupe_backup" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "is_default", "created_at", "backed_up_at") ON public."_b0_default_price_dedupe_backup" TO mcp_ro;

REVOKE ALL ON public."_b5_active_hold_dedupe_backup" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "status", "reserved_at", "backed_up_at") ON public."_b5_active_hold_dedupe_backup" TO mcp_ro;

REVOKE ALL ON public."_prisma_migrations" FROM mcp_ro;
GRANT SELECT ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") ON public."_prisma_migrations" TO mcp_ro;

REVOKE ALL ON public."account_role_map" FROM mcp_ro;
GRANT SELECT ("id", "role", "account_code", "priority", "is_active", "created_at", "updated_at") ON public."account_role_map" TO mcp_ro;

REVOKE ALL ON public."accounting_periods" FROM mcp_ro;
GRANT SELECT ("id", "company_id", "year", "month", "status", "review_started_at", "review_started_by_id", "closed_at", "closed_by_id", "peak_synced_at", "peak_sync_result", "audit_issues", "created_at", "updated_at", "reopened_at", "reopened_by_id", "board_resolution_id", "reopen_reason", "tax_filed") ON public."accounting_periods" TO mcp_ro;

REVOKE ALL ON public."ads_attributions" FROM mcp_ro;
GRANT SELECT ("id", "campaign_id", "customer_id", "contract_id", "utm_source", "utm_medium", "utm_campaign", "utm_content", "referrer_url", "first_touch", "last_touch", "converted_at", "revenue", "created_at") ON public."ads_attributions" TO mcp_ro;

REVOKE ALL ON public."ads_campaigns" FROM mcp_ro;
GRANT SELECT ("id", "platform", "campaign_id", "campaign_name", "ad_set_name", "ad_name", "budget", "start_date", "end_date", "is_active", "created_at", "updated_at", "deleted_at") ON public."ads_campaigns" TO mcp_ro;

REVOKE ALL ON public."after_sales_cases" FROM mcp_ro;
GRANT SELECT ("id", "case_number", "branch_id", "customer_id", "source", "contract_id", "sale_id", "product_id", "device_brand", "device_model", "device_imei", "device_serial", "symptom", "accessories", "unlock_confirmed", "outcome", "repair_ticket_id", "exchange_request_id", "replacement_contract_id", "replacement_sale_id", "replacement_product_id", "stage", "received_by_id", "received_at", "approved_by_id", "approved_at", "closed_at", "cancelled_at", "cancel_reason", "created_at", "updated_at", "deleted_at") ON public."after_sales_cases" TO mcp_ro;

REVOKE ALL ON public."after_sales_events" FROM mcp_ro;
GRANT SELECT ("id", "case_id", "kind", "actor_id", "created_at") ON public."after_sales_events" TO mcp_ro;

REVOKE ALL ON public."ai_auto_reply_logs" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "customer_message", "ai_reply", "confidence", "auto_sent", "handoff_reason", "created_at", "intent", "tools_used", "input_tokens", "output_tokens") ON public."ai_auto_reply_logs" TO mcp_ro;

REVOKE ALL ON public."ai_settings" FROM mcp_ro;
GRANT SELECT ("id", "sales_bot_mode", "service_bot_mode", "sales_bot_confidence_threshold", "service_bot_confidence_threshold", "updated_at", "updated_by_id") ON public."ai_settings" TO mcp_ro;

REVOKE ALL ON public."ai_training_pairs" FROM mcp_ro;
GRANT SELECT ("id", "created_at") ON public."ai_training_pairs" TO mcp_ro;

REVOKE ALL ON public."ai_usage_logs" FROM mcp_ro;
GRANT SELECT ("id", "service", "method", "model", "input_tokens", "output_tokens", "cost_usd", "user_id", "status", "error_kind", "created_at") ON public."ai_usage_logs" TO mcp_ro;

REVOKE ALL ON public."asset_transfer_history" FROM mcp_ro;
GRANT SELECT ("id", "transfer_id", "asset_id", "transfer_date", "from_custodian", "to_custodian", "from_location", "to_location", "reason", "transferred_by_id", "created_at") ON public."asset_transfer_history" TO mcp_ro;

REVOKE ALL ON public."audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "user_id", "action", "entity_id", "created_at") ON public."audit_logs" TO mcp_ro;

REVOKE ALL ON public."bad_debt_provisions" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "provision_date", "aging_bucket", "days_overdue", "outstanding_amount", "provision_rate", "provision_amount", "status", "written_off_at", "written_off_by_id", "approved_by_id", "approved_at", "created_at", "updated_at", "deleted_at", "bucket_breakdown") ON public."bad_debt_provisions" TO mcp_ro;

REVOKE ALL ON public."bad_debt_write_off_audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "contract_number", "outstanding_amount", "provision_amount", "written_off_by_id", "written_off_by_role", "approved_by_id", "approved_by_role", "created_at") ON public."bad_debt_write_off_audit_logs" TO mcp_ro;

REVOKE ALL ON public."bank_accounts" FROM mcp_ro;
GRANT SELECT ("id", "account_code", "bank_name", "account_type", "currency", "is_active", "created_at", "updated_at", "deleted_at") ON public."bank_accounts" TO mcp_ro;

REVOKE ALL ON public."booking_items" FROM mcp_ro;
GRANT SELECT ("id", "booking_id", "product_id", "quantity", "unit_price", "amount", "created_at") ON public."booking_items" TO mcp_ro;

REVOKE ALL ON public."bookings" FROM mcp_ro;
GRANT SELECT ("id", "booking_number", "customer_id", "branch_id", "status", "deposit_amount", "total_amount", "expire_date", "deposit_paid_at", "deposit_method", "deposit_account_code", "deposit_received_by_id", "canceled_at", "canceled_by_id", "cancel_reason", "converted_to_sale_id", "converted_at", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."bookings" TO mcp_ro;

REVOKE ALL ON public."bot_detection_logs" FROM mcp_ro;
GRANT SELECT ("id", "created_at") ON public."bot_detection_logs" TO mcp_ro;

REVOKE ALL ON public."branch_receiving_items" FROM mcp_ro;
GRANT SELECT ("id", "receiving_id", "product_id", "imei_serial", "status", "reject_reason", "created_at", "deleted_at", "updated_at") ON public."branch_receiving_items" TO mcp_ro;

REVOKE ALL ON public."branch_receivings" FROM mcp_ro;
GRANT SELECT ("id", "transfer_id", "received_by_id", "status", "created_at", "deleted_at", "updated_at") ON public."branch_receivings" TO mcp_ro;

REVOKE ALL ON public."branches" FROM mcp_ro;
GRANT SELECT ("id", "location", "is_active", "created_at", "updated_at", "is_main_warehouse", "deleted_at", "company_id", "shop_cash_account_code", "shop_cash_float") ON public."branches" TO mcp_ro;

REVOKE ALL ON public."broadcast_approvals" FROM mcp_ro;
GRANT SELECT ("id", "broadcast_id", "approver_id", "reason", "trigger_matched", "audience_size", "approved_at") ON public."broadcast_approvals" TO mcp_ro;

REVOKE ALL ON public."broadcast_messages" FROM mcp_ro;
GRANT SELECT ("id", "type", "audience", "audience_count", "status", "scheduled_at", "sent_at", "error_message", "created_by_id", "created_at", "approved_by_id", "approved_at", "rejected_by_id", "rejected_at", "rejected_reason") ON public."broadcast_messages" TO mcp_ro;

REVOKE ALL ON public."buyback_choices" FROM mcp_ro;
GRANT SELECT ("id", "question_id", "label", "deduct_type", "deduct_value", "sort_order", "is_active", "created_at", "updated_at", "deleted_at") ON public."buyback_choices" TO mcp_ro;

REVOKE ALL ON public."buyback_questions" FROM mcp_ro;
GRANT SELECT ("id", "key", "title", "help_text", "select_type", "sort_order", "is_active", "created_at", "updated_at", "deleted_at") ON public."buyback_questions" TO mcp_ro;

REVOKE ALL ON public."call_logs" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "caller_id", "called_at", "result", "created_at", "updated_at", "deleted_at", "settlement_date", "yeastar_call_id", "call_direction", "duration", "recording_url", "recording_storage_tier", "recording_downloaded_at", "yeastar_recording_path", "auto_logged", "broken_at", "call_result", "negotiation_result", "voice_memo_url", "voice_memo_tier", "voice_memo_glacier_restore_expires_at", "settlement_amount", "second_settlement_date", "second_settlement_amount", "superseded_at", "superseded_by_call_log_id", "reschedule_count", "kept_at", "canceled_at", "canceled_reason", "cycle_started_at", "cycle_deadline", "target_installment_ids") ON public."call_logs" TO mcp_ro;

REVOKE ALL ON public."canned_response_bubbles" FROM mcp_ro;
GRANT SELECT ("id", "canned_response_id", "type", "sort_order", "thumbnail_url", "sticker_package_id", "sticker_id", "created_at", "updated_at", "deleted_at", "channels", "latitude", "longitude", "location_title", "json") ON public."canned_response_bubbles" TO mcp_ro;

REVOKE ALL ON public."canned_response_quick_replies" FROM mcp_ro;
GRANT SELECT ("id", "canned_response_id", "label", "type", "url", "sort_order", "created_at", "updated_at", "deleted_at") ON public."canned_response_quick_replies" TO mcp_ro;

REVOKE ALL ON public."canned_responses" FROM mcp_ro;
GRANT SELECT ("id", "shortcut", "title", "category", "sort_order", "is_active", "created_at", "updated_at", "deleted_at", "response_type", "hide_from_chat", "verified_only") ON public."canned_responses" TO mcp_ro;

REVOKE ALL ON public."chart_of_accounts" FROM mcp_ro;
GRANT SELECT ("id", "code", "category", "createdAt", "deletedAt", "normalBalance", "status", "type", "updatedAt", "vatApplicable", "peak_code") ON public."chart_of_accounts" TO mcp_ro;

REVOKE ALL ON public."chat_auto_triggers" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "trigger_type", "scheduled_for", "sent_at", "status", "message_id", "error_message", "created_at", "deleted_at") ON public."chat_auto_triggers" TO mcp_ro;

REVOKE ALL ON public."chat_feedbacks" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "message_id", "rating", "feedback_text", "created_at", "updated_at", "deleted_at") ON public."chat_feedbacks" TO mcp_ro;

REVOKE ALL ON public."chat_kb_suggestions" FROM mcp_ro;
GRANT SELECT ("id", "session_id", "customer_question", "staff_answer", "suggested_intent", "suggested_keywords", "suggested_template", "source", "status", "reviewed_by_id", "reviewed_at", "kb_entry_id", "created_at", "updated_at") ON public."chat_kb_suggestions" TO mcp_ro;

REVOKE ALL ON public."chat_knowledge_base" FROM mcp_ro;
GRANT SELECT ("id", "channel", "category", "intent", "trigger_keywords", "example_questions", "response_template", "response_type", "requires_auth", "requires_tools", "active", "priority", "created_at", "updated_at", "deleted_at") ON public."chat_knowledge_base" TO mcp_ro;

REVOKE ALL ON public."chat_messages" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "role", "type", "text", "media_url", "intent", "confidence", "model_used", "input_tokens", "output_tokens", "cost_usd", "payment_id", "receipt_id", "created_at", "deleted_at", "staff_id", "delivered_at", "read_at", "delivery_status", "outbound_sent_at") ON public."chat_messages" TO mcp_ro;

REVOKE ALL ON public."chat_notes" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "staff_id", "created_at", "updated_at", "deleted_at", "pinned_at", "pinned_by_id") ON public."chat_notes" TO mcp_ro;

REVOKE ALL ON public."chat_rooms" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "channel", "status", "verified_at", "verification_attempts", "handoff_mode", "handoff_tagged_at", "handoff_staff_id", "total_messages", "last_message_at", "created_at", "updated_at", "deleted_at", "priority", "assigned_to_id", "first_response_at", "resolved_at", "lead_score", "lead_temperature", "pinned_at", "pinned_by_id", "unread_count", "display_name", "ai_paused", "ai_paused_at", "ai_paused_by_id") ON public."chat_rooms" TO mcp_ro;

REVOKE ALL ON public."chat_side_messages" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "staff_id", "created_at", "deleted_at") ON public."chat_side_messages" TO mcp_ro;

REVOKE ALL ON public."chat_snoozes" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "staff_id", "remind_at", "completed", "created_at") ON public."chat_snoozes" TO mcp_ro;

REVOKE ALL ON public."chatbot_otp_requests" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "hash", "expires_at", "attempts", "last_request_at", "created_at") ON public."chatbot_otp_requests" TO mcp_ro;

REVOKE ALL ON public."commission_payouts" FROM mcp_ro;
GRANT SELECT ("id", "salesperson_id", "period", "total_sales", "total_commission", "commission_count", "status", "approved_by_id", "approved_at", "paid_by_id", "paid_at", "created_at", "updated_at", "deleted_at", "generated_at") ON public."commission_payouts" TO mcp_ro;

REVOKE ALL ON public."commission_rules" FROM mcp_ro;
GRANT SELECT ("id", "rule_type", "rate", "fixed_amount", "min_sale_amount", "max_sale_amount", "is_active", "created_at", "updated_at", "deleted_at") ON public."commission_rules" TO mcp_ro;

REVOKE ALL ON public."company_info" FROM mcp_ro;
GRANT SELECT ("id", "name_th", "name_en", "director_position", "logo_url", "is_active", "created_at", "updated_at", "deleted_at", "company_code", "vat_registered", "vat_rate", "bank_name", "line_oa_id", "petty_cash_custodian_id", "tax_branch_code") ON public."company_info" TO mcp_ro;

REVOKE ALL ON public."contacts" FROM mcp_ro;
GRANT SELECT ("id", "created_at", "updated_at", "deleted_at") ON public."contacts" TO mcp_ro;

REVOKE ALL ON public."contract_cancellations" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "requested_by_id", "reason", "refund_amount", "status", "approved_by_id", "approved_at", "reversal_journal_entry_id", "created_at", "updated_at", "deleted_at") ON public."contract_cancellations" TO mcp_ro;

REVOKE ALL ON public."contract_daily_snapshots" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "date", "days_overdue", "outstanding", "status", "created_at") ON public."contract_daily_snapshots" TO mcp_ro;

REVOKE ALL ON public."contract_documents" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "document_type", "file_name", "file_url", "file_size", "uploaded_by_id", "created_at", "original_name", "mime_type", "version", "is_latest", "is_immutable", "deleted_at", "updated_at") ON public."contract_documents" TO mcp_ro;

REVOKE ALL ON public."contract_exchange_requests" FROM mcp_ro;
GRANT SELECT ("id", "old_contract_id", "old_product_id", "new_product_id", "status", "rejection_reason", "requested_by_id", "approved_by_id", "approved_at", "new_contract_id", "je_1a_id", "je_2_id", "je_3_id", "created_at", "updated_at", "deleted_at", "je_4_id", "approval_tier", "buyback_price", "cancel_reason", "cancel_window", "canceled_at", "canceled_by_id", "deposit_account_code", "device_condition", "ecl_reversal_je_id", "memo_applied_at", "mode", "new_interest_rate", "new_interest_total", "new_monthly_payment", "new_store_commission", "new_total_months", "new_vat_amount", "penalty_amount", "penalty_je_id", "reversal_je_ids", "previous_cost_price") ON public."contract_exchange_requests" TO mcp_ro;

REVOKE ALL ON public."contract_letters" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "letter_type", "letter_number", "status", "triggered_at", "pdf_url", "pdf_generated_at", "dispatched_at", "dispatched_by_id", "tracking_number", "delivered_at", "cancelled_at", "cancel_reason", "created_at", "updated_at", "deleted_at") ON public."contract_letters" TO mcp_ro;

REVOKE ALL ON public."contract_snoozes" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "user_id", "snoozed_until", "reason", "created_at", "updated_at", "deleted_at") ON public."contract_snoozes" TO mcp_ro;

REVOKE ALL ON public."contract_templates" FROM mcp_ro;
GRANT SELECT ("id", "type", "content_html", "placeholders", "is_active", "created_at", "updated_at", "blocks", "settings", "deleted_at") ON public."contract_templates" TO mcp_ro;

REVOKE ALL ON public."contracts" FROM mcp_ro;
GRANT SELECT ("id", "contract_number", "customer_id", "product_id", "status", "created_at", "updated_at", "deleted_at") ON public."contracts" TO mcp_ro;

REVOKE ALL ON public."conversation_tags" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "tag", "created_at") ON public."conversation_tags" TO mcp_ro;

REVOKE ALL ON public."credit_approvals" FROM mcp_ro;
GRANT SELECT ("id", "credit_check_id", "customer_id", "approved_by_id", "policy_version", "used_by_contract_id", "used_at", "used_first_payment_due", "superseded_at", "created_at", "updated_at", "deleted_at") ON public."credit_approvals" TO mcp_ro;

REVOKE ALL ON public."credit_checks" FROM mcp_ro;
GRANT SELECT ("id", "status", "created_at", "updated_at", "deleted_at") ON public."credit_checks" TO mcp_ro;

REVOKE ALL ON public."credit_note_details" FROM mcp_ro;
GRANT SELECT ("reason", "mode") ON public."credit_note_details" TO mcp_ro;

REVOKE ALL ON public."crm_lead_assignments" FROM mcp_ro;
GRANT SELECT ("id", "lead_id", "from_user_id", "to_user_id", "changed_by_id", "reason", "created_at") ON public."crm_lead_assignments" TO mcp_ro;

REVOKE ALL ON public."crm_lead_stage_history" FROM mcp_ro;
GRANT SELECT ("id", "lead_id", "old_stage", "new_stage", "staged_by_id", "reason", "staged_at") ON public."crm_lead_stage_history" TO mcp_ro;

REVOKE ALL ON public."crm_leads" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "contract_id", "stage", "source", "channel", "assigned_to_id", "branch_id", "interested_product", "estimated_value", "lost_reason", "won_at", "lost_at", "next_follow_up", "created_at", "updated_at", "deleted_at") ON public."crm_leads" TO mcp_ro;

REVOKE ALL ON public."crm_notes" FROM mcp_ro;
GRANT SELECT ("id", "lead_id", "staff_id", "created_at") ON public."crm_notes" TO mcp_ro;

REVOKE ALL ON public."customer_access_tokens" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "expires_at", "accessed_at", "access_count", "created_at") ON public."customer_access_tokens" TO mcp_ro;

REVOKE ALL ON public."customer_journey_entries" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "origin_customer_id", "origin", "kind", "occurred_at", "actor_type", "actor_user_id", "room_id", "ref_type", "ref_id", "data", "channel", "outcome", "lost_reason", "heard_from", "dedupe_key", "created_at", "deleted_at", "deleted_by_id") ON public."customer_journey_entries" TO mcp_ro;

REVOKE ALL ON public."customer_journey_states" FROM mcp_ro;
GRANT SELECT ("customer_id", "stage", "stage_entered_at", "path", "contacted_at", "identified_at", "interested_at", "credit_at", "first_purchase_at", "first_purchase_kind", "first_staff_reply_at", "first_channel", "first_source", "first_ad_campaign_id", "heard_from", "last_customer_at", "last_touch_at", "lost_at", "lost_reason", "computed_at") ON public."customer_journey_states" TO mcp_ro;

REVOKE ALL ON public."customer_line_links" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "channel", "linked_at", "unlinked_at", "deleted_at", "created_at", "updated_at") ON public."customer_line_links" TO mcp_ro;

REVOKE ALL ON public."customer_scores" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "payment_score", "engagement_score", "value_score", "risk_score", "total_score", "tier", "last_calculated_at", "updated_at", "created_at") ON public."customer_scores" TO mcp_ro;

REVOKE ALL ON public."customer_tags" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "tag", "source", "reason", "applied_by_user_id", "created_at", "updated_at", "deleted_at") ON public."customer_tags" TO mcp_ro;

REVOKE ALL ON public."customers" FROM mcp_ro;
GRANT SELECT ("id", "created_at", "updated_at", "deleted_at", "status", "merged_into_id") ON public."customers" TO mcp_ro;

REVOKE ALL ON public."daily_assignments" FROM mcp_ro;
GRANT SELECT ("id", "date", "collectorId", "contractId", "assignedAt", "source", "status", "startedAt", "completedAt", "outcome", "skipReason", "lockedAt", "lockExpiresAt", "escalationFlag", "paymentId", "lineMessageId", "position", "createdAt", "updatedAt", "deletedAt") ON public."daily_assignments" TO mcp_ro;

REVOKE ALL ON public."data_audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "run_id", "check_name", "severity", "status", "count", "details", "executed_at", "created_at", "acknowledged_at", "acknowledged_by_id") ON public."data_audit_logs" TO mcp_ro;

REVOKE ALL ON public."depreciation_entries" FROM mcp_ro;
GRANT SELECT ("id", "asset_id", "period", "amount", "journal_entry_no", "created_at", "reversed_at", "reversed_by_id") ON public."depreciation_entries" TO mcp_ro;

REVOKE ALL ON public."device_returns" FROM mcp_ro;
GRANT SELECT ("id", "doc_number", "contract_id", "product_id", "customer_id", "receiving_branch_id", "received_by_id", "return_kind", "return_reason", "device_received_at", "condition_grade", "appraisal_price", "table_base_price", "repair_cost", "previous_contract_status", "status", "confirmed_by_id", "confirmed_at", "repossession_id", "rejected_by_id", "rejected_at", "reject_reason", "canceled_by_id", "canceled_at", "line_notify_status", "line_notified_at", "line_notification_id", "created_at", "updated_at", "deleted_at") ON public."device_returns" TO mcp_ro;

REVOKE ALL ON public."document_audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "action", "user_id", "details", "created_at") ON public."document_audit_logs" TO mcp_ro;

REVOKE ALL ON public."dsar_requests" FROM mcp_ro;
GRANT SELECT ("id", "status", "created_at", "updated_at") ON public."dsar_requests" TO mcp_ro;

REVOKE ALL ON public."dunning_actions" FROM mcp_ro;
GRANT SELECT ("id", "dunning_rule_id", "contract_id", "payment_id", "channel", "status", "message_content", "result", "payment_link_url", "executed_at", "executed_by_id", "created_at", "updated_at", "deleted_at") ON public."dunning_actions" TO mcp_ro;

REVOKE ALL ON public."dunning_rules" FROM mcp_ro;
GRANT SELECT ("id", "trigger_day", "channel", "message_template", "include_payment_link", "auto_execute", "escalate_to", "is_active", "sort_order", "created_at", "updated_at", "deleted_at", "event_trigger", "tag_conditions", "template_name") ON public."dunning_rules" TO mcp_ro;

REVOKE ALL ON public."e_documents" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "document_type", "file_url", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."e_documents" TO mcp_ro;

REVOKE ALL ON public."employee_profiles" FROM mcp_ro;
GRANT SELECT ("id", "created_at", "updated_at", "deleted_at") ON public."employee_profiles" TO mcp_ro;

REVOKE ALL ON public."equity_attachments" FROM mcp_ro;
GRANT SELECT ("id", "s3_key", "filename", "size", "mime_type", "uploaded_by_id", "created_at") ON public."equity_attachments" TO mcp_ro;

REVOKE ALL ON public."equity_documents" FROM mcp_ro;
GRANT SELECT ("id", "doc_number", "company_id", "txn_type", "status", "txn_date", "resolution_no", "resolution_date", "payment_account_code", "pa_account_code", "pa_amount", "pa_direction", "maker_id", "approver_id", "journal_entry_id", "reverse_journal_entry_id", "reverse_reason", "posted_at", "reversed_at", "created_at", "updated_at", "deleted_at") ON public."equity_documents" TO mcp_ro;

REVOKE ALL ON public."equity_shareholder_lines" FROM mcp_ro;
GRANT SELECT ("id", "shareholder_id", "line_no", "amount", "premium", "paid", "wht", "created_at", "updated_at") ON public."equity_shareholder_lines" TO mcp_ro;

REVOKE ALL ON public."etax_submissions" FROM mcp_ro;
GRANT SELECT ("id", "payment_id", "xml_content", "signed_xml", "status", "submitted_at", "rd_submission_id", "rd_response", "accepted_at", "rejected_at", "reject_reason", "retry_count", "last_retry_at", "created_at", "updated_at", "deleted_at", "invoice_number") ON public."etax_submissions" TO mcp_ro;

REVOKE ALL ON public."expense_adjustments" FROM mcp_ro;
GRANT SELECT ("id", "line_no", "account_code", "side", "amount", "created_at", "updated_at") ON public."expense_adjustments" TO mcp_ro;

REVOKE ALL ON public."expense_details" FROM mcp_ro;
GRANT SELECT ("price_type") ON public."expense_details" TO mcp_ro;

REVOKE ALL ON public."expense_documents" FROM mcp_ro;
GRANT SELECT ("id", "number", "document_type", "branch_id", "document_date", "tax_invoice_no", "subtotal", "vat_amount", "withholding_tax", "wht_form_type", "total_amount", "net_payment", "status", "paid_at", "payment_method", "deposit_account_code", "journal_entry_id", "from_template_id", "created_by_id", "approved_by_id", "created_at", "updated_at", "deleted_at", "tax_disallowed", "vendor_supplier_id") ON public."expense_documents" TO mcp_ro;

REVOKE ALL ON public."expense_lines" FROM mcp_ro;
GRANT SELECT ("id", "expense_detail_id", "line_no", "category", "quantity", "unit_price", "discount", "vat_percent", "wht_percent", "amount_before_vat", "vat_amount", "wht_amount", "created_at", "updated_at", "wht_form_type", "tax_disallowed", "supplier_id") ON public."expense_lines" TO mcp_ro;

REVOKE ALL ON public."expense_templates" FROM mcp_ro;
GRANT SELECT ("id", "document_type", "branch_id", "prefilled_data", "is_recurring", "recurring_day", "created_by_id", "created_at", "updated_at", "deleted_at", "visibility", "category_id") ON public."expense_templates" TO mcp_ro;

REVOKE ALL ON public."external_finance_application_events" FROM mcp_ro;
GRANT SELECT ("id", "application_id", "kind", "actor_type", "actor_user_id", "created_at") ON public."external_finance_application_events" TO mcp_ro;

REVOKE ALL ON public."external_finance_application_files" FROM mcp_ro;
GRANT SELECT ("id", "application_id", "slot", "mime_type", "size", "source", "source_message_id", "source_angle", "sort_order", "sent_at", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."external_finance_application_files" TO mcp_ro;

REVOKE ALL ON public."external_finance_applications" FROM mcp_ro;
GRANT SELECT ("id", "number", "finance_company_id", "room_id", "customer_id", "product_id", "branch_id", "status", "result_source", "sent_at", "sent_by_id", "sent_via", "share_expires_at", "share_revoked_at", "share_view_count", "share_last_viewed_at", "last_partner_event_at", "closed_at", "files_purged_at", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."external_finance_applications" TO mcp_ro;

REVOKE ALL ON public."external_finance_commissions" FROM mcp_ro;
GRANT SELECT ("id", "external_finance_company_id", "customer_id", "financed_amount", "commission_rate", "commission_amount", "received_at", "bank_slip_url", "journal_entry_id", "status", "created_at", "updated_at", "deleted_at") ON public."external_finance_commissions" TO mcp_ro;

REVOKE ALL ON public."external_finance_companies" FROM mcp_ro;
GRANT SELECT ("id", "contact_person", "default_commission_rate", "is_active", "created_at", "updated_at", "deleted_at", "credit_term_days", "line_oa_id", "contact_id", "line_group_id", "precheck_template") ON public."external_finance_companies" TO mcp_ro;

REVOKE ALL ON public."fee_waiver_approvals" FROM mcp_ro;
GRANT SELECT ("id", "waiver_payment_id", "approver_id", "approved_at") ON public."fee_waiver_approvals" TO mcp_ro;

REVOKE ALL ON public."filter_presets" FROM mcp_ro;
GRANT SELECT ("id", "owner_user_id", "scope", "branch_id", "page", "filter_json", "created_at", "updated_at", "deleted_at") ON public."filter_presets" TO mcp_ro;

REVOKE ALL ON public."finance_company_contacts" FROM mcp_ro;
GRANT SELECT ("id", "external_finance_company_id", "position", "department", "is_primary", "is_active", "created_at", "updated_at", "deleted_at") ON public."finance_company_contacts" TO mcp_ro;

REVOKE ALL ON public."finance_receivable_contact_logs" FROM mcp_ro;
GRANT SELECT ("id", "finance_receivable_id", "external_finance_company_id", "finance_company_contact_id", "contacted_by_id", "contacted_at", "channel", "result", "promised_date", "promised_amount", "promised_broken_at", "promised_kept_at", "created_at", "updated_at", "deleted_at") ON public."finance_receivable_contact_logs" TO mcp_ro;

REVOKE ALL ON public."finance_receivables" FROM mcp_ro;
GRANT SELECT ("id", "sale_id", "branch_id", "finance_company", "finance_ref_number", "expected_amount", "commission_rate", "commission_amount", "net_expected_amount", "received_amount", "received_date", "bank_ref", "expected_date", "status", "recorded_by_id", "created_at", "updated_at", "deleted_at", "contact_attempt_count", "external_finance_company_id", "last_contacted_at", "last_promised_date") ON public."finance_receivables" TO mcp_ro;

REVOKE ALL ON public."fixed_assets" FROM mcp_ro;
GRANT SELECT ("id", "asset_code", "branch_id", "purchase_date", "status", "created_by_id", "created_at", "updated_at", "deleted_at", "category", "doc_no", "base_price", "shipping_cost", "installation_cost", "other_capitalized", "has_vat", "vat_inclusive", "vat_amount", "vat_account", "has_wht", "wht_base_amount", "wht_rate", "wht_amount", "wht_account", "wht_form_type", "purchase_cost", "residual_value", "useful_life_months", "monthly_depr", "accumulated_depr", "net_book_value", "coa_cost_account", "coa_depr_account", "coa_expense_account", "invoice_date", "disposal_date", "warranty_expire", "invoice_no", "tax_invoice_no", "payment_method", "payment_account", "custodian", "location", "serial_no", "pr_ref", "is_overridden", "approver_id", "posted_by_id", "posted_at", "reversed_by_id", "reversed_at", "reversal_reason", "vendor_id", "vendor_amount_paid", "permission_config", "invoice_received_at", "invoice_received_by_id", "invoice_transfer_journal_entry_id", "daily_depr") ON public."fixed_assets" TO mcp_ro;

REVOKE ALL ON public."gfin_model_mappings" FROM mcp_ro;
GRANT SELECT ("id", "gfin_series", "gfin_variant", "storage", "condition", "max_price", "model_match_pattern", "is_active", "created_at", "updated_at", "deleted_at") ON public."gfin_model_mappings" TO mcp_ro;

REVOKE ALL ON public."gfin_overprice_rules" FROM mcp_ro;
GRANT SELECT ("id", "label", "series_pattern", "condition", "allowance", "is_active", "created_at", "updated_at", "deleted_at", "max_months") ON public."gfin_overprice_rules" TO mcp_ro;

REVOKE ALL ON public."gfin_rate_factors" FROM mcp_ro;
GRANT SELECT ("id", "months", "factor", "fee_per_installment", "is_active", "created_at", "updated_at", "deleted_at", "shop_commission_pct") ON public."gfin_rate_factors" TO mcp_ro;

REVOKE ALL ON public."goods_receiving_items" FROM mcp_ro;
GRANT SELECT ("id", "receiving_id", "po_item_id", "imei_serial", "serial_number", "status", "reject_reason", "product_id", "created_at", "battery_health", "warranty_expired", "warranty_expire_date", "has_box", "checklist_results", "updated_at", "deleted_at", "defect_reason") ON public."goods_receiving_items" TO mcp_ro;

REVOKE ALL ON public."goods_receivings" FROM mcp_ro;
GRANT SELECT ("id", "po_id", "received_by_id", "created_at", "updated_at", "deleted_at", "gr_number") ON public."goods_receivings" TO mcp_ro;

REVOKE ALL ON public."imported_sales" FROM mcp_ro;
GRANT SELECT ("id") ON public."imported_sales" TO mcp_ro;

REVOKE ALL ON public."inspection_results" FROM mcp_ro;
GRANT SELECT ("id", "inspection_id", "template_item_id", "pass_fail", "grade", "score", "number_value", "created_at", "updated_at", "deleted_at") ON public."inspection_results" TO mcp_ro;

REVOKE ALL ON public."inspection_template_items" FROM mcp_ro;
GRANT SELECT ("id", "template_id", "category", "item_name", "score_type", "is_required", "weight", "sort_order", "created_at", "updated_at", "deleted_at") ON public."inspection_template_items" TO mcp_ro;

REVOKE ALL ON public."inspection_templates" FROM mcp_ro;
GRANT SELECT ("id", "device_type", "is_active", "created_at", "updated_at", "deleted_at") ON public."inspection_templates" TO mcp_ro;

REVOKE ALL ON public."inspections" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "template_id", "inspector_id", "inspected_at", "overall_grade", "grade_override", "override_reason", "is_completed", "created_at", "updated_at", "deleted_at") ON public."inspections" TO mcp_ro;

REVOKE ALL ON public."installment_schedules" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "installment_no", "due_date", "principal", "interest", "rescheduled_from_date", "reschedule_count", "accrual_journal_entry_id", "vat_60day_journal_entry_id", "created_at", "updated_at", "deleted_at", "amount_due") ON public."installment_schedules" TO mcp_ro;

REVOKE ALL ON public."inter_co_settlement_batches" FROM mcp_ro;
GRANT SELECT ("id", "batch_number", "status", "transfer_date", "posted_at", "finance_bank_code", "shop_bank_code", "total_financed", "total_commission", "total_amount", "shop_posted_amount", "transfer_ref", "slip_file_key", "maker_id", "approver_id", "finance_journal_entry_id", "shop_journal_entry_id", "reverse_reason", "created_at", "updated_at", "deleted_at", "total_deduction", "net_transfer_amount", "shop_net_amount") ON public."inter_co_settlement_batches" TO mcp_ro;

REVOKE ALL ON public."inter_co_settlement_items" FROM mcp_ro;
GRANT SELECT ("id", "batch_id", "contract_id", "financed_gl", "commission_gl", "shop_financed_gl", "shop_commission_gl", "legacy_no_shop", "created_at", "updated_at", "deleted_at", "item_type", "swap_credit_amount", "recall_amount", "device_return_amount") ON public."inter_co_settlement_items" TO mcp_ro;

REVOKE ALL ON public."inter_company_transactions" FROM mcp_ro;
GRANT SELECT ("id", "sale_id", "contract_id", "branch_id", "type", "status", "from_entity", "to_entity", "principal", "commission", "commission_pct", "vat_amount", "vat_pct", "total_amount", "interest_total", "cost_price", "down_payment", "selling_price", "shop_profit", "finance_profit", "reconciled_at", "created_at", "updated_at", "deleted_at", "from_company_id", "to_company_id", "journal_entry_id") ON public."inter_company_transactions" TO mcp_ro;

REVOKE ALL ON public."interest_config_rates" FROM mcp_ro;
GRANT SELECT ("id", "config_id", "months", "rate_pct", "created_at", "updated_at", "deleted_at") ON public."interest_config_rates" TO mcp_ro;

REVOKE ALL ON public."interest_configs" FROM mcp_ro;
GRANT SELECT ("id", "product_categories", "interest_rate", "min_down_payment_pct", "max_installment_months", "min_installment_months", "is_active", "created_at", "updated_at", "store_commission_pct", "vat_pct", "deleted_at") ON public."interest_configs" TO mcp_ro;

REVOKE ALL ON public."invite_tokens" FROM mcp_ro;
GRANT SELECT ("id", "role", "branch_id", "invited_by", "expires_at", "used_at", "created_at", "updated_at", "otp_expires_at", "otp_attempts") ON public."invite_tokens" TO mcp_ro;

REVOKE ALL ON public."ip_rate_limits" FROM mcp_ro;
-- (ไม่ให้สิทธิ์คอลัมน์ใดเลยในตารางนี้)

REVOKE ALL ON public."journal_entries" FROM mcp_ro;
GRANT SELECT ("id", "entry_number", "company_id", "entry_date", "status", "posted_at", "posted_by_id", "created_by_id", "created_at", "updated_at", "deleted_at", "peak_synced_at", "metadata") ON public."journal_entries" TO mcp_ro;

REVOKE ALL ON public."journal_lines" FROM mcp_ro;
GRANT SELECT ("id", "journal_entry_id", "account_code", "debit", "credit", "created_at", "updated_at", "deleted_at") ON public."journal_lines" TO mcp_ro;

REVOKE ALL ON public."journal_post_audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "journal_entry_id", "posted_by_id", "posted_at", "created_at") ON public."journal_post_audit_logs" TO mcp_ro;

REVOKE ALL ON public."known_devices" FROM mcp_ro;
GRANT SELECT ("id", "user_id", "fingerprint", "device_label", "first_seen_at", "last_seen_at", "login_count", "revoked_at") ON public."known_devices" TO mcp_ro;

REVOKE ALL ON public."kyc_verifications" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "customer_id", "otp_channel", "otp_attempts", "otp_sent_count", "otp_verified_at", "id_card_verified", "device_info", "status", "expires_at", "created_at", "otp_ref_code", "deleted_at", "updated_at") ON public."kyc_verifications" TO mcp_ro;

REVOKE ALL ON public."late_fee_waiver_requests" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "payment_ids", "reason", "total_waive_amount", "status", "requester_user_id", "approver_user_id", "approved_at", "rejected_reason", "created_at", "updated_at", "deleted_at") ON public."late_fee_waiver_requests" TO mcp_ro;

REVOKE ALL ON public."legal_case_documents" FROM mcp_ro;
GRANT SELECT ("id", "legal_case_id", "kind", "filename", "s3_url", "uploaded_at", "uploaded_by_user_id") ON public."legal_case_documents" TO mcp_ro;

REVOKE ALL ON public."legal_cases" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "case_number", "court", "hearing_date", "created_at", "updated_at", "deleted_at") ON public."legal_cases" TO mcp_ro;

REVOKE ALL ON public."line_group_memberships" FROM mcp_ro;
GRANT SELECT ("id", "channel", "group_id", "member_count", "joined_at", "left_at", "created_at", "updated_at", "deleted_at") ON public."line_group_memberships" TO mcp_ro;

REVOKE ALL ON public."login_audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "user_id", "success", "failure_kind", "created_at", "device_fingerprint", "is_new_device") ON public."login_audit_logs" TO mcp_ro;

REVOKE ALL ON public."loyalty_points" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "payment_id", "contract_id", "points", "reason", "created_at", "updated_at", "deleted_at") ON public."loyalty_points" TO mcp_ro;

REVOKE ALL ON public."loyalty_redemptions" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "points", "reason", "discount_amount", "contract_id", "created_at", "updated_at", "deleted_at") ON public."loyalty_redemptions" TO mcp_ro;

REVOKE ALL ON public."mdm_lock_requests" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "status", "trigger", "include_wallpaper", "proposed_by_id", "proposed_at", "approved_by_id", "approved_at", "rejected_by_id", "rejected_reason", "reason", "external_ref", "wallpaper_url_used", "created_at", "updated_at", "deleted_at") ON public."mdm_lock_requests" TO mcp_ro;

REVOKE ALL ON public."notification_logs" FROM mcp_ro;
GRANT SELECT ("id", "channel", "subject", "status", "related_id", "error_msg", "sent_at", "created_at", "retry_count", "next_retry_at", "external_id", "delivery_status", "delivered_at", "updated_at", "deleted_at", "channel_key", "customer_id", "category", "block_reason") ON public."notification_logs" TO mcp_ro;

REVOKE ALL ON public."notification_templates" FROM mcp_ro;
GRANT SELECT ("id", "event_type", "category", "channel_key", "channel", "format", "subject", "message_template", "flex_template", "is_active", "sample_data", "last_edited_by", "created_at", "updated_at", "deleted_at") ON public."notification_templates" TO mcp_ro;

REVOKE ALL ON public."offsite_backup_runs" FROM mcp_ro;
GRANT SELECT ("id", "started_at", "finished_at", "status", "files_count", "total_bytes", "error_message", "triggered_by", "dest_bucket", "created_at", "triggered_by_user_id") ON public."offsite_backup_runs" TO mcp_ro;

REVOKE ALL ON public."online_installment_applications" FROM mcp_ro;
GRANT SELECT ("id", "application_number", "customer_id", "product_id", "reservation_id", "proposed_down_payment", "proposed_total_months", "proposed_monthly_payment", "status", "scheduled_at", "reviewed_at", "reviewed_by_id", "reject_reason", "contract_id", "created_at", "updated_at", "deleted_at") ON public."online_installment_applications" TO mcp_ro;

REVOKE ALL ON public."online_orders" FROM mcp_ro;
GRANT SELECT ("id", "order_number", "customer_id", "product_id", "reservation_id", "product_price", "shipping_fee", "promo_code", "promo_discount", "promotion_usage_id", "loyalty_points_used", "loyalty_discount", "total_amount", "shipping_method", "tracking_number", "shipped_at", "delivered_at", "payment_channel", "payment_link_id", "payment_ref", "paid_at", "bank_slip_url", "bank_confirmed_by_id", "status", "cancel_reason", "cancelled_at", "sale_id", "created_at", "updated_at", "deleted_at") ON public."online_orders" TO mcp_ro;

REVOKE ALL ON public."other_income_adjustments" FROM mcp_ro;
GRANT SELECT ("id", "other_income_id", "line_no", "account_code", "amount", "created_at") ON public."other_income_adjustments" TO mcp_ro;

REVOKE ALL ON public."other_income_attachments" FROM mcp_ro;
GRANT SELECT ("id", "other_income_id", "s3_key", "filename", "size", "mime_type", "uploaded_by_id", "created_at") ON public."other_income_attachments" TO mcp_ro;

REVOKE ALL ON public."other_income_items" FROM mcp_ro;
GRANT SELECT ("id", "other_income_id", "line_no", "account_code", "quantity", "unit_amount", "discount_amount", "vat_pct", "wht_pct", "amount_before_vat", "vat_amount", "wht_amount", "created_at", "updated_at", "deleted_at") ON public."other_income_items" TO mcp_ro;

REVOKE ALL ON public."other_income_templates" FROM mcp_ro;
GRANT SELECT ("id", "company_id", "is_favorite", "use_count", "last_used_at", "items_json", "price_type", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."other_income_templates" TO mcp_ro;

REVOKE ALL ON public."other_incomes" FROM mcp_ro;
GRANT SELECT ("id", "doc_number", "company_id", "status", "issue_date", "due_date", "payment_date", "price_type", "customer_id", "payment_account_code", "amount_received", "income_gross", "vat_amount", "wht_amount", "net_received", "total_amount", "receipt_no", "journal_entry_id", "is_overridden", "created_by_id", "posted_at", "reverses_id", "reverse_reason", "copied_from_id", "created_at", "updated_at", "deleted_at", "approver_id", "approved_at", "rejected_by_id", "rejected_at", "reverse_reason_label") ON public."other_incomes" TO mcp_ro;

REVOKE ALL ON public."outbox_events" FROM mcp_ro;
GRANT SELECT ("id", "flow_type", "source_id", "source_entity", "target_entity", "status", "attempts", "last_error", "idempotency_key", "created_at", "updated_at", "processed_at", "deleted_at") ON public."outbox_events" TO mcp_ro;

REVOKE ALL ON public."partial_payment_links" FROM mcp_ro;
GRANT SELECT ("id", "payment_id", "contract_id", "customer_id", "amount", "gateway_ref", "payment_url", "status", "expires_at", "paid_at", "cancelled_at", "created_at", "updated_at", "purpose", "metadata") ON public."partial_payment_links" TO mcp_ro;

REVOKE ALL ON public."password_reset_tokens" FROM mcp_ro;
-- (ไม่ให้สิทธิ์คอลัมน์ใดเลยในตารางนี้)

REVOKE ALL ON public."payment_approval_requests" FROM mcp_ro;
GRANT SELECT ("id", "action", "target_id", "contract_id", "requested_by_id", "required_permissions", "review_summary", "reason", "status", "reviewed_by_id", "reviewed_at", "review_reason", "created_at", "updated_at", "deleted_at") ON public."payment_approval_requests" TO mcp_ro;

REVOKE ALL ON public."payment_drafts" FROM mcp_ro;
GRANT SELECT ("id", "payment_id", "amount", "payment_method", "deposit_account_code", "late_fee", "late_fee_waiver_amount", "late_fee_waiver_reason_code", "waiver_approver_id", "consume_advance", "paid_date", "payment_case", "transaction_ref", "evidence_url", "created_by_id", "created_at", "updated_at", "deleted_at", "additional_late_fee") ON public."payment_drafts" TO mcp_ro;

REVOKE ALL ON public."payment_evidences" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "payment_id", "amount", "status", "reviewed_by_id", "reviewed_at", "created_at", "deleted_at", "updated_at") ON public."payment_evidences" TO mcp_ro;

REVOKE ALL ON public."payment_links" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "payment_id", "amount", "status", "expires_at", "used_at", "created_at", "deleted_at", "saving_plan_id") ON public."payment_links" TO mcp_ro;

REVOKE ALL ON public."payment_method_configs" FROM mcp_ro;
GRANT SELECT ("id", "method", "account_code", "is_default", "enabled", "sort_order", "created_at", "updated_at", "deleted_at") ON public."payment_method_configs" TO mcp_ro;

REVOKE ALL ON public."payments" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "installment_no", "due_date", "amount_due", "amount_paid", "paid_date", "payment_method", "late_fee", "evidence_url", "status", "recorded_by_id", "created_at", "updated_at", "late_fee_waived", "gateway_ref", "gateway_response", "gateway_status", "paid_at", "deleted_at", "monthly_principal", "monthly_interest", "monthly_commission", "vat_amount", "legacy_installment_code", "waived_by_id", "waived_at", "waived_reason", "waived_approved_by_id", "waived_amount", "deposit_account_code") ON public."payments" TO mcp_ro;

REVOKE ALL ON public."payroll_custom_deduction" FROM mcp_ro;
GRANT SELECT ("id", "account_code", "amount", "created_at", "updated_at") ON public."payroll_custom_deduction" TO mcp_ro;

REVOKE ALL ON public."payroll_custom_income" FROM mcp_ro;
GRANT SELECT ("id", "account_code", "amount", "is_taxable", "created_at", "updated_at") ON public."payroll_custom_income" TO mcp_ro;

REVOKE ALL ON public."payroll_details" FROM mcp_ro;
GRANT SELECT ("payroll_period", "entity_scope") ON public."payroll_details" TO mcp_ro;

REVOKE ALL ON public."payroll_lines" FROM mcp_ro;
GRANT SELECT ("id", "payroll_id", "sso_employee", "wht_amount", "net_paid", "created_at", "updated_at", "user_id") ON public."payroll_lines" TO mcp_ro;

REVOKE ALL ON public."pdpa_backfill_runs" FROM mcp_ro;
GRANT SELECT ("id", "status", "total_records", "processed_records", "skipped_records", "started_at", "finished_at", "error_message", "triggered_by", "triggered_by_user_id", "hostname", "created_at") ON public."pdpa_backfill_runs" TO mcp_ro;

REVOKE ALL ON public."pdpa_consents" FROM mcp_ro;
GRANT SELECT ("id", "customer_id", "consent_version", "privacy_notice_text", "purposes", "status", "granted_at", "revoked_at", "revoke_reason", "device_info", "created_at", "deleted_at", "updated_at") ON public."pdpa_consents" TO mcp_ro;

REVOKE ALL ON public."po_items" FROM mcp_ro;
GRANT SELECT ("id", "po_id", "brand", "model", "quantity", "unit_price", "received_qty", "created_at", "updated_at", "color", "storage", "category", "accessory_type", "accessory_brand", "deleted_at") ON public."po_items" TO mcp_ro;

REVOKE ALL ON public."pricing_templates" FROM mcp_ro;
GRANT SELECT ("id", "brand", "model", "storage", "category", "has_warranty", "cash_price", "installment_bestchoice_price", "installment_finance_price", "is_active", "created_at", "updated_at", "deleted_at", "rate1_down_payment", "rate1_term_months", "rate2_down_payment", "rate2_term_months", "device_origin") ON public."pricing_templates" TO mcp_ro;

REVOKE ALL ON public."processed_webhook_events" FROM mcp_ro;
GRANT SELECT ("id", "event_id", "processed_at") ON public."processed_webhook_events" TO mcp_ro;

REVOKE ALL ON public."product_photos" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "front", "back", "left", "right", "top", "bottom", "is_completed", "uploaded_by_id", "created_at", "updated_at", "deleted_at") ON public."product_photos" TO mcp_ro;

REVOKE ALL ON public."product_prices" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "label", "amount", "is_default", "created_at", "updated_at", "deleted_at") ON public."product_prices" TO mcp_ro;

REVOKE ALL ON public."product_reservations" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "customer_id", "session_id", "reserved_at", "expires_at", "status", "consumed_by_id", "created_at", "updated_at", "preempt_notified_at") ON public."product_reservations" TO mcp_ro;

REVOKE ALL ON public."products" FROM mcp_ro;
GRANT SELECT ("id", "brand", "model", "imei_serial", "category", "cost_price", "supplier_id", "po_id", "branch_id", "status", "inspection_id", "created_at", "updated_at", "deleted_at", "color", "storage", "serial_number", "battery_health", "warranty_expired", "warranty_expire_date", "has_box", "accessory_type", "accessory_brand", "stock_in_date", "checklist_results", "legacy_product_code", "owned_by_company_id", "shop_warranty_days", "was_previously_damaged", "restored_from_terminal_at", "condition_grade", "gallery", "gallery360", "is_online_visible", "cash_price", "installment_price", "accessories_included", "price_autofilled_at", "device_origin", "warranty_terms") ON public."products" TO mcp_ro;

REVOKE ALL ON public."promise_slots" FROM mcp_ro;
GRANT SELECT ("id", "call_log_id", "slot_index", "settlement_date", "settlement_amount", "paid_amount", "kept_at", "broken_at", "locked_at", "created_at", "updated_at") ON public."promise_slots" TO mcp_ro;

REVOKE ALL ON public."promotion_usages" FROM mcp_ro;
GRANT SELECT ("id", "promotion_id", "sale_id", "customer_id", "discount_applied", "created_at", "deleted_at") ON public."promotion_usages" TO mcp_ro;

REVOKE ALL ON public."promotions" FROM mcp_ro;
GRANT SELECT ("id", "type", "discount_value", "special_interest_rate", "conditions", "start_date", "end_date", "max_usage_count", "current_usage_count", "is_active", "created_at", "updated_at", "deleted_at") ON public."promotions" TO mcp_ro;

REVOKE ALL ON public."purchase_orders" FROM mcp_ro;
GRANT SELECT ("id", "po_number", "supplier_id", "order_date", "expected_date", "status", "total_amount", "created_by_id", "approved_by_id", "created_at", "updated_at", "payment_status", "paid_amount", "discount", "vat_amount", "net_amount", "payment_method", "due_date", "stock_check_ref", "reject_reason", "deleted_at", "discount_after_vat", "ordered_at", "is_direct_receive") ON public."purchase_orders" TO mcp_ro;

REVOKE ALL ON public."quote_items" FROM mcp_ro;
GRANT SELECT ("id", "quote_id", "product_id", "quantity", "unit_price", "amount", "created_at") ON public."quote_items" TO mcp_ro;

REVOKE ALL ON public."quotes" FROM mcp_ro;
GRANT SELECT ("id", "quote_number", "customer_id", "branch_id", "status", "valid_until", "subtotal", "discount", "vat_amount", "total", "converted_to_sale_id", "sent_at", "accepted_at", "rejected_at", "converted_at", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."quotes" TO mcp_ro;

REVOKE ALL ON public."receipts" FROM mcp_ro;
GRANT SELECT ("id", "receipt_number", "contract_id", "payment_id", "amount", "installment_no", "remaining_balance", "remaining_months", "payment_method", "transaction_ref", "paid_date", "file_url", "is_voided", "void_reason", "voided_receipt_id", "issued_by_id", "created_at", "receiptType", "deleted_at", "updated_at", "amount_before_vat", "vat_amount", "void_approved_by_id", "void_approved_at", "payment_status", "installment_partial_seq", "remaining_amount", "cn_source", "public_token_expires_at", "source_journal_entry_id") ON public."receipts" TO mcp_ro;

REVOKE ALL ON public."receivable_recon_logs" FROM mcp_ro;
GRANT SELECT ("id", "run_date", "branch_id", "journal_balance", "contract_outstanding", "gap", "threshold", "breached", "created_at") ON public."receivable_recon_logs" TO mcp_ro;

REVOKE ALL ON public."refresh_tokens" FROM mcp_ro;
GRANT SELECT ("id", "user_id", "expires_at", "revoked_at", "created_at") ON public."refresh_tokens" TO mcp_ro;

REVOKE ALL ON public."refunds" FROM mcp_ro;
GRANT SELECT ("id", "payment_id", "contract_id", "amount", "reason", "status", "requested_by_id", "requested_at", "approved_by_id", "approved_at", "rejected_by_id", "rejected_at", "rejected_reason", "bank_reversal_ref", "bank_reversal_at", "failure_reason", "created_at", "updated_at", "deleted_at", "bank_reversal_locked_at") ON public."refunds" TO mcp_ro;

REVOKE ALL ON public."reorder_points" FROM mcp_ro;
GRANT SELECT ("id", "brand", "model", "storage", "category", "branch_id", "min_quantity", "reorder_quantity", "is_active", "created_at", "updated_at", "deleted_at") ON public."reorder_points" TO mcp_ro;

REVOKE ALL ON public."repair_status_logs" FROM mcp_ro;
GRANT SELECT ("id", "ticket_id", "from_status", "to_status", "changed_by_id", "created_at") ON public."repair_status_logs" TO mcp_ro;

REVOKE ALL ON public."repair_tickets" FROM mcp_ro;
GRANT SELECT ("id", "ticket_number", "status", "customer_id", "contract_id", "product_id", "device_brand", "device_model", "device_imei", "device_serial", "warranty_status", "repair_supplier_id", "external_claim_no", "sent_to_repair_at", "repaired_at", "returned_to_customer_at", "cancelled_at", "replaced_at", "estimated_cost", "actual_cost", "payer", "other_income_id", "replacement_contract_id", "branch_id", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."repair_tickets" TO mcp_ro;

REVOKE ALL ON public."repossessions" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "product_id", "repossessed_date", "condition_grade", "appraisal_price", "appraised_by_id", "repair_cost", "resell_price", "status", "sold_contract_id", "created_at", "updated_at", "deleted_at", "closing_amount", "customer_refund", "customer_refund_enabled", "discount_amount", "discount_pct", "finance_cost", "market_value", "profit_loss", "remaining_cost", "remaining_months") ON public."repossessions" TO mcp_ro;

REVOKE ALL ON public."reverse_reasons" FROM mcp_ro;
GRANT SELECT ("id", "label", "sort_order", "is_active", "created_at", "updated_at", "deleted_at") ON public."reverse_reasons" TO mcp_ro;

REVOKE ALL ON public."reviews" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "customer_id", "rating", "title", "verified", "verified_source", "status", "hidden_reason", "moderated_by_id", "moderated_at", "created_at", "updated_at", "deleted_at") ON public."reviews" TO mcp_ro;

REVOKE ALL ON public."room_credit_analyses" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "file_ids", "status", "credit_check_id", "created_at", "updated_at", "deleted_at") ON public."room_credit_analyses" TO mcp_ro;

REVOKE ALL ON public."room_credit_files" FROM mcp_ro;
GRANT SELECT ("id", "room_id", "mime_type", "size", "source_message_id", "created_at", "updated_at", "deleted_at") ON public."room_credit_files" TO mcp_ro;

REVOKE ALL ON public."sale_cost_snapshots" FROM mcp_ro;
GRANT SELECT ("sale_id", "main_product_cost", "recorded_at") ON public."sale_cost_snapshots" TO mcp_ro;

REVOKE ALL ON public."sales" FROM mcp_ro;
GRANT SELECT ("id", "sale_number", "sale_type", "customer_id", "product_id", "branch_id", "salesperson_id", "selling_price", "discount", "net_amount", "payment_method", "amount_received", "contract_id", "finance_company", "finance_ref_number", "finance_amount", "created_at", "down_payment_amount", "bundle_product_ids", "updated_at", "deleted_at", "online_order_id", "sale_source", "void_reason", "voided_by_id", "shop_warranty_start_date", "shop_warranty_end_date", "product_disclosure") ON public."sales" TO mcp_ro;

REVOKE ALL ON public."sales_commissions" FROM mcp_ro;
GRANT SELECT ("id", "salesperson_id", "contract_id", "sale_id", "commission_rule_id", "period", "sale_amount", "commission_rate", "commission_amount", "status", "approved_by_id", "approved_at", "paid_at", "paid_amount", "created_at", "updated_at", "deleted_at", "clawback_amount", "clawback_percent", "clawback_at", "clawback_reason", "months_paid_before_default", "rule_version_id") ON public."sales_commissions" TO mcp_ro;

REVOKE ALL ON public."saving_plan_payments" FROM mcp_ro;
GRANT SELECT ("id", "saving_plan_id", "amount", "paid_at", "payment_method", "payment_ref", "payment_link_id", "created_at") ON public."saving_plan_payments" TO mcp_ro;

REVOKE ALL ON public."saving_plans" FROM mcp_ro;
GRANT SELECT ("id", "plan_number", "customer_id", "target_product_model", "target_product_id", "target_amount", "monthly_amount", "duration_months", "total_saved", "status", "started_at", "next_payment_due_at", "completed_at", "cancelled_at", "applied_to_contract_id", "created_at", "updated_at", "deleted_at") ON public."saving_plans" TO mcp_ro;

REVOKE ALL ON public."settlement_lines" FROM mcp_ro;
GRANT SELECT ("id", "settlement_id", "amount_settled", "created_at", "updated_at") ON public."settlement_lines" TO mcp_ro;

REVOKE ALL ON public."shareholders" FROM mcp_ro;
GRANT SELECT ("id", "shares", "share_pct", "type", "is_active", "created_at", "updated_at", "deleted_at") ON public."shareholders" TO mcp_ro;

REVOKE ALL ON public."shop_cash_closes" FROM mcp_ro;
GRANT SELECT ("id", "branch_id", "status", "attempt_no", "period_start", "float_amount", "cash_in", "cash_out", "expected_amount", "counted_amount", "variance_amount", "variance_reason", "send_amount", "counted_by_id", "counted_at", "received_amount", "receive_variance", "destination", "confirmed_by_id", "confirmed_at", "sent_back_by_id", "sent_back_at", "sent_back_reason", "created_at", "updated_at", "journal_entry_id") ON public."shop_cash_closes" TO mcp_ro;

REVOKE ALL ON public."shop_cash_deposits" FROM mcp_ro;
GRANT SELECT ("id", "branch_id", "source", "amount", "deposited_by_id", "deposited_at", "journal_entry_id", "created_at", "updated_at") ON public."shop_cash_deposits" TO mcp_ro;

REVOKE ALL ON public."shop_tenders" FROM mcp_ro;
GRANT SELECT ("id", "direction", "kind", "branch_id", "method", "amount", "actor_id", "occurred_at", "seq", "seq_total", "sale_id", "contract_id", "booking_id", "trade_in_id", "reverses_tender_id", "created_at") ON public."shop_tenders" TO mcp_ro;

REVOKE ALL ON public."signatures" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "signer_type", "device_info", "signed_at", "screen_size", "gps_latitude", "gps_longitude", "staff_user_id", "created_at", "deleted_at", "updated_at") ON public."signatures" TO mcp_ro;

REVOKE ALL ON public."slip_fingerprints" FROM mcp_ro;
GRANT SELECT ("id", "hash", "contract_id", "payment_id", "created_at") ON public."slip_fingerprints" TO mcp_ro;

REVOKE ALL ON public."sms_templates" FROM mcp_ro;
GRANT SELECT ("id", "channel", "subject", "variables", "active", "variant_of", "created_at", "updated_at", "deleted_at") ON public."sms_templates" TO mcp_ro;

REVOKE ALL ON public."sso_config" FROM mcp_ro;
GRANT SELECT ("id", "max_contribution", "effective_from", "effective_to", "is_active", "created_at", "updated_at", "deleted_at") ON public."sso_config" TO mcp_ro;

REVOKE ALL ON public."staff_chat_activities" FROM mcp_ro;
GRANT SELECT ("id", "staff_id", "action", "created_at") ON public."staff_chat_activities" TO mcp_ro;

REVOKE ALL ON public."sticker_templates" FROM mcp_ro;
GRANT SELECT ("id", "size_width_mm", "size_height_mm", "layout_config", "placeholders", "is_active", "created_at", "updated_at", "deleted_at") ON public."sticker_templates" TO mcp_ro;

REVOKE ALL ON public."stock_adjustments" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "branch_id", "reason", "previous_status", "adjusted_by_id", "created_at", "updated_at", "deleted_at", "approved_by_id", "approved_at") ON public."stock_adjustments" TO mcp_ro;

REVOKE ALL ON public."stock_alerts" FROM mcp_ro;
GRANT SELECT ("id", "reorder_point_id", "brand", "model", "storage", "category", "branch_id", "current_stock", "min_quantity", "reorder_quantity", "status", "po_id", "resolved_at", "created_at", "updated_at", "deleted_at") ON public."stock_alerts" TO mcp_ro;

REVOKE ALL ON public."stock_count_items" FROM mcp_ro;
GRANT SELECT ("id", "stock_count_id", "product_id", "expected_status", "actual_found", "scanned_imei", "created_at", "deleted_at", "updated_at") ON public."stock_count_items" TO mcp_ro;

REVOKE ALL ON public."stock_counts" FROM mcp_ro;
GRANT SELECT ("id", "count_number", "branch_id", "counted_by_id", "status", "started_at", "completed_at", "created_at", "updated_at", "deleted_at") ON public."stock_counts" TO mcp_ro;

REVOKE ALL ON public."stock_transfers" FROM mcp_ro;
GRANT SELECT ("id", "product_id", "from_branch_id", "to_branch_id", "transferred_by", "created_at", "status", "confirmed_by_id", "confirmed_at", "batch_number", "dispatched_by_id", "dispatched_at", "expected_delivery_date", "updated_at", "deleted_at") ON public."stock_transfers" TO mcp_ro;

REVOKE ALL ON public."supplier_payment_methods" FROM mcp_ro;
GRANT SELECT ("id", "supplier_id", "payment_method", "bank_name", "credit_term_days", "is_default", "created_at", "updated_at", "deleted_at") ON public."supplier_payment_methods" TO mcp_ro;

REVOKE ALL ON public."suppliers" FROM mcp_ro;
GRANT SELECT ("id", "is_active", "created_at", "updated_at", "has_vat", "deleted_at", "type", "branch_code", "contact_position", "is_repair_center", "contact_id") ON public."suppliers" TO mcp_ro;

REVOKE ALL ON public."system_config" FROM mcp_ro;
GRANT SELECT ("id", "key", "value", "label", "created_at", "updated_at", "deleted_at") ON public."system_config" TO mcp_ro;

REVOKE ALL ON public."tax_reports" FROM mcp_ro;
GRANT SELECT ("id", "company_id", "report_type", "report_year", "report_month", "total_sales", "total_vat_output", "total_purchases", "total_vat_input", "net_vat", "total_wht", "transaction_count", "status", "generated_data", "filed_at", "filed_by_id", "created_at", "updated_at", "deleted_at") ON public."tax_reports" TO mcp_ro;

REVOKE ALL ON public."template_categories" FROM mcp_ro;
GRANT SELECT ("id", "created_at", "updated_at", "deleted_at") ON public."template_categories" TO mcp_ro;

REVOKE ALL ON public."todo_comments" FROM mcp_ro;
GRANT SELECT ("id", "todo_id", "user_id", "created_at") ON public."todo_comments" TO mcp_ro;

REVOKE ALL ON public."todos" FROM mcp_ro;
GRANT SELECT ("id", "title", "status", "priority", "due_date", "completed_at", "created_by_id", "assignee_id", "branch_id", "tags", "checklist", "created_at", "updated_at", "deleted_at", "room_id") ON public."todos" TO mcp_ro;

REVOKE ALL ON public."trade_in_credit_redemptions" FROM mcp_ro;
GRANT SELECT ("id", "trade_in_id", "sale_id", "contract_id", "base_amount", "bonus_amount", "created_by_id", "created_at", "application_journal_entry_id", "released_at", "released_by_id", "release_reason") ON public."trade_in_credit_redemptions" TO mcp_ro;

REVOKE ALL ON public."trade_in_valuations" FROM mcp_ro;
GRANT SELECT ("id", "brand", "model", "storage", "condition", "base_price", "created_at", "updated_at", "deleted_at") ON public."trade_in_valuations" TO mcp_ro;

REVOKE ALL ON public."trade_ins" FROM mcp_ro;
GRANT SELECT ("id", "status", "created_at", "updated_at", "deleted_at") ON public."trade_ins" TO mcp_ro;

REVOKE ALL ON public."user_expense_templates" FROM mcp_ro;
GRANT SELECT ("template_id", "user_id", "created_at") ON public."user_expense_templates" TO mcp_ro;

REVOKE ALL ON public."users" FROM mcp_ro;
GRANT SELECT ("id", "role", "branch_id", "is_active", "created_at", "updated_at", "deleted_at") ON public."users" TO mcp_ro;

REVOKE ALL ON public."vendor_settlement_details" FROM mcp_ro;
-- (ไม่ให้สิทธิ์คอลัมน์ใดเลยในตารางนี้)

REVOKE ALL ON public."warranty_audit_logs" FROM mcp_ro;
GRANT SELECT ("id", "contract_id", "user_id", "old_end_date", "new_end_date", "direction", "reason", "created_at") ON public."warranty_audit_logs" TO mcp_ro;

REVOKE ALL ON public."webhook_anomalies" FROM mcp_ro;
GRANT SELECT ("id", "provider", "reason", "meta", "created_at") ON public."webhook_anomalies" TO mcp_ro;

REVOKE ALL ON public."webhook_deliveries" FROM mcp_ro;
GRANT SELECT ("id", "subscription_id", "event_type", "status_code", "success", "error_message", "attempt_count", "delivered_at", "created_at") ON public."webhook_deliveries" TO mcp_ro;

REVOKE ALL ON public."webhook_subscriptions" FROM mcp_ro;
GRANT SELECT ("id", "url", "events", "is_active", "created_by_id", "created_at", "updated_at", "deleted_at") ON public."webhook_subscriptions" TO mcp_ro;

REVOKE ALL ON public."website_sessions" FROM mcp_ro;
GRANT SELECT ("id", "session_id", "customer_id", "device", "browser", "started_at", "ended_at", "page_count", "duration_sec", "reached_cart", "reached_checkout", "completed_order", "order_id", "entry_page", "exit_page", "referrer", "utm_source", "utm_campaign") ON public."website_sessions" TO mcp_ro;

REVOKE ALL ON public."website_visits" FROM mcp_ro;
GRANT SELECT ("id") ON public."website_visits" TO mcp_ro;

COMMIT;
