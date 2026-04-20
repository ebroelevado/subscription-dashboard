CREATE TABLE `agent_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`label` text,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_artifacts_run_id_index` ON `agent_artifacts` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_run_kind_index` ON `agent_artifacts` (`run_id`,`kind`);--> statement-breakpoint
CREATE TABLE `agent_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`role` text NOT NULL,
	`sequence` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_messages_run_id_index` ON `agent_messages` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_messages_run_sequence_index` ON `agent_messages` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model` text NOT NULL,
	`source` text DEFAULT 'durable_object' NOT NULL,
	`allow_destructive` integer DEFAULT false NOT NULL,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_user_id_index` ON `agent_runs` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_runs_status_index` ON `agent_runs` (`status`);--> statement-breakpoint
CREATE INDEX `agent_runs_started_at_index` ON `agent_runs` (`started_at`);--> statement-breakpoint
CREATE TABLE `agent_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`step_number` integer NOT NULL,
	`tool_name` text NOT NULL,
	`tool_call_id` text,
	`status` text NOT NULL,
	`input` text,
	`output` text,
	`error_message` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_tool_calls_run_id_index` ON `agent_tool_calls` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_tool_calls_run_step_index` ON `agent_tool_calls` (`run_id`,`step_number`);--> statement-breakpoint
CREATE INDEX `agent_tool_calls_run_tool_call_id_index` ON `agent_tool_calls` (`run_id`,`tool_call_id`);