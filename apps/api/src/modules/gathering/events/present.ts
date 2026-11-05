import type { GatheringAttendance, GatheringEvent, GatheringEventStatus } from '@prisma/client';
import type { GatheringEventView } from '@member/contracts';

type AttendanceRow = { userId: string; status: GatheringAttendance };

export function toEventView(
  event: GatheringEvent & { attendances?: AttendanceRow[] },
  viewerId: string,
  groupName: string,
): GatheringEventView {
  const attendances = event.attendances ?? [];
  const mine = attendances.find((row) => row.userId === viewerId);
  return {
    id: event.id,
    groupId: event.groupId,
    groupName,
    title: event.title,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt?.toISOString() ?? null,
    place: event.place,
    description: event.description,
    status: event.status as GatheringEventStatus,
    myAttendance: mine?.status ?? null,
    counts: {
      attending: attendances.filter((row) => row.status === 'ATTENDING').length,
      declined: attendances.filter((row) => row.status === 'DECLINED').length,
      undecided: attendances.filter((row) => row.status === 'UNDECIDED').length,
    },
  };
}
