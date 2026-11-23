import { normalizeJcName } from '@member/gathering-domain';
import type { JcOrgType, Prisma } from '@prisma/client';

export const confirmedActive = { isActive: true, verificationState: 'CONFIRMED' } as const;

export const aliasSelect = { select: { alias: true, normalized: true } } as const;

export const districtRefSelect = { id: true, name: true, displayName: true } as const;

export const affiliationLocalSelect = {
  ...districtRefSelect,
  isActive: true,
  verificationState: true,
  district: { select: districtRefSelect },
} as const satisfies Prisma.LocalSelect;

type NamedOrg = {
  name: string;
  displayName: string | null;
  jcAliases: { normalized: string }[];
};

export function orgNames(org: NamedOrg, type: JcOrgType = 'LOCAL') {
  return new Set(
    [
      normalizeJcName(org.name, type),
      normalizeJcName(org.displayName ?? '', type),
      ...org.jcAliases.map(({ normalized }) => normalized),
    ].filter(Boolean),
  );
}

export function displayName(org: { name: string; displayName: string | null }) {
  return org.displayName ?? org.name;
}

export function orgChoice(org: { id: string; name: string; displayName: string | null }) {
  return { id: org.id, name: org.name, displayName: displayName(org) };
}

export function districtRef(org: { id: string; name: string; displayName: string | null }) {
  return { id: org.id, displayName: displayName(org) };
}

export async function localDirectory(
  db: Prisma.TransactionClient,
  where: Prisma.LocalWhereInput = {},
) {
  return db.local.findMany({
    where,
    select: {
      ...affiliationLocalSelect,
      jcAliases: aliasSelect,
    },
  });
}

type MatchableLocal = Awaited<ReturnType<typeof localDirectory>>[number];

export async function localMatchIndex(db: Prisma.TransactionClient) {
  const index = new Map<string, Set<MatchableLocal>>();
  for (const local of await localDirectory(db, confirmedActive)) {
    for (const name of orgNames(local)) {
      const matches = index.get(name) ?? new Set<MatchableLocal>();
      matches.add(local);
      index.set(name, matches);
    }
  }
  return index;
}

export function classifyLocal(name: string, index: Awaited<ReturnType<typeof localMatchIndex>>) {
  const matches = index.get(normalizeJcName(name));
  if (!matches?.size) return { outcome: 'unmatched', local: null } as const;
  if (matches.size > 1) return { outcome: 'ambiguous', local: null } as const;
  return { outcome: 'matched', local: [...matches][0]! } as const;
}

export async function matchLocal(db: Prisma.TransactionClient, name: string) {
  return classifyLocal(name, await localMatchIndex(db)).local;
}

export async function searchLocals(db: Prisma.TransactionClient, q?: string, districtId?: string) {
  const query = normalizeJcName(q ?? '');
  const locals = await localDirectory(db, { ...confirmedActive, districtId });
  return locals
    .filter((org) => !query || [...orgNames(org)].some((name) => name.includes(query)))
    .sort((a, b) => displayName(a).localeCompare(displayName(b), 'ko') || a.id.localeCompare(b.id));
}
