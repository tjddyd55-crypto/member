/** 화면 너비에서 좌우 여백을 뺀 뒤 탭 개수로 나눈 칸 너비. */
export function tabSlotWidth(screenWidth: number, gutter = 20, count = 5) {
  return Math.max(0, screenWidth - gutter * 2) / count;
}

/** 320dp에서도 다섯 글자 탭이 한 줄에 들어가도록 글자 크기를 고른다. */
export function tabLabelSize(screenWidth: number) {
  const slot = tabSlotWidth(screenWidth);
  if (slot < 58) return 11;
  if (slot < 72) return 12;
  return 13;
}

export function tabIconSize(screenWidth: number) {
  return tabSlotWidth(screenWidth) < 58 ? 18 : 20;
}
