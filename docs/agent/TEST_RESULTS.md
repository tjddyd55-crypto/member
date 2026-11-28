# TEST RESULTS

형식: 날짜(KST) · 대상 · 명령/방법 · 결과(PASS/FAIL/NOT_RUN) · 증빙.
실기기 QA는 실제 기기에서 확인한 경우만 PASS. 에뮬레이터·정적 검사는 별도 표기.

## 기준선 (PHASE 0)
| 날짜 | 대상 | 방법 | 결과 | 증빙 |
|---|---|---|---|---|
| 2026-11-28 | develop `8ad67a7` 전체 CI | GitHub Actions `ci` | PASS | run 46123667219 |
| 2026-11-28 | main `1a63143` 전체 CI | GitHub Actions `ci` | PASS | run 46126711548 |
| 2026-11-29 | PR #60 docs/agent (`5411433`) | GitHub Actions `ci` | PASS | run 46161326258 (1m53s). Codex 자동 리뷰는 사용량 한도로 실행 실패(문서 전용이라 CI 기준 병합) |

## PHASE 1 이후
| 날짜(KST) | 대상 | 방법 | 결과 | 증빙 |
|---|---|---|---|---|
| 2026-11-29 | Prisma Client 생성 | `npx prisma generate --schema prisma/schema.prisma` | PASS | 종료 코드 0 |
| 2026-11-29 | 워크스페이스 빌드 | `npm run build` | PASS | 종료 코드 0 |
| 2026-11-29 | API 타입 검사 | `npm run typecheck -w @member/api` | PASS | 종료 코드 0 |
| 2026-11-29 | P1-01 로컬 접근 | `npm test -w @member/api -- src/tests/local-access.test.ts` | PASS | 로컬 Postgres, 12개 통과 |
| 2026-11-29 | 전체 테스트 최초 실행 | `npm test` | FAIL | 모임 도메인 73개 통과. API 388개 통과, 회원수첩 가상 시드 누락으로 5개 파일에서 13개 실패 |
| 2026-11-29 | 격리된 로컬 테스트 스키마 준비 | `npx prisma migrate deploy --schema prisma/schema.prisma`, `npm run db:seed` | PASS | 기존 마이그레이션과 가상 시드 적용. 테스트 후 임시 스키마 정리 |
| 2026-11-29 | 전체 테스트 재실행 | `npm test` | PASS | 모임 도메인 73개, API 401개 통과. 로컬 접근 12개 및 회원수첩 회귀 4개 포함 |
| 2026-11-29 | 원격 CI | PR에서 확인 | NOT_RUN | |
| 2026-11-29 | 실기기 QA(로컬 기능) | — | NOT_RUN | UI 없음(API만) |

## P1-02 로컬 서비스 활성화

| 날짜 | 대상 | 방법 | 결과 | 증빙 |
|---|---|---|---|---|
| 2026-11-29 | 로컬 스키마 변경 | `npx prisma migrate dev --create-only --name local_service_enabled`, `npx prisma migrate deploy` | PASS | Postgres 55432. 생성 SQL에서 기존 외래 키 차이를 걷어내고 `Local`의 두 컬럼 추가만 적용 |
| 2026-11-29 | 마이그레이션 이전 로컬 행 | 적용 전에 가상 로컬을 만든 뒤 동일 행 조회 | PASS | `isActive=true`, `serviceEnabled=false`, `serviceEnabledAt=NULL`. 가상 로컬과 지구만 정리 |
| 2026-11-29 | Prisma Client 생성 | `npx prisma generate --schema prisma/schema.prisma` | PASS | 종료 코드 0 |
| 2026-11-29 | 워크스페이스 빌드 | `npm run build` | PASS | 종료 코드 0 |
| 2026-11-29 | API 타입 검사 | `npm run typecheck -w @member/api` | PASS | 종료 코드 0 |
| 2026-11-29 | 관리자 웹 타입 검사 | `npm run typecheck -w @member/gathering-admin` | PASS | 종료 코드 0 |
| 2026-11-29 | 전체 테스트 최초 실행 | `npm test` | FAIL | 모임 도메인 73개 및 API 402개 통과. 신규 감사로그 테스트의 필드명 단언 1건 실패 |
| 2026-11-29 | 전체 테스트 재실행 | `npm test` | PASS | 모임 도메인 73개, API 403개 통과. JC 조직 11개, 로컬 접근 13개, 회원수첩 회귀 4개 포함 |
| 2026-11-29 | 관리자 웹 브라우저 조작 | — | NOT_RUN | |
| 2026-11-29 | 원격 CI | — | NOT_RUN | |

