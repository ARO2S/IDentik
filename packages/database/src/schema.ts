import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull().unique(),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    reputationScore: numeric('reputation_score').default(sql`0.5`),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
  },
  (table) => ({
    ownerUnique: uniqueIndex('domains_owner_user_id_unique')
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} IS NOT NULL`)
  })
);

export const domainPublicKeys = pgTable('domain_public_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  keyType: text('key_type').notNull(),
  publicKey: text('public_key').notNull(),
  keyFingerprint: text('key_fingerprint').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  revoked: boolean('revoked').default(false),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
});

export const mediaRecords = pgTable('media_records', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  fileSha256: text('file_sha256').notNull(),
  fingerprint: text('fingerprint').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`)
});

export const signatures = pgTable('signatures', {
  id: uuid('id').defaultRandom().primaryKey(),
  mediaId: uuid('media_id').references(() => mediaRecords.id),
  domainPublicKeyId: uuid('domain_public_key_id').references(() => domainPublicKeys.id),
  signature: text('signature').notNull(),
  algorithm: text('algorithm').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const verificationLogs = pgTable('verification_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  mediaId: uuid('media_id').references(() => mediaRecords.id),
  verified: boolean('verified'),
  score: numeric('score'),
  report: jsonb('report').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const domainEvents = pgTable('domain_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  domainId: uuid('domain_id').references(() => domains.id),
  eventType: text('event_type').notNull(),
  weight: numeric('weight').default(sql`0`),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
});

export const usersRelations = relations(users, ({ many }) => ({
  domains: many(domains)
}));

export const domainsRelations = relations(domains, ({ many, one }) => ({
  owner: one(users, {
    fields: [domains.ownerUserId],
    references: [users.id]
  }),
  publicKeys: many(domainPublicKeys),
  media: many(mediaRecords),
  events: many(domainEvents)
}));

export const domainPublicKeysRelations = relations(domainPublicKeys, ({ one, many }) => ({
  domain: one(domains, {
    fields: [domainPublicKeys.domainId],
    references: [domains.id]
  }),
  signatures: many(signatures)
}));

export const mediaRecordsRelations = relations(mediaRecords, ({ one, many }) => ({
  domain: one(domains, {
    fields: [mediaRecords.domainId],
    references: [domains.id]
  }),
  signatures: many(signatures),
  verificationLogs: many(verificationLogs)
}));

export const signaturesRelations = relations(signatures, ({ one }) => ({
  media: one(mediaRecords, {
    fields: [signatures.mediaId],
    references: [mediaRecords.id]
  }),
  domainPublicKey: one(domainPublicKeys, {
    fields: [signatures.domainPublicKeyId],
    references: [domainPublicKeys.id]
  })
}));

export const verificationLogsRelations = relations(verificationLogs, ({ one }) => ({
  media: one(mediaRecords, {
    fields: [verificationLogs.mediaId],
    references: [mediaRecords.id]
  })
}));

export const domainEventsRelations = relations(domainEvents, ({ one }) => ({
  domain: one(domains, {
    fields: [domainEvents.domainId],
    references: [domains.id]
  })
}));

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Domain = typeof domains.$inferSelect;
export type InsertDomain = typeof domains.$inferInsert;
export type DomainPublicKey = typeof domainPublicKeys.$inferSelect;
export type MediaRecord = typeof mediaRecords.$inferSelect;
export type Signature = typeof signatures.$inferSelect;
export type VerificationLog = typeof verificationLogs.$inferSelect;
export type DomainEvent = typeof domainEvents.$inferSelect;
