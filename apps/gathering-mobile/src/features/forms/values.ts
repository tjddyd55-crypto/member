import { toIsoFromLocal } from '../schedule/range';

export function keyboardAvoidingBehavior(platform: string): 'padding' | undefined {
  return platform === 'ios' ? 'padding' : undefined;
}

export function focusedFieldScrollY(fieldY: number, inset = 24) {
  if (!Number.isFinite(fieldY)) return 0;
  return Math.max(0, fieldY - inset);
}

export function formatKoreanDate(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

export function dateInputValue(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function timeInputValue(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function dateFromDateInput(value: string, base: Date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const next = new Date(base);
  next.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(next.getTime()) ? null : next;
}

export function timeFromTimeInput(value: string, base: Date) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const next = new Date(base);
  next.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return Number.isNaN(next.getTime()) ? null : next;
}

export function formatKoreanTime(date: Date) {
  return new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

export function formatKoreanDateTime(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

/** 피커가 고른 달력 날짜와 시각을 기존 로컬 ISO 변환으로 넘긴다. */
export function eventStartsAt(date: Date, time: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(time.getHours()).padStart(2, '0');
  const minutes = String(time.getMinutes()).padStart(2, '0');
  return toIsoFromLocal(`${date.getFullYear()}-${month}-${day}`, `${hours}:${minutes}`);
}

/** 납부일·결제일은 한국 시각 정오로 저장한다. */
export function paidAtFromCalendarDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return new Date(`${date.getFullYear()}-${month}-${day}T12:00:00+09:00`).toISOString();
}

export function fiscalMonthDay(date: Date) {
  return { fiscalStartMonth: date.getMonth() + 1, fiscalStartDay: date.getDate() };
}

export function dateForMonthDay(month: number, day: number) {
  return new Date(2024, month - 1, day, 12, 0, 0, 0);
}

export function composeAddress(road: string, detail: string) {
  const base = road.trim();
  const extra = detail.trim();
  if (!base) return extra;
  if (!extra) return base;
  return `${base} ${extra}`;
}

export function parsePostcodeMessage(raw: string) {
  try {
    const data = JSON.parse(raw) as { roadAddress?: string; jibunAddress?: string };
    const road = (data.roadAddress || data.jibunAddress || '').trim();
    return road || null;
  } catch {
    return null;
  }
}

export const POSTCODE_PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0">
<div id="wrap" style="width:100%;height:100vh"></div>
<script src="https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"></script>
<script>
new daum.Postcode({
  oncomplete: function (data) {
    var payload = { roadAddress: data.roadAddress || '', jibunAddress: data.jibunAddress || '' };
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  },
  width: '100%',
  height: '100%'
}).embed(document.getElementById('wrap'));
</script>
</body></html>`;

export type UploadLinkState = {
  expiresAt: string;
  pausedAt?: string | null;
  revokedAt?: string | null;
};

export function uploadLinkStatus(link: UploadLinkState, now = Date.now()) {
  if (link.revokedAt) return '폐기됨';
  if (new Date(link.expiresAt).getTime() <= now) return '만료됨';
  if (link.pausedAt) return '일시중지';
  return '사용 중';
}
