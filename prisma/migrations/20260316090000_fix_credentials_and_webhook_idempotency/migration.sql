-- Ensure seat credentials are stored in client_subscriptions (not clients)
ALTER TABLE "client_subscriptions"
  ADD COLUMN IF NOT EXISTS "service_user" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "service_password" VARCHAR(100);

-- Best-effort backfill from legacy clients columns
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'clients' AND column_name = 'service_user'
  ) THEN
    UPDATE "client_subscriptions" cs
    SET
      "service_user" = COALESCE(cs."service_user", c."service_user"),
      "service_password" = COALESCE(cs."service_password", c."service_password")
    FROM "clients" c
    WHERE c."id" = cs."client_id";

    ALTER TABLE "clients" DROP COLUMN IF EXISTS "service_user";
    ALTER TABLE "clients" DROP COLUMN IF EXISTS "service_password";
  END IF;
END $$;

-- Stripe webhook idempotency tracking table
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
  "event_id" TEXT PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "received_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "processed_at" TIMESTAMPTZ NULL,
  "error_message" TEXT NULL
);
