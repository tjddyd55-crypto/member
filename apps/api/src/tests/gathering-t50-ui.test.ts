import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { albumCardDate } from '../../../gathering-mobile/src/features/media/album-date';
import { formatPhone, phoneDigits } from '../../../gathering-mobile/src/utils/phone';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');
describe('t50 compact UX', () => {
  it.each([
    ['01012345678', '010-1234-5678'],
    ['0101234567', '010-123-4567'],
    ['021234567', '02-123-4567'],
    ['0212345678', '02-1234-5678'],
    ['0311234567', '031-123-4567'],
    ['05112345678', '051-1234-5678'],
    ['15881234', '1588-1234'],
    ['010-1234-5678', '010-1234-5678'],
    ['12345', '12345'],
    ['+821012345678', '010-1234-5678'],
    ['', ''],
  ])('phone %s', (value, expected) => expect(formatPhone(value)).toBe(expected));
  it('contact links use digits', () => {
    expect(phoneDigits('010-1234-5678')).toBe('01012345678');
    expect(source('app/(app)/groups/[groupId]/index.tsx')).toContain('phoneDigits(member.phone');
  });
  it('calendar reuses the group timeline with group names and past divider', () => {
    expect(source('app/(app)/calendar.tsx')).toContain('<EventsTimeline />');
    const timeline = source('src/features/schedule/EventsTimeline.tsx');
    for (const text of [
      '지난 일정',
      'item.groupName',
      'eventDateBlock(item.startsAt)',
      'styles.past',
    ])
      expect(timeline).toContain(text);
    expect(timeline).not.toContain('>예정<');
  });
  it('album dates use KST across midnight', () => {
    expect(albumCardDate('2026-11-19T15:00:00Z')).toBe('2026.11.20');
    expect(albumCardDate('2026-11-19T14:59:00Z')).toBe('2026.11.19');
  });
  it('both album cards display dates in the count row', () => {
    const albums = source('src/features/media/AlbumsPane.tsx');
    expect(albums).toContain('{albumCardDate(folder.createdAt)} · 사진');
    expect(albums).toContain('{albumCardDate(event.startsAt)} · 사진');
  });
  it('officers use role rows, reusable picker, confirmation and toast', () => {
    const officers = source('app/(app)/groups/[groupId]/officers.tsx');
    for (const text of [
      'label="임명"',
      'label="인계"',
      '+ 직책 추가',
      'MemberPickerSheet',
      'api.assignOfficer',
      "toast('저장되었습니다')",
      "includes('ROLE_ASSIGN')",
      '역대',
    ])
      expect(officers).toContain(text);
    const picker = source('src/features/group/MemberPickerSheet.tsx');
    for (const text of [
      '<Modal',
      '회원 검색',
      '<CompactMemberRow',
      '임명할까요?',
      'label="취소"',
      'label="임명"',
      'caught.message',
    ])
      expect(picker).toContain(text);
    expect(picker).not.toContain("role: 'PRESIDENT'");
  });
  it('member role chooser is gated and shares confirmation, preserving block', () => {
    const group = source('app/(app)/groups/[groupId]/index.tsx');
    for (const text of [
      'label="직책 지정"',
      '{canAssign ? (',
      "includes('ROLE_ASSIGN')",
      '<RoleChooserSheet',
      '<MemberPickerSheet',
      'label="차단"',
      '<CompactMemberRow',
    ])
      expect(group).toContain(text);
  });
  it('removes helper sentences', () => {
    expect(source('src/features/finance/FinancePanes.tsx')).not.toContain('회비는 행사 장부');
    const officers = source('app/(app)/groups/[groupId]/officers.tsx');
    expect(officers).not.toContain('회원 이름에서 고릅니다');
    expect(officers).not.toContain('역할 변경은 협의회장만');
  });
});
