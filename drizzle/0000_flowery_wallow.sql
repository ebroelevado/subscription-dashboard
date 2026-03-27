CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text NOT NULL,
	`email_verified` text,
	`password` text,
	`image` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`copilot_token` text,
	`currency` text DEFAULT 'EUR' NOT NULL,
	`discipline_penalty` real DEFAULT 0.5 NOT NULL,
	`usage_credits` real DEFAULT 0 NOT NULL,
	`company_name` text,
	`whatsapp_signature_mode` text DEFAULT 'name' NOT NULL,
	`plan` text DEFAULT 'FREE' NOT NULL,
	`stripe_customer_id` text,
	`stripe_subscription_id` text,
	`stripe_price_id` text,
	`stripe_current_period_end` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_stripe_customer_id_unique` ON `users` (`stripe_customer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_stripe_subscription_id_unique` ON `users` (`stripe_subscription_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`provider_account_id` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `unique_provider_account` ON `accounts` (`provider`,`provider_account_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_session_token_unique` ON `sessions` (`session_token`);--> statement-breakpoint
CREATE TABLE `verification_tokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `verification_tokens_token_unique` ON `verification_tokens` (`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_identifier_token` ON `verification_tokens` (`identifier`,`token`);--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platforms_user_id_index` ON `platforms` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `unique_user_platform` ON `platforms` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`platform_id` text NOT NULL,
	`name` text NOT NULL,
	`cost` integer NOT NULL,
	`max_seats` integer,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`user_id` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_user_id_index` ON `plans` (`user_id`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`label` text NOT NULL,
	`start_date` text NOT NULL,
	`active_until` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`user_id` text NOT NULL,
	`master_password` text,
	`master_username` text,
	`owner_id` text,
	`is_autopayable` integer DEFAULT true NOT NULL,
	`default_payment_note` text DEFAULT 'como pago',
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `subscriptions_user_id_index` ON `subscriptions` (`user_id`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`notes` text,
	`created_at` text NOT NULL,
	`user_id` text NOT NULL,
	`daily_penalty` integer,
	`days_overdue` integer DEFAULT 0 NOT NULL,
	`discipline_score` text,
	`health_status` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `clients_user_id_index` ON `clients` (`user_id`);--> statement-breakpoint
CREATE TABLE `client_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`subscription_id` text NOT NULL,
	`custom_price` integer NOT NULL,
	`active_until` text NOT NULL,
	`joined_at` text NOT NULL,
	`left_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`remaining_days` integer,
	`service_password` text,
	`service_user` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `client_subscriptions_client_id_index` ON `client_subscriptions` (`client_id`);--> statement-breakpoint
CREATE INDEX `client_subscriptions_subscription_id_index` ON `client_subscriptions` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `client_subscriptions_status_index` ON `client_subscriptions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `client_subscriptions_client_id_subscription_id_unique` ON `client_subscriptions` (`client_id`,`subscription_id`);--> statement-breakpoint
CREATE TABLE `renewal_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`client_subscription_id` text,
	`amount_paid` integer NOT NULL,
	`expected_amount` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`paid_on` text NOT NULL,
	`due_on` text NOT NULL,
	`months_renewed` integer DEFAULT 1 NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`client_subscription_id`) REFERENCES `client_subscriptions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `renewal_logs_client_subscription_id_index` ON `renewal_logs` (`client_subscription_id`);--> statement-breakpoint
CREATE INDEX `renewal_logs_paid_on_index` ON `renewal_logs` (`paid_on`);--> statement-breakpoint
CREATE TABLE `platform_renewals` (
	`id` text PRIMARY KEY NOT NULL,
	`subscription_id` text NOT NULL,
	`amount_paid` integer NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`paid_on` text NOT NULL,
	`created_at` text NOT NULL,
	`notes` text,
	FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `platform_renewals_subscription_id_index` ON `platform_renewals` (`subscription_id`);--> statement-breakpoint
CREATE INDEX `platform_renewals_paid_on_index` ON `platform_renewals` (`paid_on`);--> statement-breakpoint
CREATE TABLE `mutation_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`target_id` text,
	`action` text NOT NULL,
	`previous_values` text,
	`new_values` text,
	`undone` integer DEFAULT false NOT NULL,
	`undone_at` text,
	`token` text NOT NULL,
	`expires_at` text NOT NULL,
	`executed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mutation_audit_logs_token_unique` ON `mutation_audit_logs` (`token`);--> statement-breakpoint
CREATE INDEX `mutation_audit_logs_user_id_index` ON `mutation_audit_logs` (`user_id`);--> statement-breakpoint
CREATE INDEX `mutation_audit_logs_token_index` ON `mutation_audit_logs` (`token`);