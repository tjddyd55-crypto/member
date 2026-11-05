const PREFIX_ENV = /^[a-z0-9](?:[a-z0-9-]{0,31})$/;
const ID_PART = /^[A-Za-z0-9_-]{1,80}$/;

export type GatheringObjectFolder = 'photos' | 'videos' | 'receipts';

export class ObjectKeyError extends Error {
  constructor() {
    super('INVALID_STORAGE_KEY');
    this.name = 'ObjectKeyError';
  }
}

function requirePart(value: string) {
  if (!ID_PART.test(value)) throw new ObjectKeyError();
}

function requirePrefix(prefixEnv: string) {
  if (!PREFIX_ENV.test(prefixEnv)) throw new ObjectKeyError();
}

/**
 * dev/prod 는 prefixEnv 로 갈라진다. 버킷이 같아도 키가 겹치지 않는다.
 * 회원수첩 프로필 경로는 자리만 예약한다. 회원수첩 업로드 API는 만들지 않는다.
 */
export function buildGatheringObjectKey(input: {
  prefixEnv: string;
  groupId: string;
  eventId: string;
  folder: GatheringObjectFolder;
  objectId: string;
}) {
  requirePrefix(input.prefixEnv);
  requirePart(input.groupId);
  requirePart(input.eventId);
  requirePart(input.objectId);
  return `${input.prefixEnv}/gatherings/${input.groupId}/events/${input.eventId}/${input.folder}/${input.objectId}`;
}

export function buildGatheringFolderObjectKey(input: {
  prefixEnv: string;
  groupId: string;
  folderId: string;
  folder: GatheringObjectFolder;
  objectId: string;
}) {
  requirePrefix(input.prefixEnv);
  requirePart(input.groupId);
  requirePart(input.folderId);
  requirePart(input.objectId);
  return `${input.prefixEnv}/gatherings/${input.groupId}/folders/${input.folderId}/${input.folder}/${input.objectId}`;
}

export function buildMemberBookProfileKey(input: {
  prefixEnv: string;
  userId: string;
  objectId: string;
}) {
  requirePrefix(input.prefixEnv);
  requirePart(input.userId);
  requirePart(input.objectId);
  return `${input.prefixEnv}/member-book/profiles/${input.userId}/${input.objectId}`;
}
