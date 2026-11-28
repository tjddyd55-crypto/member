# BLOCKERS

| ID | 내용 | 원인 | 필요한 조치 | 상태 |
|---|---|---|---|---|
| B-001 | 수첩 PDF 6개 확인 | 사용자가 재첨부(2026-11-29 01:08 KST), 6개 모두 텍스트 추출 가능 | 해결 — PHASE0_ANALYSIS §10. 작업 사본은 `/home/box/.secrets/jci-handbook`(700)에만 | RESOLVED |
| B-002 | Codex CLI 사용량 소진 | 2026-11-29 00:39 KST `codex exec` → "You’ve hit your usage limit ... try again at 2:41 AM" | 02:41 KST 이후 재개. 그때까지 PHASE 1 코딩 대기 | OPEN (WAITING_QUOTA) — 02:41 KST 복구 예정, 02:50 루틴 `jci-korea-codex-resume`이 P1-01 시작 |
| B-003 | SMS 휴대폰 인증·문자 발송 업체 미정 | 유료 외부 서비스, 사용자 승인 필요 | D-OPEN-5, D-8 결정 전까지 mock | OPEN |
| B-004 | EAS Android 무료 빌드 한도 | 2026-12-01 리셋 | JCI-4 루틴에서 처리 | OPEN |
| B-005 | 실기기 QA | S25는 PC 연결 시에만, iPhone 미준비 | 기기 연결 시 수행, 불가 시 BLOCKED 기록 | OPEN |
| B-006 | 거절된 로컬 가입 요청의 재요청 정책 미확정 | 재요청 허용 여부와 조건 미정 | D-OPEN-8b 결정 필요. 확정 전에는 거절된 요청의 재제출을 차단 | OPEN |
