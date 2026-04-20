ALTER TABLE `agent_tool_calls` ADD `dedupe_hash` text;--> statement-breakpoint
ALTER TABLE `agent_tool_calls` ADD `mutation_audit_log_id` text REFERENCES mutation_audit_logs(id);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tool_calls_run_dedupe_unique` ON `agent_tool_calls` (`run_id`,`dedupe_hash`);--> statement-breakpoint
CREATE INDEX `agent_tool_calls_audit_log_index` ON `agent_tool_calls` (`mutation_audit_log_id`);