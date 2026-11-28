# RESUME — 작업 재개용 (가장 먼저 읽을 파일)

## 재개 지시문 (매 실행 시작 시 그대로 수행)
"JCI KOREA 프로젝트의 최신 저장소 상태와 docs/agent 문서를 확인하라. 마지막 완료 작업과 미완료 작업을 대조하고, Codex 사용량이 이용 가능한 상태라면 중단된 개발 작업부터 재개하라. 이미 완료한 기능을 다시 만들지 말고 테스트 및 PR 상태를 검증한 후 다음 작업을 진행하라. Production은 변경하지 말라."

재개 절차: `git fetch` → develop/main 최신 커밋·열린 PR 확인 → 이 파일 → `TASK_QUEUE.md` → `BLOCKERS.md` → Codex 사용량 확인(`codex exec --json` 짧은 호출, "usage limit" 메시지 여부) → IN_PROGRESS/WAITING_QUOTA 작업부터.

## 현재 상태 (2026-11-29 03:20 KST)
- 현재 Phase: PHASE 1. P0 완료. **P1-01 REVIEW**(PR 리뷰·CI 대기), 다음 P1-02.
- 마지막 확인 커밋: develop `2b04133`. 작업 브랜치 `feat/local-p1-01`(PR → develop). main `1a63143`(main에만 merge 커밋 1개 → 12/1 승격은 develop→main merge PR 필요).
- 사용량: Codex 2026-11-29 03:00 KST 짧은 호출로 회복 확인(02:41 복구). P1-01 구현에 사용. 이후 한도 신호가 나오면 `WAITING_QUOTA` + `BLOCKERS.md`에 회복 시각 기록.
- 구현 요약: 기존 모임 로그인으로 `/api/local/:localId/ping`, `/admin-ping` 접근. 매 요청 DB에서 (userId, localId) ACTIVE 멤버십·로컬/계정 상태·역할 검사. 권한은 임시로 역할 기반(P5-01에서 부여 기록으로 교체). 증빙은 `TEST_RESULTS.md`. 원격 CI는 PR에서 확인.
- P8-05 휴대폰 본인 확인은 유료 연동 승인 대기. 별도 트랙 JCI-4(12/1 09:00 KST) 유지.

## 다음에 Codex에 전달할 작업 지시 (P1-02, D-10)
- `Local.isActive`와 별개인 로컬 서비스 활성화 필드를 추가한다. 추가형 마이그레이션의 기본값은 비활성이다.
- 본사 최고관리자 웹에서 활성화 상태를 변경할 수 있게 하고 변경 내역을 감사로그에 기록한다.
- P1-01의 로컬 권한 테스트와 회원수첩·모임 회귀 테스트를 로컬 Postgres에서 실행한다. Production 변경은 별도 승인 후 진행한다.
