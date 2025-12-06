import { schema, type IdentikDatabase } from '@identik/database';
import { and, eq, sql } from 'drizzle-orm';

export const REPORT_EVENT_TYPE = 'report_ai';

export interface SignerSignalSnapshot {
  totalSigned: number;
  reportCount: number;
  reportRatio: number;
}

const toNumber = (value: unknown) => Number(value ?? 0);

const countSignedMedia = async (domainId: string, db: IdentikDatabase) => {
  const [aggregate] = await db
    .select({
      total: sql<number>`coalesce(count(*), 0)`
    })
    .from(schema.mediaRecords)
    .where(eq(schema.mediaRecords.domainId, domainId));

  return toNumber(aggregate?.total);
};

const countReports = async (domainId: string, db: IdentikDatabase) => {
  const [aggregate] = await db
    .select({
      total: sql<number>`coalesce(count(*), 0)`
    })
    .from(schema.domainEvents)
    .where(
      and(eq(schema.domainEvents.domainId, domainId), eq(schema.domainEvents.eventType, REPORT_EVENT_TYPE))
    );

  return toNumber(aggregate?.total);
};

export const fetchSignerSignals = async (
  domainId: string,
  db: IdentikDatabase
): Promise<SignerSignalSnapshot> => {
  const [totalSigned, reportCount] = await Promise.all([
    countSignedMedia(domainId, db),
    countReports(domainId, db)
  ]);

  const denominator = Math.max(totalSigned, 1);
  const reportRatio = totalSigned === 0 && reportCount > 0 ? 1 : reportCount / denominator;

  return {
    totalSigned,
    reportCount,
    reportRatio
  };
};
