import type { Prisma } from '@prisma/client';
import { AppError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { assertPermission, requireGroupMember } from '../access.js';
import { assertGatheringWritable } from '../entitlement.js';
import { writeGatheringAudit } from '../audit.js';
import { GatheringAuditAction } from '../constants.js';
import { notifyGatheringEvent } from '../push/service.js';
import { toEventView } from './present.js';

type EventInput = {
  title?: string;
  startsAt?: string;
  endsAt?: string | null;
  place?: string | null;
  description?: string | null;
  status?: 'SCHEDULED' | 'CANCELLED';
};

const eventInclude = { attendances: true, group: { select: { name: true } } } as const;
type EventListOptions = {
  order?: 'asc' | 'desc';
  status?: 'SCHEDULED' | 'CANCELLED';
  cursor?: { startsAt: Date; id: string };
  limit?: number;
};

export async function createGatheringEvent(userId: string, groupId: string, input: EventInput) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'EVENT_MANAGE');
  await assertGatheringWritable(prisma, groupId);
  const startsAt = parseInstant(input.startsAt, '시작 시각이 필요합니다.');
  const endsAt = parseOptionalInstant(input.endsAt);
  assertTimeOrder(startsAt, endsAt);
  const event = await prisma.gatheringEvent.create({
    data: {
      groupId,
      title: input.title ?? '',
      startsAt,
      endsAt,
      place: blankToNull(input.place),
      description: blankToNull(input.description),
      createdByUserId: userId,
    },
    include: eventInclude,
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.EVENT_CREATE,
    targetType: 'GatheringEvent',
    targetId: event.id,
  });
  await notifyGatheringEvent(event, 'EVENT_CREATED', userId);
  return toEventView(event, userId, event.group.name);
}

export async function updateGatheringEvent(
  userId: string,
  groupId: string,
  eventId: string,
  input: EventInput,
) {
  const access = await requireGroupMember(userId, groupId);
  assertPermission(access, 'EVENT_MANAGE');
  await assertGatheringWritable(prisma, groupId);
  const current = await findGroupEvent(groupId, eventId);
  const startsAt = input.startsAt
    ? parseInstant(input.startsAt, '시작 시각이 올바르지 않습니다.')
    : current.startsAt;
  const endsAt = input.endsAt === undefined ? current.endsAt : parseOptionalInstant(input.endsAt);
  assertTimeOrder(startsAt, endsAt);
  const event = await prisma.gatheringEvent.update({
    where: { id: current.id },
    data: {
      title: input.title,
      startsAt,
      endsAt,
      place: input.place === undefined ? undefined : blankToNull(input.place),
      description: input.description === undefined ? undefined : blankToNull(input.description),
      status: input.status,
    },
    include: eventInclude,
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.EVENT_UPDATE,
    targetType: 'GatheringEvent',
    targetId: event.id,
  });
  await notifyGatheringEvent(event, 'EVENT_UPDATED', userId);
  return toEventView(event, userId, event.group.name);
}

export async function listGroupEvents(
  userId: string,
  groupId: string,
  from: Date,
  to: Date,
  options?: EventListOptions,
) {
  await requireGroupMember(userId, groupId, 'read');
  return listScopedEvents(userId, groupId, from, to, options);
}

// Shared range/timeline query: one findMany with all relation data, no per-event reads.
async function listScopedEvents(
  userId: string,
  groupId: string | Prisma.StringFilter,
  from: Date,
  to: Date,
  options?: EventListOptions,
) {
  assertRange(from, to);
  const cursor = options?.cursor;
  const comparison = options?.order === 'desc' ? 'lt' : 'gt';
  const events = await prisma.gatheringEvent.findMany({
    where: {
      groupId,
      deletedAt: null,
      startsAt: { gte: from, lt: to },
      ...(options?.status ? { status: options.status } : {}),
      ...(cursor
        ? {
            OR: [
              { startsAt: { [comparison]: cursor.startsAt } },
              { startsAt: cursor.startsAt, id: { [comparison]: cursor.id } },
            ],
          }
        : {}),
    },
    include: eventInclude,
    orderBy: [{ startsAt: options?.order ?? 'asc' }, { id: options?.order ?? 'asc' }],
    take: options?.limit ?? 200,
  });
  return events.map((event) => toEventView(event, userId, event.group.name));
}

export async function listMyEvents(userId: string, from: Date, to: Date) {
  assertRange(from, to);
  const memberships = await prisma.gatheringMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    select: { groupId: true },
  });
  const groupIds = memberships.map((membership) => membership.groupId);
  if (groupIds.length === 0) return [];
  return listScopedEvents(userId, { in: groupIds }, from, to);
}

