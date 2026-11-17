import type { FastifyPluginAsync } from 'fastify';
import { businessInfo, privacyPolicy, termsPolicy } from '@member/contracts';

const deletionPolicy = {
  title: 'JCI KOREA 계정 삭제 안내',
  notice: '앱에서 비밀번호 확인 후 계정 삭제를 요청할 수 있습니다.',
  paragraphs: [
    '메뉴 경로: 로그인 → 내 모임 → 내 정보 및 설정 → 계정 삭제 → 장부 보존에 동의 → 비밀번호 입력 → 삭제. 협의회장으로 있는 모임은 먼저 역할을 인계해야 합니다.',
    '삭제 처리 시 모임 프로필, 소속 로컬, 로그인 세션, 복구 코드, 푸시 토큰을 삭제하고 모임에서 탈퇴 처리합니다. 올린 사진·영상과 영수증의 원본 파일명은 제거합니다.',
    '회원수첩 멤버십이 없으면 전화번호와 이메일을 제거하고 비밀번호를 무작위 값으로 바꿔 계정을 비활성화합니다. 회원수첩 자격이 있으면 회원수첩 계정과 그 연락처는 유지됩니다.',
    '모임의 사진·영상, 장부, 영수증, 회계 스냅샷의 금액과 일자는 남습니다. 모임 프로필을 삭제해 이름과 전화번호 연결을 끊지만 내부 사용자 식별자, 탈퇴·역할 이력과 감사 기록은 유지됩니다.',
    '삭제 대상 정보는 요청 처리 시 삭제됩니다. 보존되는 모임 기록과 내부 이력에는 현재 자동 삭제 기한이 정해져 있지 않습니다.',
    `삭제 관련 문의: ${businessInfo.businessEmail}`,
  ],
};
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

export const legalRoutes: FastifyPluginAsync = async (app) => {
  for (const [path, policy] of Object.entries({
    privacy: privacyPolicy,
    terms: termsPolicy,
    'account-deletion': deletionPolicy,
  })) {
    app.get(`/legal/${path}`, async (_request, reply) => {
      // app.ts has no existing global security-header hook. Keep these scoped to public HTML.
      return reply
        .type('text/html; charset=utf-8')
        .header('X-Content-Type-Options', 'nosniff')
        .header('X-Frame-Options', 'DENY')
        .header('Referrer-Policy', 'no-referrer')
        .header(
          'Content-Security-Policy',
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        )
        .send(
          `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(policy.title)}</title><style>body{margin:0 auto;padding:24px;max-width:720px;font-family:system-ui,sans-serif;line-height:1.8;color:#18253a;background:#fff}h1{font-size:1.6rem}p{overflow-wrap:anywhere}</style></head><body><main><h1>${escape(policy.title)}</h1><p>${escape(policy.notice)}</p>${policy.paragraphs.map((text) => `<p>${escape(text)}</p>`).join('')}</main></body></html>`,
        );
    });
  }
};
