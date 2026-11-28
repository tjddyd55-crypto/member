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

## 실기기 QA
| 기기 | 빌드 | 결과 |
|---|---|---|
| Galaxy S25 | 모임 앱 vc15 (2026-11-25) | 모임 기능 기존 QA만. 로컬 기능 NOT_RUN |
| iPhone | — | BLOCKED (B-005) |
