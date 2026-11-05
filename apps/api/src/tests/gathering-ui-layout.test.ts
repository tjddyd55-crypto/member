import { describe, expect, it } from 'vitest';
import { tabIconSize, tabLabelSize, tabSlotWidth } from '../../../gathering-mobile/src/features/group/tab-layout';
import { handoverInProgress, uploadBlockReason } from '../../../gathering-mobile/src/features/media/upload-block';

describe('모임 화면 배치', () => {
  it('320dp와 360dp에서 다섯 탭이 한 칸씩 들어간다', () => {
    expect(tabSlotWidth(320)).toBeCloseTo(56);
    expect(tabSlotWidth(360)).toBeCloseTo(64);
    expect(tabSlotWidth(412)).toBeGreaterThan(70);
    expect(tabLabelSize(320)).toBeLessThanOrEqual(tabLabelSize(412));
    expect(tabIconSize(320)).toBeLessThanOrEqual(tabIconSize(412));
  });

  it('인계 중이면 사진 탭 이유가 인계라고 말한다', () => {
    expect(handoverInProgress('CONFIRMED')).toBe(true);
    expect(handoverInProgress('FINALIZED')).toBe(false);
    expect(
      uploadBlockReason({ handoverStatus: 'NOMINATED', uploadsAllowed: false, destinationCount: 0 }),
    ).toContain('인계가 진행 중');
    expect(uploadBlockReason({ uploadsAllowed: false, destinationCount: 1, destinationChosen: true })).toContain(
      '이용 기간',
    );
    expect(uploadBlockReason({ uploadsAllowed: true, destinationCount: 0, destinationChosen: false })).toContain(
      '행사나 폴더',
    );
  });
});
