# RESUME — 작업 재개용 (가장 먼저 읽을 파일)

## 재개 지시문 (매 실행 시작 시 그대로 수행)
"JCI KOREA 프로젝트의 최신 저장소 상태와 docs/agent 문서를 확인하라. 마지막 완료 작업과 미완료 작업을 대조하고, Codex 사용량이 이용 가능한 상태라면 중단된 개발 작업부터 재개하라. 이미 완료한 기능을 다시 만들지 말고 테스트 및 PR 상태를 검증한 후 다음 작업을 진행하라. Production은 변경하지 말라."

재개 절차: `git fetch` → develop/main 최신 커밋·열린 PR 확인 → 이 파일 → `TASK_QUEUE.md` → `BLOCKERS.md` → Codex 사용량 확인(`codex exec --json` 짧은 호출, "usage limit" 메시지 여부) → IN_PROGRESS/WAITING_QUOTA 작업부터.

## 현재 상태 (2026-11-29 KST)
- PHASE 1. P1-01은 develop `6de04d2`에 병합됨. P1-02는 `feat/local-p1-02`에서 REVIEW. 다음 작업은 P1-03.
- P1-02에서 `Local.serviceEnabled`(기본값 false)와 `serviceEnabledAt`을 추가했다. 최고관리자는 웹에서 서비스를 켜거나 끌 수 있다. 변경 시 조직 이력과 관리자 감사로그가 함께 기록된다.
- ACTIVE 로컬 멤버는 서비스가 꺼져 있으면 `LOCAL_SERVICE_DISABLED`(403)를 받는다. 관리자 목록·상세에서 서비스 상태를 조회할 수 있다. 검증 결과는 `TEST_RESULTS.md` 참고.
- 로컬 커밋은 원본 `.git`의 읽기 전용 마운트로 보류. 변경 사항은 작업 트리에 남아 있다.
- P8-05 휴대폰 본인 확인은 유료 연동 승인 대기. 별도 트랙 JCI-4(12/1 09:00 KST) 유지.

## 다음 작업 (P1-03)
- `GET /api/local/me`에서 모임 세션과 `GatheringLocalAffiliation`을 기준으로 내 로컬 상태를 반환한다. A 미활성 / B 미요청 / C 대기 / D 승인.
- 서비스 미활성 상태도 응답할 수 있도록 기존 로컬 가드의 접근 조건을 고려한다.
