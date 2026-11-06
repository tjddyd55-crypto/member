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
  const startsAt = input.startsAt ? parseInstant(input.startsAt, '시작 시각이 올바르지 않습니다.') : current.startsAt;
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
  options?: { order?: 'asc' | 'desc'; status?: 'SCHEDULED' | 'CANCELLED' },
) {
  await requireGroupMember(userId, groupId, 'read');
  assertRange(from, to);
  const events = await prisma.gatheringEvent.findMany({
    where: {
      groupId,
      deletedAt: null,
      startsAt: { gte: from, lt: to },
      ...(options?.status ? { status: options.status } : {}),
    },
    include: eventInclude,
    orderBy: { startsAt: options?.order ?? 'asc' },
    take: 200,
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
  const events = await prisma.gatheringEvent.findMany({
    where: { groupId: { in: groupIds }, deletedAt: null, startsAt: { gte: from, lt: to } },
    include: eventInclude,
    orderBy: { startsAt: 'asc' },
    take: 200,
  });
  return events.map((event) => toEventView(event, userId, event.group.name));
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
  const event = await prisma.gatheringEvent.findFirst({ where: { id: eventId, groupId, deletedAt: null } });
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
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from.getTime() >= to.getTime()) {
    throw new AppError(400, 'INVALID_RANGE', '일정 범위가 올바르지 않습니다.');
  }
}

function blankToNull(value: string | null | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
