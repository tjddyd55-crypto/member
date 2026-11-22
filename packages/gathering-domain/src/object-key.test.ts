import { describe, expect, it } from 'vitest';
import { buildGatheringFinanceReceiptKey, buildGatheringObjectKey, buildMemberBookProfileKey, ObjectKeyError } from './object-key.js';

describe('저장 키', () => {
  it('행사 사진·영상·영수증과 회원수첩 프로필 경로를 나눈다', () => {
    expect(
      buildGatheringObjectKey({
        prefixEnv: 'dev',
        groupId: 'group1',
        eventId: 'event1',
        folder: 'photos',
        objectId: 'file1',
      }),
    ).toBe('dev/gatherings/group1/events/event1/photos/file1');
    expect(
      buildGatheringObjectKey({
        prefixEnv: 'prod',
        groupId: 'group1',
        eventId: 'event1',
        folder: 'videos',
        objectId: 'clip1',
      }),
    ).toBe('prod/gatherings/group1/events/event1/videos/clip1');
    expect(
      buildGatheringObjectKey({
        prefixEnv: 'dev',
        groupId: 'group1',
        eventId: 'event1',
        folder: 'receipts',
        objectId: 'receipt1',
      }),
    ).toBe('dev/gatherings/group1/events/event1/receipts/receipt1');
    expect(buildMemberBookProfileKey({ prefixEnv: 'dev', userId: 'user1', objectId: 'face1' })).toBe(
      'dev/member-book/profiles/user1/face1',
    );
  });

  it('접두사나 식별자에 경로 이탈이 있으면 거절한다', () => {
    expect(() =>
      buildGatheringObjectKey({
        prefixEnv: '../prod',
        groupId: 'group1',
        eventId: 'event1',
        folder: 'photos',
        objectId: 'file1',
      }),
    ).toThrow(ObjectKeyError);
    expect(() =>
      buildGatheringObjectKey({
        prefixEnv: 'dev',
        groupId: 'group/1',
        eventId: 'event1',
        folder: 'photos',
        objectId: 'file1',
      }),
    ).toThrow(ObjectKeyError);
  });
});

describe('회계연도 영수증 저장 경로', () => {
  const parts = { prefixEnv: 'dev', groupId: 'group-1', financeYearId: 'year_2', objectId: 'file-3' };
  it('모임과 회계연도로 일반 영수증을 구분한다', () => {
    expect(buildGatheringFinanceReceiptKey(parts)).toBe('dev/gatherings/group-1/finance/year_2/receipts/file-3');
  });
  it('경로 구분자가 들어간 회계연도 ID를 거부한다', () => {
    expect(() => buildGatheringFinanceReceiptKey({ ...parts, financeYearId: '../year' })).toThrow(ObjectKeyError);
  });
});
