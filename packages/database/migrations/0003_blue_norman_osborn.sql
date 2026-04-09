DROP INDEX "domains_owner_user_id_unique";--> statement-breakpoint
ALTER TABLE "domain_public_keys" ADD COLUMN "key_source" text DEFAULT 'server_generated' NOT NULL;--> statement-breakpoint
ALTER TABLE "domain_public_keys" ADD COLUMN "encrypted_private_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "domains_owner_user_id_unique" ON "domains" USING btree ("owner_user_id") WHERE "domains"."owner_user_id" IS NOT NULL;