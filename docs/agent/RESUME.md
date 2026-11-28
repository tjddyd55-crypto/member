# RESUME — 작업 재개용 (가장 먼저 읽을 파일)

## 재개 지시문 (매 실행 시작 시 그대로 수행)
"JCI KOREA 프로젝트의 최신 저장소 상태와 docs/agent 문서를 확인하라. 마지막 완료 작업과 미완료 작업을 대조하고, Codex 사용량이 이용 가능한 상태라면 중단된 개발 작업부터 재개하라. 이미 완료한 기능을 다시 만들지 말고 테스트 및 PR 상태를 검증한 후 다음 작업을 진행하라. Production은 변경하지 말라."

재개 절차: `git fetch` → develop/main 최신 커밋·열린 PR 확인 → 이 파일 → `TASK_QUEUE.md` → `BLOCKERS.md` → Codex 사용량 확인(`codex exec --json` 짧은 호출, "usage limit" 메시지 여부) → IN_PROGRESS/WAITING_QUOTA 작업부터.

## 현재 상태 (2026-11-29 00:45 KST)
- 현재 Phase: **PHASE 0 완료(상태 파일 PR) → PHASE 1 대기**
- 마지막 완료 작업: P0-01, P0-02, P0-04 (분석). P0-05 상태 파일(PR #60)
- 마지막 확인 커밋: develop `8ad67a7`, main `1a63143` (main에만 merge 커밋 1개 있음 → 12/1 승격은 fast-forward 불가, develop→main merge PR 필요)
- 작업 브랜치: 없음 (다음: `feat/local-p1-01`)
- 진행 중인 PR: 없음 (PR #60 상태 파일 develop 병합)
- 사용량: **WAITING_QUOTA** — Codex CLI "usage limit, try again at 2:41 AM"(2026-11-29 KST)
- 사용자 확인 대기: D-OPEN-8(apps/mobile 처리·통합 앱 기준), D-OPEN-6/7(아이디·SMS 인증), B-001(PDF 재첨부)

## 아직 완료되지 않은 작업
- P0-03 PDF 구조 확인 (B-001)
- PHASE 1 전체 (P1-01부터)

## 실행해야 할 테스트
- 이 PR CI(`ci`) 통과 확인
- P1-01 착수 시: `npm test -w @member/api` 기준선(로컬 Postgres 55432) 재확인

## 다음에 Codex에 전달할 작업 지시 (P1-01)
- 단계: PHASE 1 / P1-01 로컬 권한 guard
- 관련: `apps/api/src/modules/gathering/sessions.ts`(모임 세션 인증), `apps/api/src/plugins/auth.ts`(foundation guard 참고), `LocalMembership`, `apps/api/src/lib/local-scope.ts`
- 변경 범위: `apps/api/src/modules/local/` 신규 모듈(guard + `GET /api/local/:localId/ping` 같은 최소 보호 라우트), 테스트 파일 신규. foundation 라우트·apps/mobile·모임 정책 무변경
- 데이터 변경: 없음(스키마 변경 금지, P1-02에서 추가형 마이그레이션)
- 테스트: ACTIVE 동일 로컬 200 / 다른 로컬 403 / PENDING·REJECTED·SUSPENDED·WITHDRAWN 403 / 모임 전용 사용자 403 / 비로그인 401 / localId를 쿼리로 바꿔치기해도 차단
- 완료 판정: 위 테스트 PASS + 전체 `npm test`·typecheck PASS + CI green
- 금지: Production·main 변경, 운영 DB 접속, 유료 API, 개인정보 샘플, ONE FC 접촉, `@codex review` 코멘트