export type TimelineDirection = 'upcoming' | 'past';
export async function listEventsTimeline(
  userId: string,
  groupId: string | undefined,
  direction: TimelineDirection,
  encodedCursor?: string,
  limit = 50,
  now = new Date(),
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new AppError(400, 'INVALID_LIMIT', '목록 개수가 올바르지 않습니다.');
  const scope = groupId ?? '*';
  const offset = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + offset);
  let boundary = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - offset,
  );
  let cursor: { startsAt: Date; id: string } | undefined;
  if (encodedCursor) {
    try {
      const row = JSON.parse(Buffer.from(encodedCursor, 'base64url').toString('utf8'));
      if (
        row.scope !== scope ||
        row.direction !== direction ||
        typeof row.id !== 'string' ||
        !row.id ||
        typeof row.startsAt !== 'string' ||
        typeof row.boundary !== 'string'
      )
        throw new Error();
      cursor = { startsAt: new Date(row.startsAt), id: row.id };
      boundary = new Date(row.boundary);
      if (!Number.isFinite(cursor.startsAt.getTime()) || !Number.isFinite(boundary.getTime()))
        throw new Error();
    } catch {
      throw new AppError(400, 'INVALID_CURSOR', '목록 위치가 올바르지 않습니다.');
    }
  }
  const from = direction === 'upcoming' ? boundary : new Date('0001-01-01T00:00:00.000Z');
  const to = direction === 'past' ? boundary : new Date('9999-12-31T23:59:59.999Z');
  const options: EventListOptions = {
    order: direction === 'upcoming' ? 'asc' : 'desc',
    cursor,
    limit: limit + 1,
  };
  let rows;
  if (groupId) rows = await listGroupEvents(userId, groupId, from, to, options);
  else {
    const memberships = await prisma.gatheringMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { groupId: true },
    });
    rows = await listScopedEvents(
      userId,
      { in: memberships.map((row) => row.groupId) },
      from,
      to,
      options,
    );
  }
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              scope,
              direction,
              boundary: boundary.toISOString(),
              startsAt: last.startsAt,
              id: last.id,
            }),
          ).toString('base64url')
        : null,
  };
}

export async function getGatheringEvent(userId: string, groupId: string, eventId: string) {
  await requireGroupMember(userId, groupId, 'read');
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
    include: eventInclude,
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
  return toEventView(event, userId, event.group.name);
}

export async function setEventAttendance(
  userId: string,
  groupId: string,
  eventId: string,
  status: 'ATTENDING' | 'DECLINED' | 'UNDECIDED',
) {
  await requireGroupMember(userId, groupId);
  const event = await findGroupEvent(groupId, eventId);
  if (event.status === 'CANCELLED') {
    throw new AppError(409, 'EVENT_CANCELLED', '취소된 행사의 참석 상태는 바꾸지 않습니다.');
  }
  await prisma.gatheringEventAttendance.upsert({
    where: { eventId_userId: { eventId: event.id, userId } },
    create: { groupId, eventId: event.id, userId, status },
    update: { status },
  });
  await writeGatheringAudit(prisma, {
    groupId,
    actorUserId: userId,
    action: GatheringAuditAction.ATTENDANCE_SET,
    targetType: 'GatheringEvent',
    targetId: event.id,
    meta: { status },
  });
  return getGatheringEvent(userId, groupId, event.id);
}

async function findGroupEvent(groupId: string, eventId: string) {
  const event = await prisma.gatheringEvent.findFirst({
    where: { id: eventId, groupId, deletedAt: null },
  });
  if (!event) throw new AppError(404, 'EVENT_NOT_FOUND', '행사를 찾을 수 없습니다.');
  return event;
}

function parseInstant(value: string | undefined, message: string) {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new AppError(400, 'INVALID_TIME', message);
  return parsed;
}

function parseOptionalInstant(value: string | null | undefined) {
  if (value == null) return null;
  return parseInstant(value, '종료 시각이 올바르지 않습니다.');
}

function assertTimeOrder(startsAt: Date, endsAt: Date | null) {
  if (endsAt && endsAt.getTime() < startsAt.getTime()) {
    throw new AppError(400, 'INVALID_TIME', '종료 시각은 시작 시각 이후여야 합니다.');
  }
}

function assertRange(from: Date, to: Date) {
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.getTime() >= to.getTime()
  ) {
    throw new AppError(400, 'INVALID_RANGE', '일정 범위가 올바르지 않습니다.');
  }
}

function blankToNull(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
