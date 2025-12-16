CREATE UNIQUE INDEX IF NOT EXISTS "domains_owner_user_id_unique"
ON "domains" ("owner_user_id")
WHERE "owner_user_id" IS NOT NULL;
