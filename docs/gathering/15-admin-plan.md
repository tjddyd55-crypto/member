# 슈퍼관리자 웹 — 구조와 단계

기준 커밋은 `feature/mobile-member-book-foundation`의 `4f7c7352a15c3fc87a5055b156644e7b9c0dfb12`다. 발표일은 2026-12-03이다. 이 문서는 구현 순서다. Production과 PR #11은 대상이 아니다.

## 지금 있는 구조

모노레포는 npm workspaces다. 웹 앱은 없고 Fastify API와 Expo 앱 둘뿐이다.

| 경로 | 역할 |
| --- | --- |
| `apps/api` | Fastify. 회원수첩은 `/api`, 모임은 `/api/gathering`. 오류는 `{ error: { code, message } }`. |
| `apps/mobile` | 회원수첩 Expo. 로컬 멤버십 JWT. |
| `apps/gathering-mobile` | 모임 Expo. audience `gathering`. |
| `packages/gathering-domain` | 기간, 용량, 권한의 순수 함수. |
| `packages/shared`, `packages/contracts` | 회원수첩 토큰과 계약. |
| `prisma/schema.prisma` | PostgreSQL. 회원수첩 테이블과 `gathering_` 테이블이 한 데이터베이스에 있다. |

계정은 `User`를 공유한다. 모임 세션은 `GatheringSession`, 회원수첩 세션은 `RefreshSession`이다. 토큰을 바꿔 끼우면 401이다.

모임 데이터는 이미 있다.

| 필요한 것 | 현재 모델 |
| --- | --- |
| 모임, 최초 생성자 | `GatheringGroup.createdByUserId`. 인계해도 이 값은 바꾸지 않는다. |
| 현재 회장 | `GatheringRoleAssignment`의 `PRESIDENT` 중 `revokedAt`이 없는 행. 인계 최종 승인 때 바뀐다. |
| 이름, 전화, 로컬 | `GatheringProfile.displayName`, `User.phone`, `GatheringLocalAffiliation`. |
| 이용권 | `GatheringSubscription`, `GatheringSubscriptionAudit`. 상태 `ACTIVE/EXPIRED/REVOKED`, 출처 `PAID/COMPLIMENTARY/TRIAL`. |
| 용량 | `storageQuotaBytes`. 사용량은 `READY`와 살아 있는 `PENDING` 원본의 `sizeBytes` 합. |
| 회원 감사 | `GatheringAuditLog`. 회원수첩 `AuditLog`와 별개다. |
| 운영자 비밀 | `GATHERING_OPERATOR_SECRET`. 서버 환경변수. 응답과 앱 번들에 넣지 않는다. |

Railway Development는 프로젝트 `jci-korea` `ab078792-d0ff-4cd6-a5ad-31c62cd8ce26`, API `https://api-development-46a6.up.railway.app`, PostgreSQL, R2 `jci-korea-media`를 그대로 쓴다. 새 데이터베이스와 새 Railway 프로젝트는 만들지 않는다. 관리자 웹은 나중에 같은 Development 프로젝트의 서비스로 붙일 수 있다. Production은 대상이 아니다.

## 프레임워크

관리자 웹은 `apps/gathering-admin`에 Vite + React 19 + React Router로 둔다.

- API가 이미 Fastify다. Next.js를 붙이면 서버가 둘로 늘고 쿠키·시크릿 경계가 흐려진다.
- 화면은 로그인한 뒤의 업무용 SPA다. 검색 노출이나 서버 렌더가 필요 없다.
- React 19는 모노레포에 이미 있다.
- 색은 흰색, 밝은 회색, 남색의 평범한 CSS다. 컴포넌트 키트는 쓰지 않는다.

이 단계에서는 앱 골격을 만들지 않는다. 먼저 서버 규칙을 고정한다.

## 이용 정책

2026-11-06 지시가 이전의 무기한 업로드를 대체한다.

- 새로 만든 모임만 요청 시각부터 30일 `TRIAL`이다. 기존 모임 행에는 체험을 넣지 않는다.
- 같은 회원이 만든 별개 모임도 각각 체험을 받는다. `gathering_trial_claims`는 모임 행당 하나다.
- 모임을 지우고 같은 이름으로 다시 만드는 경우는 이름만으로 같은 모임이라고 보지 않는다. 그 남용 방지는 아직 자동으로 구분하지 않는다.
- 정식은 연 60,000원. 즉시 갱신 만료는 `max(지금, 현재 만료) + 1년`이다. 예전 3만 원 상수 `ANNUAL_GROUP_FEE_WON`과 기존 이력은 고치지 않는다.
- `GatheringGroup.suspendedAt`은 이용권과 별개다. 갱신해도 정지는 풀리지 않는다.
- 기간이 없거나 끝났거나 정지된 모임은 새 행사, 장부, 회비, 사진·영상·영수증 예약을 거절한다. 조회, 다운로드, 초대와 회원 상태 조회는 남긴다.
- 용량은 기간과 별개다. 할당이 사용량보다 작아도 파일을 지우지 않고 새 업로드만 거절한다.
- 화면의 `uploadsAllowed`는 안내일 뿐이다. 거절은 API가 한다.

## 단계

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| 1 | 체험, 체험 청구, 정지 열, 서버 입력 차단, 잔여 기간을 남기는 정식 만료 | PR 21 |
| 2 | 관리자 계정, 서버 세션, 실패 잠금, 비밀번호 로그인, 역할 범위, 불변 감사, 모임 조회 | 이 브랜치 |
| 3 | 대시보드 집계, 회원 전체 조회, 입금, 용량, 승인, 정지 | 다음 |
| 4 | `apps/gathering-admin` 여덟 메뉴. PC와 모바일 | 다음 |
| 5 | Development `jci-korea` `ab078792-d0ff-4cd6-a5ad-31c62cd8ce26`에 추가 마이그레이션. 전용 fixture로 브라우저 확인 | 다음 |

관리자 역할은 `SUPER_ADMIN`과 모임 범위의 `ADMIN`이다. 일반 모임 토큰은 관리 API에서 거부한다. 로그인은 아이디와 비밀번호만 받는다. 인증 코드는 묻지 않고, 이미 저장된 TOTP 암호문은 지우지 않는다. 비밀번호, 운영자 비밀, 계좌는 로그와 화면 번들에 넣지 않는다. 카드·토스·PG는 만들지 않는다.

## 아직 하지 않은 것

대시보드 숫자, 입금 원장, 용량 변경, 이용권 승인 API, 관리 화면, Development 배포, 브라우저 22개 시나리오.

모임을 지운 뒤 같은 이름으로 다시 만들어 체험을 반복하는 경우는 아직 자동으로 막지 않는다. 이름이나 휴대폰이 같다는 이유만으로 다른 모임의 체험을 거절하지 않는다. 관리 화면 `apps/gathering-admin`은 아직 없다.
