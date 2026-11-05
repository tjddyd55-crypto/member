import { matchesDeclaredType } from '@member/gathering-domain';
import { AppError } from '../../../lib/errors.js';
import { currentObjectStorage } from './r2.js';

export async function assertStoredObject(input: {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  fail: () => Promise<void>;
}) {
  const storage = currentObjectStorage();
  const head = await storage.head(input.storageKey);
  if (!head) throw new AppError(409, 'OBJECT_MISSING', '업로드된 파일을 찾지 못했습니다.');
  if (head.sizeBytes !== input.sizeBytes) {
    await input.fail();
    throw new AppError(409, 'SIZE_MISMATCH', '저장소의 파일 크기가 일치하지 않습니다.');
  }
  const header = await storage.readPrefix(input.storageKey, 16);
  if (!matchesDeclaredType(input.mimeType, header)) {
    await input.fail();
    throw new AppError(415, 'UNSUPPORTED_TYPE', '파일 내용이 선언한 형식과 다릅니다.');
  }
}
