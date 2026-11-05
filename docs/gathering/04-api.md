# 모임관리 API

기본 경로는 `/api/gathering`. 인증 헤더는 `Authorization: Bearer`. 모임 액세스 토큰의 audience는 `gathering`이다. 회원수첩 토큰은 여기서 401이고, 모임 토큰은 `/api/members`에서 401이다.

오류 본문: `{ "error": { "code", "message" } }`.

## 구현됨

| 메서드 | 경로                                              | 권한                                                                              |
| ------ | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| POST   | `/auth/register`                                  | 공개. 이름, 휴대폰, 비밀번호, 소속 로컬, 명부 공개 동의                           |
| POST   | `/auth/login`                                     | 공개. 로컬 멤버십 불필요                                                          |
| POST   | `/auth/refresh`                                   | 리프레시 회전                                                                     |
| POST   | `/auth/logout`                                    | 리프레시 폐기                                                                     |
| GET    | `/auth/me`                                        | 로그인                                                                            |
| POST   | `/auth/profile`                                   | 로그인. 회원수첩 사용자가 모임 프로필과 복구 코드를 받을 때. 한 번                |
| POST   | `/auth/recovery/redeem`                           | 공개. 코드와 새 비밀번호. 세션 전부 폐기. 자동 로그인 없음                        |
| POST   | `/auth/recovery/request`                          | 공개. 비밀번호를 바꾸지 않음. 없는 번호도 같은 문장                               |
| POST   | `/groups`                                         | 프로필 필요. 생성자가 회장, 열린 회계연도 생성                                    |
| GET    | `/groups`                                         | 내 활성·대기 모임. 쿼리 `groupId`는 무시                                          |
| GET    | `/groups/:groupId`                                | 활성 회원                                                                         |
| PATCH  | `/groups/:groupId`                                | 회장. 이름, 설명, 초대 승인 기본값                                                |
| GET    | `/groups/:groupId/members`                        | 활성 회원은 `ACTIVE`. `PENDING`은 총무·회장                                       |
| POST   | `/groups/:groupId/members/:membershipId/decision` | 총무·회장. `APPROVE` 또는 `REJECT`                                                |
| POST   | `/groups/:groupId/roles`                          | 회장. `SECRETARY`, `TREASURER`, `EXECUTIVE`. 본문 `groupId` 무시                  |
| POST   | `/groups/:groupId/roles/:assignmentId/revoke`     | 회장. 회장 역할은 거부                                                            |
| POST   | `/groups/:groupId/invites`                        | 회장·총무. 평문 토큰은 이 응답 한 번. `revokeInviteId`로 재발급 시 이전 링크 폐기 |
| GET    | `/groups/:groupId/invites`                        | 회장·총무. 토큰 원문 없음                                                         |
| POST   | `/groups/:groupId/invites/:inviteId/revoke`       | 회장·총무                                                                         |
| GET    | `/invites/:token`                                 | 공개 미리보기. 모임 이름, 승인 필요 여부, 만료 시각만                             |
| POST   | `/invites/:token/accept`                          | 로그인과 프로필, 명부 공개 동의. 활성·대기 중복은 409                             |

초대 기본 만료는 7일, 요청으로 1시간~30일. 링크 형식은 `jcikorea://invite/{token}`이다.

가입·로그인·복구·초대 미리보기와 수락은 IP당 10분에 30회다. 이 제한은 서버 프로세스 안뿐이다.

## 2단계에서 추가된 API

| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/calendar?from&to` | 로그인. 활성 모임만 |
| GET | `/groups/:groupId/events?from&to` | 활성 회원 |
| POST | `/groups/:groupId/events` | 회장·총무 |
| GET | `/groups/:groupId/events/:eventId` | 활성 회원 |
| PATCH | `/groups/:groupId/events/:eventId` | 회장·총무. 취소 포함 |
| PUT | `/groups/:groupId/events/:eventId/attendance` | 활성 회원. 취소된 행사는 409 |
| GET | `/groups/:groupId/officers` | 활성 회원. 현재 역할과 임기 이력 |
| POST | `/groups/:groupId/officers` | 회장. 기존 역할 지정과 같다 |
| POST | `/groups/:groupId/officers/:assignmentId/revoke` | 회장. 회장 역할은 거부 |
| POST | `/push/tokens` | 로그인. `granted` 또는 `denied`. 거절 시 토큰 비활성 |
| POST | `/jobs/reminders` | `x-gathering-job-secret`. 비밀이 없으면 404 |

행사 등록·변경은 다른 활성 회원에게 한 번 알린다. 리마인드는 시작 1시간 전, 같은 시작 시각에 대해 한 번이다. Expo가 `DeviceNotRegistered`를 주면 그 토큰을 끈다.

## 사진·영상

활성 회원만 호출한다. 다른 모임은 404다. 환경변수 `R2_BUCKET`, `R2_PREFIX_ENV`, `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`(또는 기존 `STORAGE_*`)가 없으면 업로드·다운로드·삭제는 503이다. 서명에 실패하면 501이다.

| 메서드 | 경로 | 권한 |
|---|---|---|
| POST | `/groups/:groupId/events/:eventId/media/uploads` | 활성 회원. 이용권이 있고 50GB 안일 때 서명 URL |
| POST | `/groups/:groupId/events/:eventId/media/:assetId/complete` | 올린 사람. 저장소에 파일이 있어야 `READY` |
| GET | `/groups/:groupId/events/:eventId/media` | 활성 회원. 확인된 파일만 |
| GET | `/groups/:groupId/albums?year` | 활성 회원. 행사 앨범과 한국 달력 연도 |
| GET | `/groups/:groupId/media/:assetId/download` | 활성 회원. 짧은 서명 URL |
| DELETE | `/groups/:groupId/media/:assetId` | 올린 사람 또는 회장·총무 |
| POST | `/groups/:groupId/media/:assetId/reports` | 활성 회원 |
| GET | `/groups/:groupId/media/reports` | 회장·총무 |
| POST | `/groups/:groupId/media/reports/:reportId/resolve` | 회장·총무 |
| GET | `/groups/:groupId/storage` | 활성 회원. 사용량과 이용권 여부 |

키는 `{R2_PREFIX_ENV}/gatherings/{groupId}/events/{eventId}/photos|videos|receipts/{objectId}` 이다. `member-book/profiles/` 는 키 규칙만 있고 회원수첩 업로드는 연결하지 않는다. 영상은 선언 길이 5분, 사진은 15MB, 영상은 200MB까지다. 확정 때 파일 앞부분으로 형식을 확인한다. 길이 자체는 디코드하지 않는다.

## 장부와 영수증

활성 회원이 조회한다. 수정은 `FINANCE_WRITE`(회장·재무), 영수증 첨부·삭제는 `RECEIPT_WRITE`다. 총무와 일반 회원은 403이다. 금액은 정수 원이고 귀속 연도는 `paidAt`이다. 마감된 해는 409 `FINANCE_YEAR_CLOSED`다.

| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/groups/:groupId/finance?year` | 활성 회원. 기초잔액·수입·지출·잔액·회비 |
| POST | `/groups/:groupId/finance/dues` | 회장·재무 |
| GET/POST | `/groups/:groupId/events/:eventId/transactions` | 조회는 회원, 생성은 회장·재무 |
| PUT/DELETE | `/groups/:groupId/transactions/:transactionId` | 회장·재무. 열린 해만 |
| GET/POST | `/groups/:groupId/events/:eventId/receipts` 와 `.../uploads` | 조회는 회원, 업로드는 회장·재무 |
| POST | `.../receipts/:receiptId/complete` | 올린 사람 |
| GET | `/groups/:groupId/receipts/:receiptId/download` | 활성 회원 |
| DELETE | `/groups/:groupId/receipts/:receiptId` | 회장·재무. 마감·보존 영수증은 거절 |

정정은 `adjustment: true`와 비고가 있는 열린 해 거래다. 영수증 바이트는 50GB에 포함된다. 이용권이 없어도 한도 안이면 영수증은 올릴 수 있다.

## 이용권

앱은 상태만 조회한다. 부여는 `x-gathering-operator-secret`이 있는 운영자 경로다. 비밀이 없으면 404다. 금액, 계좌, 결제 링크는 응답에 없다.

| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/groups/:groupId/subscription` | 활성 회원 |
| POST | `/admin/groups/:groupId/subscription` | 모임 로그인 + 운영자 비밀. `PAID` 또는 `COMPLIMENTARY`, `idempotencyKey` |
| POST | `/jobs/subscription-notices` | `x-gathering-job-secret`. 만료 30일·7일·당일 회장 안내, 지난 이용권은 `EXPIRED` |

갱신은 사용량을 0으로 만들지 않는다. 기간은 승인 시각부터 1년이다.

## 마감·인계

자동 마감은 없다. 상태는 지명 → 수락 → 확인 → 최종 승인이다. 최종 승인은 한 트랜잭션에서 스냅샷, 권한 이전, 다음 회계연도, 잔액 이월을 만든다. 같은 요청을 다시 해도 스냅샷은 하나다. 마감된 해의 거래·영수증 수정은 거절한다. 사진 업로드는 막지 않는다.

| 메서드 | 경로 | 권한 |
|---|---|---|
| GET | `/groups/:groupId/handover` | 활성 회원. 버튼 가능 여부는 서버가 계산 |
| POST | `/groups/:groupId/handover` | 회장. `toUserId`, `idempotencyKey` |
| POST | `.../handover/:id/accept` | 지명된 차기 회장 |
| POST | `.../handover/:id/confirm` | 현 회장. 합계가 장부와 같아야 함 |
| POST | `.../handover/:id/finalize` | 현 회장. 확인 뒤 장부가 바뀌면 `HANDOVER_STALE` |
| POST | `.../handover/:id/cancel` | 현 회장. 최종 승인 전 |

## 아직 API가 없음

계정 삭제, 관리자 대시보드.

이 경로를 404가 아닌 성공으로 흉내 내는 스텁은 두지 않았다.