## 실기기 QA
| 기기 | 빌드 | 결과 |
|---|---|---|
| Galaxy S25 | 모임 앱 vc15 (2026-11-25) | 모임 기능 기존 QA만. 로컬 기능 NOT_RUN |
| iPhone | — | BLOCKED (B-005) |

## PHASE 1 — P1-03 / P1-04
| 날짜 | 대상 | 방법 | 결과 | 증빙 |
|---|---|---|---|---|
| 2026-11-29 | 신규 로컬 테스트 최초 실행 | `npm run test -w @member/api -- src/tests/local-join.test.ts` | FAIL | 단언 10개 통과. 종료 시 가상 계정의 복구 코드 외래 키로 정리 실패. 정리 코드를 수정하고 실패 실행의 가상 행만 삭제 |
| 2026-11-29 | 워크스페이스 빌드 | `npm run build` | PASS | 종료 코드 0 |
| 2026-11-29 | 전체 타입 검사 | `npm run typecheck` | PASS | API 포함, 종료 코드 0 |
| 2026-11-29 | 전체 테스트 | `npm test` | PASS | 로컬 Postgres 55432. 모임 도메인 73개, API 413개. 신규 로컬 가입 10개, 기존 로컬 접근 13개, 회원수첩 회귀 4개 포함 |
| 2026-11-29 | 신규 로컬 테스트 재실행 | `npm run test -w @member/api -- src/tests/local-join.test.ts` | PASS | 10개 통과. 종료 후 가상 지구 잔여 행 0건 확인 |
| 2026-11-29 | 원격 CI | — | NOT_RUN | |
| 2026-11-29 | PR #64 Codex P2 반영(미승인 가입 요청이 계정 삭제를 막지 않음) | `npm test` + 신규 gathering-account 테스트 | PASS | API 414 + domain 73, typecheck/build PASS |

## PHASE 1 — P1-05 / P1-06

| 날짜(KST) | 대상 | 방법 | 결과 | 증빙 |
|---|---|---|---|---|
| 2026-11-29 | 로컬 추가형 마이그레이션 | `npx prisma migrate dev --create-only --name local_member_class`, SQL 검토, `npx prisma migrate deploy`, `npx prisma migrate status` | PASS | 기존 모임 외래 키 재작성 구문을 제거한 뒤 로컬 Postgres 55432에 `20261129040234_local_member_class` 적용 확인 |
| 2026-11-29 | Prisma Client 생성 | `npm run db:generate` | PASS | 종료 코드 0 |
| 2026-11-29 | 워크스페이스 빌드 | `npm run build` | PASS | 종료 코드 0 |
| 2026-11-29 | 전체 타입 검사 | `npm run typecheck` | PASS | API 포함, 종료 코드 0 |
| 2026-11-29 | 로컬 승인·거절 및 분류 | `npm test -w @member/api -- src/tests/local-approval.test.ts` | PASS | 가상 데이터 사용, 5개 통과. 전체 테스트 후 가상 지구 잔여 0건 |
| 2026-11-29 | 전체 테스트 | `npm test` | PASS | 로컬 Postgres 55432. 모임 도메인 73개, API 419개 통과. local-approval 5개, local-access 13개, local-join 10개, member-book-regression 4개 포함 |
| 2026-11-29 | 원격 CI 및 실기기 QA | — | NOT_RUN | |
| 2026-11-29 | PR #66 Codex P2 반영(시드가 분류 이력 먼저 삭제) | `npm run db:seed` 재실행 | PASS | 로컬 DB 시드 정상 |
