import dayjs from 'dayjs';
import { eq, sql } from 'drizzle-orm';
import { createDbClient, schema, type IdentikDatabase } from '@identik/database';

export type ReputationLabel = 'Trusted' | 'Limited history' | 'Warning' | 'Not protected';

export interface ReputationDetails {
  score: number;
  label: ReputationLabel;
  explanation: string;
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));

const scoreToLabel = (score: number, isActive: boolean): ReputationLabel => {
  if (!isActive) return 'Not protected';
  if (score >= 0.75) return 'Trusted';
  if (score >= 0.45) return 'Limited history';
  return 'Warning';
};

const explanationFromSignals = (
  ageDays: number,
  totalWeight: number,
  isActive: boolean
): string => {
  if (!isActive) {
    return 'This Identik Name is not currently active.';
  }

  const parts: string[] = [];

  if (ageDays < 14) {
    parts.push('This Identik Name is new and still building history.');
  } else if (ageDays > 180) {
    parts.push('This Identik Name has been active for quite a while.');
  }

  if (totalWeight > 5) {
    parts.push('Recent photo checks look healthy.');
  } else if (totalWeight < -5) {
    parts.push('We detected several warning events.');
  }

  if (parts.length === 0) {
    parts.push('This Identik Name has a steady reputation so far.');
  }

  return parts.join(' ');
};

const fetchDomainSnapshot = async (
  domainId: string,
  db: IdentikDatabase
) => {
  const domain = await db.query.domains.findFirst({
    where: eq(schema.domains.id, domainId)
  });

  if (!domain) {
    throw new Error('Domain not found');
  }

  const [eventTotals] = await db
    .select({
      totalWeight: sql<number>`coalesce(sum(${schema.domainEvents.weight}), 0)`
    })
    .from(schema.domainEvents)
    .where(eq(schema.domainEvents.domainId, domainId));

  return {
    domain,
    totalWeight: Number(eventTotals?.totalWeight ?? 0)
  };
};

export const calculateDomainReputation = async (
  domainId: string,
  existingDb?: IdentikDatabase
): Promise<ReputationDetails> => {
  const db = existingDb ?? createDbClient();
  const { domain, totalWeight } = await fetchDomainSnapshot(domainId, db);

  const now = dayjs();
  const ageDays = Math.max(now.diff(domain.createdAt ?? now, 'day'), 0);

  const base = 0.4;
  const ageBoost = clamp(ageDays / 180, 0, 1) * 0.25;
  const activityBoost = clamp(totalWeight / 50, -0.4, 0.4);
  const statusPenalty = domain.status === 'active' ? 0 : 0.4;

  const rawScore = base + ageBoost + activityBoost - statusPenalty;
  const score = Number(clamp(Number(rawScore.toFixed(4))));
  const label = scoreToLabel(score, domain.status === 'active');
  const explanation = explanationFromSignals(ageDays, totalWeight, domain.status === 'active');

  return { score, label, explanation };
};

export const updateDomainReputation = async (domainId: string): Promise<ReputationDetails> => {
  const db = createDbClient();
  const details = await calculateDomainReputation(domainId, db);

  await db
    .update(schema.domains)
    .set({ reputationScore: details.score.toString() })
    .where(eq(schema.domains.id, domainId));

  return details;
};

export const __testables = {
  clamp,
  scoreToLabel,
  explanationFromSignals
};

