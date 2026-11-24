import { describe, expect, it } from 'vitest';
import { permissionsForRoles, type GatheringRole } from '@member/gathering-domain';
import {
  ATTENDANCE_OPTIONS,
  EVENT_TABS,
  attendanceSummary,
  eventActions,
  eventCopyAddress,
  eventFinanceActions,
  eventLocation,
  eventMapQuery,
  eventMapUrls,
  eventTabLabelSize,
  financeYearState,
  initialEventTab,
  parseEventAddress,
  splitEventLocation,
  stripPostcode,
} from '../../../gathering-mobile/src/features/events/detail';
import { mediaGridLayout } from '../../../gathering-mobile/src/features/media/grid-layout';
import { downloadFileName } from '../../../gathering-mobile/src/features/media/viewer-values';

describe('행사 상세 조회 로직', () => {
  it('탭은 요청된 세 개이며 알 수 없는 링크는 안내 탭을 연다', () => {
    expect(EVENT_TABS.map(([, label]) => label)).toEqual(['안내', '갤러리', '회계']);
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
  it('마감된 행사는 열린 결제 연도에 거래를 추가할 수 있고 영수증은 첨부할 수 없다', () => {
    const years = [
      {
        startsAt: '2025-12-23T15:00:00.000Z',
        endsAt: '2026-12-23T14:59:59.999Z',
        status: 'CLOSED',
      },
      { startsAt: '2026-12-23T15:00:00.000Z', endsAt: '2027-12-23T14:59:59.999Z', status: 'OPEN' },
    ];
    const startsAt = '2026-06-01T03:00:00.000Z';
    expect(eventFinanceActions(true, true, startsAt, years)).toEqual({
      addTransaction: true,
      attachReceipt: false,
    });
    expect(financeYearState('2026-12-24T03:00:00.000Z', years)).toBe('OPEN');
    // The modal must still reject closed or missing payment years before sending.
    expect(financeYearState(startsAt, years)).toBe('CLOSED');
    expect(financeYearState('2028-01-01T03:00:00.000Z', years)).toBe('MISSING');
    expect(eventFinanceActions(true, true, '2024-06-01T03:00:00.000Z', years)).toEqual({
      addTransaction: true,
      attachReceipt: false,
    });
    expect(eventFinanceActions(true, true, startsAt, years.slice(0, 1)).addTransaction).toBe(false);
    expect(eventFinanceActions(true, true, startsAt, []).addTransaction).toBe(false);
  });
  it.each(['PRESIDENT', 'SECRETARY', 'TREASURER', 'EXECUTIVE', 'MEMBER'] as const)(
    '%s의 거래·영수증 입력은 열린 연도에서도 기존 권한으로 제한한다',
    (role) => {
      const permissions = eventActions(permissionsForRoles([role]));
      const years = [
        {
          startsAt: '2026-12-23T15:00:00.000Z',
          endsAt: '2027-12-23T14:59:59.999Z',
          status: 'OPEN',
        },
      ];
      expect(
        eventFinanceActions(
          permissions.finance,
          permissions.receipt,
          '2027-01-01T03:00:00.000Z',
          years,
        ),
      ).toEqual({
        addTransaction: role === 'PRESIDENT' || role === 'TREASURER',
        attachReceipt: role === 'PRESIDENT' || role === 'TREASURER',
      });
    },
  );
  it('기존 장소는 그대로 읽고 장소·주소는 한 필드에 읽을 수 있는 문자열로 보존한다', () => {
    expect(splitEventLocation(null)).toEqual({ place: '', address: '' });
    expect(splitEventLocation('기존 회의실')).toEqual({ place: '기존 회의실', address: '' });
    const value = eventLocation(' 회의실 ', ' 서울시 중구\n3층 ');
    expect(value).toBe('회의실\n서울시 중구\n3층');
    expect(splitEventLocation(value)).toEqual({ place: '회의실', address: '서울시 중구\n3층' });
    expect(eventLocation('', '')).toBe('');
  });
  it('주소 번호가 없는 기존 값은 장소명 뒤의 텍스트를 지도 검색에 사용한다', () => {
    expect(eventMapQuery('회의실\n서울시 중구\n3층')).toBe('서울시 중구 3층');
    expect(eventMapQuery(' 회의실 ')).toBe('회의실');
    expect(eventMapQuery('회의실\n  \n')).toBe('회의실');
    expect(eventMapQuery(null)).toBe('');
    expect(eventMapQuery('회의실\r\n서울시 중구\r\n3층')).toBe('서울시 중구 3층');
  });
  it.each([
    [
      '(23211) 인천 영종구 흰바위로59번길 8 골든튀립인천공항호텔&스위트',
      '',
      '인천 영종구 흰바위로59번길 8',
      '골든튀립인천공항호텔&스위트',
    ],
    [
      '골든튤립 호텔\n(23211) 인천 영종구 흰바위로59번길 8 3층 연회장',
      '골든튤립 호텔',
      '인천 영종구 흰바위로59번길 8',
      '3층 연회장',
    ],
    ['인천 영종구 흰바위로59번길 8', '', '인천 영종구 흰바위로59번길 8', ''],
    ['회의실\n서울 중구 세종대로 110\n3층', '회의실', '서울 중구 세종대로 110', '3층'],
    ['(06236) 서울 강남구 역삼동 823-1 2층', '', '서울 강남구 역삼동 823-1', '2층'],
    ['경기 성남시 분당구 판교역로 235-1 A동', '', '경기 성남시 분당구 판교역로 235-1', 'A동'],
    [
      '호텔\n별관\n[23211] 인천 영종구 흰바위로59번길 8 (운서동, 호텔)\n3층',
      '호텔 별관',
      '인천 영종구 흰바위로59번길 8',
      '(운서동, 호텔) 3층',
    ],
    [
      '인천 영종구 흰바위로59번길 8(운서동) 3층',
      '',
      '인천 영종구 흰바위로59번길 8',
      '(운서동) 3층',
    ],
    [
      '행사장\n(04524) 서울 중구 세종대로 110 (3층 연회장)',
      '행사장',
      '서울 중구 세종대로 110',
      '(3층 연회장)',
    ],
    [
      '인천 영종구 운서동 123 흰바위로59번길 8, 3층',
      '',
      '인천 영종구 운서동 123 흰바위로59번길 8',
      '3층',
    ],
    ['기존 회의실', '기존 회의실', '', ''],
    ['회의실\n(23211) 인천 영종구\n3층', '회의실', '', '인천 영종구 3층'],
    [null, '', '', ''],
  ])(
    '행사 장소 %s에서 지도 검색과 복사에 사용할 주소를 구분한다',
    (value, placeName, road, detail) => {
      const full = [road, detail].filter(Boolean).join(' ');
      expect(parseEventAddress(value)).toEqual({ placeName, road, detail, full });
      expect(eventMapQuery(value)).toBe(road || full || placeName);
      expect(eventCopyAddress(value)).toBe(full || placeName);
    },
  );
  it('앞에 붙은 우편번호만 제거하고 지도 검색의 공백을 정리한다', () => {
    expect(stripPostcode('  (23211) 인천 ')).toBe('인천');
    expect(stripPostcode('[23211] 인천')).toBe('인천');
    expect(stripPostcode('23211 인천')).toBe('인천');
    expect(stripPostcode('23211 ')).toBe('');
    expect(stripPostcode('호텔 (23211)')).toBe('호텔 (23211)');
    expect(eventMapQuery('23211  인천   영종구')).toBe('인천 영종구');
    expect(eventCopyAddress('(23211)')).toBe('');
  });
  it('상세 주소의 동·호수 숫자나 카카오 괄호 표기는 도로명 검색어에 넣지 않는다', () => {
    expect(eventMapQuery('(13529) 경기 성남시 분당구 분당내곡로 117 1동 302호')).toBe(
      '경기 성남시 분당구 분당내곡로 117',
    );
    expect(eventMapQuery('(13529) 경기 성남시 분당구 분당내곡로 117 1동 302')).toBe(
      '경기 성남시 분당구 분당내곡로 117',
    );
    expect(eventMapQuery('(22382) 인천 영종구 공항로 272 (운서동)')).toBe('인천 영종구 공항로 272');
    expect(eventCopyAddress('(13529) 경기 성남시 분당구 분당내곡로 117 1동 302')).toBe(
      '경기 성남시 분당구 분당내곡로 117 1동 302',
    );
  });

  it('네이버 지도 앱과 웹 검색 URL에 검색어를 인코딩한다', () => {
    expect(eventMapUrls('인천 호텔&스위트')).toEqual([
      'nmap://search?query=%EC%9D%B8%EC%B2%9C%20%ED%98%B8%ED%85%94%26%EC%8A%A4%EC%9C%84%ED%8A%B8&appname=kr.jcikorea.app',
      'https://map.naver.com/p/search/%EC%9D%B8%EC%B2%9C%20%ED%98%B8%ED%85%94%26%EC%8A%A4%EC%9C%84%ED%8A%B8',
    ]);
  });
  it.each([256, 296, 359, 360, 390, 430, 600, 768])(
    '그리드 폭 %ipx에서는 3개 이상의 셀이 간격까지 들어간다',
    (width) => {
      const { columns, cellSize } = mediaGridLayout(width);
      expect(columns).toBe(Math.max(3, Math.floor(width / 130)));
      expect(columns * cellSize + (columns - 1) * 3).toBeLessThanOrEqual(width);
      expect((columns + 1) * cellSize + columns * 3).toBeGreaterThan(width);
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
