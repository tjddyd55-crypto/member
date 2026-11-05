import { describe, expect, it } from 'vitest';
import { tabIconSize, tabLabelSize, tabSlotWidth } from '../../../gathering-mobile/src/features/group/tab-layout';
import { SUBSCRIPTION_RETRY_HINT, subscriptionUploadState, uploadAlbumFiles } from '../../../gathering-mobile/src/features/media/album-upload';
import { chunkForReserve, handoverInProgress, uploadBlockReason } from '../../../gathering-mobile/src/features/media/upload-block';

describe('모임 화면 배치', () => {
  it('320dp와 360dp에서 다섯 탭이 한 칸씩 들어간다', () => {
    expect(tabSlotWidth(320)).toBeCloseTo(56);
    expect(tabSlotWidth(360)).toBeCloseTo(64);
    expect(tabSlotWidth(412)).toBeGreaterThan(70);
    expect(tabLabelSize(320)).toBeLessThanOrEqual(tabLabelSize(412));
    expect(tabIconSize(320)).toBeLessThanOrEqual(tabIconSize(412));
  });

  it('앨범 업로드 예약은 한 요청에 20장을 넘기지 않는다', () => {
    const files = Array.from({ length: 21 }, (_, index) => index);
    expect(chunkForReserve(files).map((chunk) => chunk.length)).toEqual([20, 1]);
    expect(chunkForReserve(files.slice(0, 20))).toHaveLength(1);
    expect(chunkForReserve([])).toEqual([]);
  });

  it('인계 중이면 사진 탭 이유가 인계라고 말한다', () => {
    expect(handoverInProgress('CONFIRMED')).toBe(true);
    expect(handoverInProgress('FINALIZED')).toBe(false);
    expect(uploadBlockReason({ uploadsAllowed: true, destinationCount: 1, destinationChosen: true })).toBeNull();
    expect(uploadBlockReason({ uploadsAllowed: false, destinationCount: 1, destinationChosen: true })).toContain(
      '이용 기간',
    );
    expect(uploadBlockReason({ uploadsAllowed: true, destinationCount: 0, destinationChosen: false })).toContain(
      '행사나 폴더',
    );
  });

  it('이용 상태 조회 실패는 이용 종료로 보지 않는다', () => {
    expect(subscriptionUploadState(null)).toBe('unknown');
    expect(subscriptionUploadState(undefined)).toBe('unknown');
    expect(subscriptionUploadState(true)).toBe('allowed');
    expect(subscriptionUploadState(false)).toBe('inactive');
    expect(SUBSCRIPTION_RETRY_HINT).toContain('다시 확인');
    const knownInactive = subscriptionUploadState(false) === 'inactive';
    const unknown = subscriptionUploadState(null) === 'inactive';
    expect(
      uploadBlockReason({ uploadsAllowed: !unknown, destinationCount: 1, destinationChosen: true }),
    ).toBeNull();
    expect(
      uploadBlockReason({ uploadsAllowed: !knownInactive, destinationCount: 1, destinationChosen: true }),
    ).toContain('이용 기간');
  });

  it('한 파일 실패 뒤 재시도는 같은 예약을 다시 쓰지 새 예약을 만들지 않는다', async () => {
    const reserved: string[][] = [];
    const sent: string[] = [];
    const files = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    const first = await uploadAlbumFiles({
      files,
      reserve: async (batch) => {
        reserved.push(batch.map((file) => file.key));
        return batch.map((file) => ({ key: file.key, assetId: `id-${file.key}` }));
      },
      send: async (file) => {
        sent.push(file.key);
        if (file.key === 'b') throw new Error('전송 실패');
      },
    });
    expect(reserved).toEqual([['a', 'b', 'c']]);
    expect(sent).toEqual(['a', 'b', 'c']);
    expect(first.find((item) => item.key === 'a')).toMatchObject({ ok: true, assetId: 'id-a' });
    expect(first.find((item) => item.key === 'b')).toMatchObject({ ok: false, assetId: 'id-b' });
    expect(first.find((item) => item.key === 'c')).toMatchObject({ ok: true, assetId: 'id-c' });

    const retry = await uploadAlbumFiles({
      files: [{ key: 'b', assetId: 'id-b' }],
      reserve: async () => {
        throw new Error('예약이 다시 호출되면 안 됩니다.');
      },
      send: async (file) => {
        sent.push(file.assetId);
      },
    });
    expect(retry).toEqual([{ key: 'b', assetId: 'id-b', ok: true }]);
    expect(sent).toContain('id-b');
  });

  it('예약이 실패한 묶음 다음 파일도 이어서 올린다', async () => {
    const files = Array.from({ length: 21 }, (_, index) => ({ key: String(index) }));
    const sent: string[] = [];
    const outcomes = await uploadAlbumFiles({
      files,
      reserve: async (batch) => {
        if (batch[0]?.key === '0') throw new Error('첫 묶음 실패');
        return batch.map((file) => ({ key: file.key, assetId: file.key }));
      },
      send: async (file) => {
        sent.push(file.key);
      },
    });
    expect(sent).toEqual(['20']);
    expect(outcomes.filter((item) => !item.ok)).toHaveLength(20);
    expect(outcomes.find((item) => item.key === '20')?.ok).toBe(true);
  });
});
