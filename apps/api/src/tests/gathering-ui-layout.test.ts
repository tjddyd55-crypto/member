import { describe, expect, it } from 'vitest';
import {
  compactHeaderTitle,
  visibleGroupName,
  GATHERING_TABS,
  gatheringSwitchItems,
  GLOBAL_MENU_ROUTES,
  globalMenuNavigation,
  hardwareBackDestination,
  rootResetTarget,
  routeHeaderTitle,
} from '../../../gathering-mobile/src/features/group/app-menu';
import { tabIconSize, tabLabelSize, tabSlotWidth } from '../../../gathering-mobile/src/features/group/tab-layout';
import { uploadAlbumFiles } from '../../../gathering-mobile/src/features/media/album-upload';
import { chunkForReserve, handoverInProgress, uploadBlockReason } from '../../../gathering-mobile/src/features/media/upload-block';

describe('모임 화면 배치', () => {
  it('Android 뒤로 가기는 메뉴로 연 화면에서도 상위 화면으로 돌아가고 기존 상세 이력은 유지한다', () => {
    expect(hardwareBackDestination('/groups/group-1', false)).toBe('/(app)/groups');
    expect(hardwareBackDestination('/groups/group-1', true)).toBe('/(app)/groups');
    expect(hardwareBackDestination('/groups/group-1/settings', false)).toBe('/(app)/groups/group-1');
    expect(hardwareBackDestination('/groups/group-1/manage', false)).toBe('/(app)/groups/group-1');
    expect(hardwareBackDestination('/groups/group-1/events/event-1', true)).toBeNull();
    expect(hardwareBackDestination('/profile', false)).toBe('/(app)/groups');
    expect(hardwareBackDestination('/calendar', false)).toBe('/(app)/groups');
    expect(hardwareBackDestination('/groups/create', false)).toBe('/(app)/groups');
    expect(hardwareBackDestination('/account-delete', false)).toBe('/(app)/profile');
    expect(hardwareBackDestination('/groups', false)).toBeNull();
  });
  it('320dp와 360dp에서 여섯 탭이 한 칸씩 들어간다', () => {
    expect(tabSlotWidth(320)).toBeCloseTo(296 / 6);
    expect(tabSlotWidth(360)).toBeCloseTo(336 / 6);
    expect(tabSlotWidth(412)).toBeGreaterThan(60);
    expect(tabLabelSize(320)).toBeLessThanOrEqual(tabLabelSize(412));
    expect(tabIconSize(320)).toBeLessThanOrEqual(tabIconSize(412));
  });

  it('모임 안 제목은 헤더에 바로 보이고 전역 메뉴는 모임 목록으로 간다', () => {
    expect(GATHERING_TABS).toEqual(['홈', '회원', '일정', '사진', '자료실', '회계']);
    expect(compactHeaderTitle({ groupName: '2023년 한국JC 위원장 협의회', routeTitle: '내 모임' })).toBe(
      '2023년 한국JC 위원장 협의회',
    );
    expect(routeHeaderTitle('/groups/group-1')).toBe('모임');
    expect(routeHeaderTitle('/groups/create')).toBe('모임 만들기');
    expect(routeHeaderTitle('/groups')).toBe('내 모임');
    expect(globalMenuNavigation()).toBe('reset');
    const root = { key: 'root-stack', routeNames: ['(app)', '(auth)', 'index'] };
    expect(
      rootResetTarget(root, {
        routes: [{ name: '(app)' }],
      }),
    ).toBe('root-stack');
    expect(rootResetTarget(root, { routes: [{ name: 'groups/index' }] })).toBeNull();
    expect(rootResetTarget({ routeNames: ['(app)'] }, { routes: [{ name: '(app)' }] })).toBeNull();
    expect(
      rootResetTarget(root, {
        stale: false,
        routeNames: ['(app)'],
        routes: [{ name: '(app)' }],
      }),
    ).toBeNull();
    expect(GLOBAL_MENU_ROUTES.map((item) => item.label)).toEqual(['내 모임', '전체 일정', '내 정보 및 설정']);
    expect(GLOBAL_MENU_ROUTES.some((item) => item.label === '홈')).toBe(false);
    const items = gatheringSwitchItems(
      [
        { id: 'a', name: '2023년 한국JC 위원장 협의회', membershipStatus: 'ACTIVE' },
        { id: 'b', name: '다른 모임', membershipStatus: 'PENDING' },
      ],
      'a',
    );
    expect(items).toEqual([
      { id: 'a', label: '2023년 한국JC 위원장 협의회', href: '/(app)/groups/a', selected: true },
    ]);
    expect(visibleGroupName({ id: 'a', name: '가 모임' }, 'a')).toBe('가 모임');
    expect(visibleGroupName({ id: 'a', name: '가 모임' }, 'b')).toBeNull();
    const many = gatheringSwitchItems(
      Array.from({ length: 30 }, (_, index) => ({
        id: String(index),
        name: `모임 ${index}`,
        membershipStatus: 'ACTIVE' as const,
      })),
    );
    expect(many).toHaveLength(30);
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
    expect(uploadBlockReason({ destinationCount: 1, destinationChosen: true })).toBeNull();
    expect(uploadBlockReason({ writesAllowed: false })).toContain('올릴 수 없습니다');
    expect(uploadBlockReason({ destinationCount: 0, destinationChosen: false })).toBe('업로드 대상 없음');
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
