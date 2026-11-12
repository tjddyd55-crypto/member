import { describe, expect, it } from 'vitest';
import { permissionsForRoles, type GatheringRole } from '@member/gathering-domain';
import {
  ATTENDANCE_OPTIONS,
  EVENT_TABS,
  attendanceSummary,
  eventActions,
  eventLocation,
  eventMapQuery,
  eventTabLabelSize,
  financeYearState,
  initialEventTab,
  splitEventLocation,
} from '../../../gathering-mobile/src/features/events/detail';
import { mediaGridLayout } from '../../../gathering-mobile/src/features/media/grid-layout';
import { downloadFileName } from '../../../gathering-mobile/src/features/media/viewer-values';

describe('행사 상세 조회 로직', () => {
  it('탭은 요청된 세 개이며 알 수 없는 링크는 안내 탭을 연다', () => {
    expect(EVENT_TABS.map(([, label]) => label)).toEqual(['안내·참석', '사진·영상', '재무·영수증']);
    expect(initialEventTab('finance')).toBe('finance');
    expect(initialEventTab('media')).toBe('media');
    expect(initialEventTab(['finance'])).toBe('info');
    expect(initialEventTab(undefined)).toBe('info');
    expect(initialEventTab('unknown')).toBe('info');
  });
  it('참석 요약은 0명도 표시하고 서버 상태를 세 버튼에 그대로 쓴다', () => {
    expect(attendanceSummary({ attending: 5, declined: 2, undecided: 3 })).toBe(
      '참석 5 · 불참 2 · 미정 3',
    );
    expect(attendanceSummary({ attending: 0, declined: 0, undecided: 0 })).toBe(
      '참석 0 · 불참 0 · 미정 0',
    );
    expect(ATTENDANCE_OPTIONS.map((item) => item.status)).toEqual([
      'ATTENDING',
      'DECLINED',
      'UNDECIDED',
    ]);
  });
  it.each([
    ['PRESIDENT', true, true, true, true],
    ['SECRETARY', true, false, false, true],
    ['TREASURER', false, true, true, false],
    ['EXECUTIVE', false, false, false, false],
    ['MEMBER', false, false, false, false],
  ] as const)(
    '%s의 버튼은 기존 서버 권한만 사용한다',
    (role, edit, finance, receipt, uploadLink) => {
      expect(eventActions(permissionsForRoles([role as GatheringRole]))).toEqual({
        edit,
        finance,
        receipt,
        uploadLink,
      });
    },
  );
  it('권한이 없으면 모든 관리 버튼을 숨기며 복수 역할은 합산한다', () => {
    expect(Object.values(eventActions([]))).toEqual([false, false, false, false]);
    expect(eventActions(permissionsForRoles(['SECRETARY', 'TREASURER']))).toEqual({
      edit: true,
      finance: true,
      receipt: true,
      uploadLink: true,
    });
  });
  it('회계연도는 행사/결제 날짜의 기간으로 판정하고 미개설은 허용하지 않는다', () => {
    const years = [
      {
        startsAt: '2025-12-23T15:00:00.000Z',
        endsAt: '2026-12-23T14:59:59.999Z',
        status: 'CLOSED',
      },
      { startsAt: '2026-12-23T15:00:00.000Z', endsAt: '2027-12-23T14:59:59.999Z', status: 'OPEN' },
    ];
    expect(financeYearState('2026-06-01T03:00:00.000Z', years)).toBe('CLOSED');
    expect(financeYearState('2026-12-23T14:59:59.999Z', years)).toBe('CLOSED');
    expect(financeYearState('2026-12-24T00:00:00+09:00', years)).toBe('OPEN');
    expect(financeYearState('2028-01-01T00:00:00.000Z', years)).toBe('MISSING');
    expect(financeYearState('invalid', years)).toBe('MISSING');
    expect(financeYearState('2026-06-01T03:00:00.000Z', [])).toBe('MISSING');
  });
  it('기존 장소는 그대로 읽고 장소·주소는 한 필드에 읽을 수 있는 문자열로 보존한다', () => {
    expect(splitEventLocation(null)).toEqual({ place: '', address: '' });
    expect(splitEventLocation('기존 회의실')).toEqual({ place: '기존 회의실', address: '' });
    const value = eventLocation(' 회의실 ', ' 서울시 중구\n3층 ');
    expect(value).toBe('회의실\n서울시 중구\n3층');
    expect(splitEventLocation(value)).toEqual({ place: '회의실', address: '서울시 중구\n3층' });
    expect(eventLocation('', '')).toBe('');
  });
  it('지도는 상세 주소를 우선 사용하며 장소명이나 주소에 줄바꿈을 남기지 않는다', () => {
    expect(eventMapQuery('회의실\n서울시 중구\n3층')).toBe('서울시 중구 3층');
    expect(eventMapQuery(' 회의실 ')).toBe('회의실');
    expect(eventMapQuery('회의실\n  \n')).toBe('회의실');
    expect(eventMapQuery(null)).toBe('');
    expect(eventMapQuery('회의실\r\n서울시 중구\r\n3층')).toBe('서울시 중구 3층');
  });
  it.each([256, 296, 359, 360, 366, 480])(
    '그리드 폭 %ipx에서는 3~4개 셀이 간격까지 들어간다',
    (width) => {
      const { columns, cellSize } = mediaGridLayout(width);
      expect(columns).toBe(width >= 360 ? 4 : 3);
      expect(columns * cellSize + (columns - 1) * 8).toBeLessThanOrEqual(width);
      expect((columns + 1) * cellSize + columns * 8).toBeGreaterThan(width);
    },
  );
  it.each([1, 1.3, 2])(
    '320px 화면의 탭은 글자 배율 %s에서도 자동 축소 없이 폭 안에 들어간다',
    (fontScale) => {
      const tabWidth = (320 - 40 - 4) / 3;
      const size = eventTabLabelSize(280, fontScale);
      expect(size * Math.min(fontScale, 1.3) * 5.5 + 6).toBeLessThanOrEqual(tabWidth);
      expect(size).toBeGreaterThanOrEqual(12);
    },
  );
  it('다운로드 확장자는 실제 MIME을 따르고 파일명 경로 문자를 제거한다', () => {
    expect(downloadFileName('원본.heic', 'image/jpeg', 'PHOTO')).toBe('원본.jpg');
    expect(downloadFileName('영수증.png', 'image/png', 'PHOTO')).toBe('영수증.png');
    expect(downloadFileName('../영상.mov', 'video/quicktime', 'VIDEO')).toBe('.._영상.mov');
    expect(downloadFileName(undefined, undefined, 'VIDEO')).toBe('JCI.mp4');
    expect(downloadFileName('사진', 'image/webp; charset=binary', 'PHOTO')).toBe('사진.webp');
  });
});
