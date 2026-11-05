# 모임관리 1단계 — 코드베이스 점검과 구현 계획

기준일: 2026-11-05. 범위는 지시문 11/02~11/06이다. 행사·사진·장부 입력·인계 트랜잭션·이용권 승인은 이 단계의 완료 조건이 아니다.

## 지금 저장소에 있는 것

`feature/mobile-member-book-foundation` 은 모바일 전자 회원수첩이다.

- `apps/mobile`: Expo Router 회원수첩. 로그인, 홈, 회원 목록, 내 정보.
- `apps/api`: Fastify. 전화번호/이메일 + 비밀번호, 로컬 멤버십이 있어야 로그인된다.
- `packages/shared`, `packages/contracts`: 디자인 토큰과 회원수첩 API 계약.
- `prisma/schema.prisma`: 로컬(`Local`) 단위 회원, 일정 자리만 있는 `Event`, `AuditLog`.
- `docker-compose.yml`: 로컬 PostgreSQL. 이 환경에는 Docker가 없어 호스트 PostgreSQL 16으로 검증했다.

회원수첩의 테넌트 키는 `localId`다. 권한은 `MEMBER | LOCAL_ADMIN | LOCAL_OWNER`다. 전국 조직 계층은 없다.

## 재사용한 것

- npm workspaces, TypeScript, Prisma, PostgreSQL, Fastify, Zod, JWT 시크릿, bcrypt.
- 계정 테이블 `User`. 모임 전용 사용자는 같은 테이블에 전화번호와 비밀번호 해시를 둔다.
- 비밀번호 해시 함수 `hashPassword` / `verifyPassword`.
- 디자인 토큰 `@member/shared`. 모임 앱은 제목색만 딥네이비로 덮어쓴다. 회원수첩 화면 색은 바꾸지 않았다.
- 공통 오류 형식 `{ error: { code, message } }`. 라우트 플러그인보다 먼저 오류 처리기를 등록해, 회원수첩과 모임 API가 같은 본문을 반환하게 맞췄다.

## 일부러 공유하지 않은 것

| 회원수첩                           | 모임 모듈                             | 이유                                                 |
| ---------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `LocalMembership`                  | `GatheringMembership`                 | 로컬 가입 승인과 모임 참여는 다른 관계다.            |
| `Event`                            | `GatheringEvent` (`gathering_events`) | 같은 모델에 넣으면 회원수첩 일정이 모임 행사가 된다. |
| `AuditLog`                         | `GatheringAuditLog`                   | 조회 범위와 보존 이유가 다르다.                      |
| `RefreshSession.membershipId` 필수 | `GatheringSession`                    | 모임 계정은 로컬 멤버십 없이 로그인한다.             |
| `MemberProfile.name`               | `GatheringProfile.displayName`        | `User`에 필수 이름 컬럼을 넣으면 기존 행이 깨진다.   |
| `/api/auth/*` + 로컬 권한 JWT      | `/api/gathering/*` + `aud=gathering`  | 토큰을 바꿔 끼우면 401이 된다.                       |
| `apps/mobile`                      | `apps/gathering-mobile`               | 회원수첩 화면 흐름을 모임 화면으로 바꾸지 않는다.    |

지시문의 `UserLocalAffiliation`은 `GatheringLocalAffiliation`이다. 소속 로컬은 문자열이다. 지구/로컬 마스터와 연결하지 않는다. 전국 조직 계층은 만들지 않았다.

PostgreSQL 스키마를 나누지 않은 이유: Prisma multi-schema는 기존 모델 전부에 `@@schema`가 필요하고 마이그레이션이 기존 테이블을 건드린다. 테이블 접두사 `gathering_` 이면 기존 마이그레이션은 그대로 두고 테이블만 추가된다.

## 나중에 합치는 방법

1. 플랫폼 셸이 `User.id`를 공통 식별자로 쓴다.
2. 회원수첩 API는 `/api/...` + `localId`, 모임 API는 `/api/gathering/...` + `groupId`로 남긴다.
3. 한 사람이 로컬 회원과 모임 회원을 동시에 가질 수 있다. 모임 역할은 로컬 역할에서 추론하지 않는다.
4. 앱은 두 개로 두었다가, 스토어 정책이 정해지면 하나의 Expo 앱 안의 모듈로 합칠 수 있다. 라우트와 토큰 audience가 이미 갈라져 있다.

## 1단계 작업 목록

| 작업                                                         | 상태                                   |
| ------------------------------------------------------------ | -------------------------------------- |
| 점검·결정·화면·진행 문서                                     | 이 폴더에 작성                         |
| 지시문 I항 엔터티 스키마                                     | 테이블 생성. 행사·장부·파일 API는 없음 |
| 비밀번호 가입, 전화번호 중복 거절, 복구 코드, 수동 검토 요청 | API와 앱 연결                          |
| 모임 생성, 초대 발급·만료·폐기·승인·중복 참여                | API와 앱 연결                          |
| 모임별 권한을 서버에서 강제                                  | API 테스트                             |
| 스플래시, 로그인, 가입, 내 모임, 모임 상세의 홈·회원         | 앱에서 API를 호출                      |
| 일정·사진·재무 화면                                          | 빈 안내만 보여 줌. 완료 아님           |
| Railway, R2, 결제, 스토어 제출                               | 하지 않음                              |

## 위험

- 문자 인증이 없어 복구 코드를 잃으면 앱이 동일인을 확인하지 못한다.
- 인증 요청 제한은 프로세스 메모리다. API를 여러 대 띄우면 무력해진다.
- 초대 토큰이 URL에 실린다. 로그와 메신저에 남을 수 있다. 만료·폐기·횟수 제한으로 줄인다.
- 이용권 외부 결제가 앱스토어 심사에 맞는지는 미결이다. 결제 유도 UI는 넣지 않았다.
- `User` 삭제는 모임 행이 있으면 DB가 막는다. 계정 삭제 절차는 아직 없다.
- 실기기, 푸시, R2, 인계 원자 트랜잭션은 아직 검증하지 못했다.
