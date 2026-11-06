import { chunkForReserve } from './upload-block';

export type AlbumReserve = {
  key: string;
  assetId: string;
  uploadUrl?: string;
  headers?: Record<string, string>;
  expiresAt?: string;
};

export type AlbumUploadOutcome = {
  key: string;
  assetId?: string;
  ok: boolean;
  message?: string;
};

type AlbumFile = {
  key: string;
  assetId?: string;
};

/**
 * 파일마다 전송을 격리한다. 이미 예약된 파일은 다시 만들지 않고, 한 건이 실패해도 나머지는 이어 간다.
 */
export async function uploadAlbumFiles<T extends AlbumFile>(input: {
  files: readonly T[];
  reserve: (batch: readonly T[]) => Promise<readonly AlbumReserve[]>;
  send: (
    file: T & { assetId: string; uploadUrl?: string; headers?: Record<string, string>; expiresAt?: string },
  ) => Promise<void>;
}): Promise<AlbumUploadOutcome[]> {
  const failedReserve = new Map<string, string>();
  const reserved = new Map<string, AlbumReserve>();
  for (const batch of chunkForReserve(input.files.filter((file) => !file.assetId))) {
    try {
      const created = await input.reserve(batch);
      const byKey = new Map(created.map((item) => [item.key, item]));
      for (const file of batch) {
        const item = byKey.get(file.key);
        if (!item?.assetId) failedReserve.set(file.key, '업로드 주소를 받지 못했습니다.');
        else reserved.set(file.key, item);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '예약을 만들지 못했습니다.';
      for (const file of batch) failedReserve.set(file.key, message);
    }
  }

  const outcomes: AlbumUploadOutcome[] = [];
  for (const file of input.files) {
    const reserveError = failedReserve.get(file.key);
    if (reserveError) {
      outcomes.push({ key: file.key, ok: false, message: reserveError });
      continue;
    }
    const extra = reserved.get(file.key);
    const assetId = file.assetId ?? extra?.assetId;
    if (!assetId) {
      outcomes.push({ key: file.key, ok: false, message: '업로드 주소를 받지 못했습니다.' });
      continue;
    }
    try {
      await input.send({
        ...file,
        assetId,
        uploadUrl: extra?.uploadUrl,
        headers: extra?.headers,
        expiresAt: extra?.expiresAt,
      });
      outcomes.push({ key: file.key, assetId, ok: true });
    } catch (error) {
      outcomes.push({
        key: file.key,
        assetId,
        ok: false,
        message: error instanceof Error ? error.message : '올리지 못했습니다.',
      });
    }
  }
  return outcomes;
}
