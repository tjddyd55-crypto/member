# TEST RESULTS

형식: 날짜(KST) · 대상 · 명령/방법 · 결과(PASS/FAIL/NOT_RUN) · 증빙.
실기기 QA는 실제 기기에서 확인한 경우만 PASS. 에뮬레이터·정적 검사는 별도 표기.

## 기준선 (PHASE 0)
| 날짜 | 대상 | 방법 | 결과 | 증빙 |
|---|---|---|---|---|
| 2026-11-28 | develop `8ad67a7` 전체 CI | GitHub Actions `ci` | PASS | run 46123667219 |
| 2026-11-28 | main `1a63143` 전체 CI | GitHub Actions `ci` | PASS | run 46126711548 |
| 2026-11-29 | docs/agent PR | GitHub Actions `ci` | (PR에서 갱신) | |

## PHASE 1 이후
(아직 없음)

## 실기기 QA
| 기기 | 빌드 | 결과 |
|---|---|---|
| Galaxy S25 | 모임 앱 vc15 (2026-11-25) | 모임 기능 기존 QA만. 로컬 기능 NOT_RUN |
| iPhone | — | BLOCKED (B-005) |
