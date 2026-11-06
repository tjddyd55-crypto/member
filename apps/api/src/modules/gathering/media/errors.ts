import type { MediaRejectionCode, UploadDecision } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';

const MEDIA_REJECTION: Record<MediaRejectionCode, { status: number; message: string }> = {
  UNSUPPORTED_TYPE: { status: 400, message: '올릴 수 없는 파일 형식입니다.' },
  FILE_TOO_LARGE: { status: 400, message: '파일 크기 제한을 넘었습니다.' },
  VIDEO_TOO_LONG: { status: 400, message: '영상은 5분까지 올릴 수 있습니다.' },
  DURATION_REQUIRED: { status: 400, message: '영상 길이가 필요합니다.' },
};

export function rejectMedia(code: MediaRejectionCode): never {
  const mapped = MEDIA_REJECTION[code];
  throw new AppError(mapped.status, code, mapped.message);
}

export function rejectUploadDecision(decision: UploadDecision): never {
  if (decision.allowed) {
    throw new AppError(500, 'INTERNAL', '업로드 판정이 올바르지 않습니다.');
  }
  throw new AppError(409, decision.reason, '모임 저장 공간 50GB를 초과해 올릴 수 없습니다.');
}
