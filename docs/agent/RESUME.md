# RESUME — 작업 재개용 (가장 먼저 읽을 파일)

## 재개 지시문 (매 실행 시작 시 그대로 수행)
"JCI KOREA 프로젝트의 최신 저장소 상태와 docs/agent 문서를 확인하라. 마지막 완료 작업과 미완료 작업을 대조하고, Codex 사용량이 이용 가능한 상태라면 중단된 개발 작업부터 재개하라. 이미 완료한 기능을 다시 만들지 말고 테스트 및 PR 상태를 검증한 후 다음 작업을 진행하라. Production은 변경하지 말라."

재개 절차: `git fetch` → develop/main 최신 커밋·열린 PR 확인 → 이 파일 → `TASK_QUEUE.md` → `BLOCKERS.md` → Codex 사용량 확인(`codex exec --json` 짧은 호출, "usage limit" 메시지 여부) → IN_PROGRESS/WAITING_QUOTA 작업부터.

## 현재 상태 (2026-11-29 01:20 KST)
- 현재 Phase: **PHASE 0 완료(사용자 확정 t122 반영) → PHASE 1 대기**
- 마지막 완료 작업: P0-01~P0-05 (PR #60), P0-03/P0-06 수첩 PDF 분석·확정 반영(이 PR)
- 마지막 확인 커밋: develop `51c97a4`(PR #60 병합) 이후 이 PR, main `1a63143` (main에만 merge 커밋 1개 → 12/1 승격은 ff 불가, develop→main merge PR 필요)
- 작업 브랜치: `docs/agent-decisions-handbook` (병합 후 없음). 다음: `feat/local-p1-01`
- 진행 중인 PR: 이 문서 PR 외 없음
- 사용량: **WAITING_QUOTA** — Codex CLI "usage limit, try again at 2:41 AM"(2026-11-29 KST). 루틴 `jci-korea-codex-resume`이 **02:50 KST**에 깨어나 P1-01 시작. 시작 전 `codex exec --json` 짧은 호출로 한도 해소 확인, 아직이면 WAITING_QUOTA 유지하고 중복 실행 금지
- 사용자 확인 대기: 없음(D-6~D-13 확정). 미확정 D-OPEN-1~5, 6b, 7b는 해당 Phase 착수 시점에 질문
- 별도 트랙: JCI-4 (12/1 09:00 KST Play 업로드) 유지, 이 큐와 독립

## 아직 완료되지 않은 작업
- PHASE 1 전체 (P1-01부터)
- P8-05 휴대폰 본인 확인(유료 승인 필요)

## 실행해야 할 테스트
- 이 PR CI(`ci`) 통과
- P1-01 착수 시: 로컬 Postgres 55432 기동 후 `npm test -w @member/api` 기준선 재확인(시작: `epg/node_modules/@embedded-postgres/linux-x64/native/bin/pg_ctl -D /workspace/jci-codex/pgdata118 -o "-p 55432 -k /tmp" start`)

## 다음에 Codex에 전달할 작업 지시 (P1-01, 사용자 확정 D-7/D-8 반영)
- 단계: PHASE 1 / P1-01 로컬 권한 guard
- 확정 전제: 통합 앱은 gathering-mobile, 로그인은 기존 모임 세션(휴대폰 번호=ID) 공통 사용. 로컬 데이터는 **매 요청 서버에서** 해당 로컬 `LocalMembership.status = ACTIVE` + 필요 권한을 DB로 검사(토큰/클라이언트가 보낸 localId·role을 신뢰하지 않음). 전화번호만으로 관리자 권한을 주거나 기존 회원과 자동 연결하지 않음
- 관련 기존 코드: `apps/api/src/modules/gathering/sessions.ts`·`tokens.ts`(모임 세션 인증), `apps/api/src/plugins/auth.ts`(foundation guard, 참고만), `apps/api/src/lib/local-scope.ts`, `LocalMembership`(prisma)
- 변경 범위: `apps/api/src/modules/local/` 신규 모듈(guard `requireLocalMember(localId)`, `requireLocalPermission(key)` + 최소 보호 라우트 `GET /api/local/:localId/ping`), 테스트 신규. foundation 라우트·apps/mobile·모임 정책 무변경(`member-book-regression.test.ts` 계속 통과)
- 데이터 변경: 없음(스키마 변경 금지; 서비스 활성화 필드는 P1-02)
- 테스트: ACTIVE 동일 로컬 200 / 다른 로컬 403 / PENDING·REJECTED·SUSPENDED·WITHDRAWN 403 / 모임 전용 사용자 403 / 비로그인 401 / 쿼리·바디로 localId 바꿔치기 차단 / 관리자 권한 키 없는 ACTIVE 회원이 관리자 라우트 접근 시 403
- 완료 판정: 위 테스트 PASS + 전체 `npm test`·typecheck PASS + CI green, PR → develop
- 금지: Production·main 변경, 운영 DB 접속, 유료 API, 개인정보 샘플(수첩 PDF 내용 포함), ONE FC 접촉, `@codex review` 코멘트, Bugbot
- 완료 후: TASK_QUEUE·PROGRESS·TEST_RESULTS·RESUME 갱신 PR
