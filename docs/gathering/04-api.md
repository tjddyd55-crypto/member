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

## 아직 API가 없음

사진·영상, 신고 처리, 영수증 업로드, 수입·지출, 회비 입력, 회계 마감, 인계 실행, 이용권 승인, 계정 삭제, 관리자 대시보드. 저장 키 준비 코드는 `storage/r2.ts`에만 있다.

이 경로를 404가 아닌 성공으로 흉내 내는 스텁은 두지 않았다.
