# PHASE 0 — 기존 시스템 분석 보고서

작성: 2026-11-29 (KST). 기준 커밋: `develop` = `8ad67a7` (PR #58), `main` = `1a63143` (PR #59 merge).
개인정보 미포함. Figma 예시 이름·PDF 내용은 의도적으로 기록하지 않는다.

## 1. 접근 확인
| 대상 | 결과 |
|---|---|
| GitHub 저장소 | OK. 열린 PR 3개(#11 Railway API 설정, #22 관리자 TOTP, #23 관리자 운영 API — 모두 2026-11-05~06 생성된 오래된 cursor/* 브랜치, 이미 다른 PR로 대체됨, 손대지 않음) |
| CI | `ci` 워크플로: npm ci → prisma generate → build → migrate deploy → seed → test → typecheck(api, gathering-mobile, gathering-admin, mobile). develop/main 최신 실행 모두 success |
| Figma `SSdT1N1zyaaOjFBteoksYo` | OK. 1페이지, 프레임 6개 + 컴포넌트 `증명사진 자리 3:4` (§3) |
| 회원수첩 PDF 6개 | **BLOCKED**: 첨부 경로에 파일이 실제로 존재하지 않음(박스·PC 검색 결과 없음). 원본 재첨부 필요 |

## 2. 저장소 구조 (현재)
| 경로 | 역할 | 상태 |
|---|---|---|
| `apps/api` | Fastify API. **하나의 앱**에 회원수첩 foundation 라우트(`/api/auth/*`, `/api/members*`, `/api/local/current`) + 모임 모듈(`/api/gathering/*`) + JC 조직(`/api/gathering/jc-orgs` 공개 조회 + 관리자 라우트) | 운영 `gathering-api`로 배포 중 |
| `apps/gathering-mobile` | Expo SDK 54 모임 앱 (실제 출시 앱 "JCI KOREA", `kr.jcikorea.app`) | Play/App Store 준비, vc15 S25 설치, expo-updates(develop) |
| `apps/gathering-admin` | Vite/React 본사 관리자 웹 (아이디+비밀번호) | 운영 `gathering-admin-prod` |
| `apps/mobile` | 회원수첩 foundation 앱 ("JC Member Book", `com.memberbook.app`) | **미출시 골격**. 로그인/대기/홈/회원목록/상세/내정보 화면, 일정·자료실·관리자는 placeholder |
| `packages/contracts`, `shared`, `gathering-domain`, `config` | 공유 스키마·유틸 | |
| `prisma/schema.prisma` | **단일 스키마** (foundation + gathering_* + jc_organization_*) | 마이그레이션 24개, 추가형 |

배포 환경: Railway `jci-korea`
- production: `gathering-api`, `gathering-admin-prod` ← `main`, DB `gathering-postgres`
- development: `api`, `gathering-admin` ← `develop`, 개발 Postgres
- production `api`(회원수첩)·`Postgres`: 소스·트리거·배포가 없는 기존 서비스 — **접촉 금지 유지**
- 파일: Cloudflare R2 `jci-korea-media-prod` (비공개)
- 모바일: EAS (PC 빌드), Android 무료 빌드 한도 2026-12-01 리셋 (JCI-4 대기)

## 3. Figma 확정 6화면 (구조·토큰)
공통: 375×810, 상단 네이비 헤더 102px(`JCI KOREA` · ☰ · 화면 제목 22px Bold · 부제 11px), 하단 탭 4개 `로컬 / 모임 / 전체 일정 / 내 정보`(활성 탭 상단 3px 바).
토큰: navy `#17315b`, ink `#1e2b3d`, subtle `#66768a`, line `#d9e0e7`, light `#edf2f6`, bg `#f2f5f8`, paper `#ffffff`, gold `#d6ac60`, teal `#1f7469`, green `#e7f6ee`. 폰트 NanumGothic Regular/Bold.
사진 컴포넌트: `증명사진 자리 3:4` 72×96, 빈 자리는 회색 실루엣(머리·어깨) — 사진 없는 회원도 같은 크기 유지.

| # | 화면 | 구성 |
|---|---|---|
| 01 | 내 로컬 홈 | "로컬 회원 공통 공간 — 현역(YB)과 특우(OB)가 동일하게 이용", 로컬 회원수첩 배너(회원명부·역대회장·연도별 임원), 2열 타일 6개: 회원수첩(전체/현역/특우), 역대회장(현역/특우), 정관·규정(조항 검색/원본), 일정·공지, 자료실, 로컬 안내(연혁·조직·우호JC), 하단 "로컬 가입 승인 완료" 상태 배지 |
| 02 | 회원수첩 · 원본형 명부 | 검색(이름/회사명/JC 직책), 필터 칩 전체·현역 YB·특우 OB, 행 = 좌측 증명사진 68×91 + 이름(Bold) / 구분·직책 / 회사/직위 / 연락처·생년월일·가입일·회원번호, 구분선 |
| 03 | 현역 역대회장 · 원본형 | 탭 현역 회장/특우회장, 행 = 사진 80×104 · 대수/성명/(연도) · 세로선 · 우측 당시 회장단·감사·사무국장 명단 |
| 04 | 특우 역대회장 · 4열 | 4열 그리드, 사진 68×88, 아래 `N대 이름`, 연도. 연임 `3·4대`, `1990~91` 표기 |
| 05 | 전자 정관 · 조항 검색 | 탭 현역 정관/특우회 정관, 조항 검색, "원본 기반 · 검수 후 게시" 안내, 장 카드(좌측 5px 바) 안에 조 목록, 하단 `원본 PDF 보기 · 개정 이력 확인` |
| 06 | 로컬 관리자 | "관리자 권한 보유자에게만 노출", 가입 승인 대기 카드(사진·신청 정보·회원 구분 YB/OB 선택), 회원관리 메뉴: 회원 직접 등록, 현역→특우 전환(자동 변경 없음), 역대회장·임원 편집, 정관 관리(검수·개정 이력), 문자 관리(전체·YB·OB·선택) |

현재 구현과 비교: `apps/gathering-mobile`에는 로컬 화면이 없음(전부 신규). `apps/mobile` 화면은 다른(구) Figma `Ren9cwgy3gdJuwghg0P9TX` 기준이라 확정 Figma와 불일치 → 배치 참고만 가능.
Figma 예시 이름은 2016 수첩 실명일 수 있으므로 시드·테스트·스크린샷 데이터로 쓰지 않는다(가상 이름 사용).

## 4. 기존 데이터 모델 ↔ 요구사항 매핑
foundation 모델이 이미 스키마에 있고 foundation 마이그레이션으로 운영 `gathering-postgres`에도 테이블이 존재한다(행 수는 미확인, 운영 DB 조회 안 함). **새 중복 테이블을 만들지 말고 확장한다.**

| 요구 | 기존 모델 | 판정 | 부족분 |
|---|---|---|---|
| 지구·로컬 | `District`, `Local` (+ 운영 시드 16지구/312로컬, 별칭·이력) | 있음 | 로컬 **서비스 활성화 상태**(isActive는 조직 존재 의미라 별도 필드 필요) |
| 가입 시 로컬 선택 | `GatheringLocalAffiliation` (회원가입 JcOrgPicker) | 있음 | 로컬 가입 요청과 분리 유지(자동 요청 아님 — 이미 그렇다) |
| 로컬 가입 승인 | `LocalMembership` (PENDING/ACTIVE/REJECTED/SUSPENDED/WITHDRAWN, role MEMBER/LOCAL_ADMIN/LOCAL_OWNER) | 부분 | 요청/승인/거절 API, 사유·감사로그 |
| YB/OB | `MembershipCategory`(로컬별 자유 분류) | 부분 | YB/OB를 고정 구분 필드로 둘지 결정(제안: `MemberProfile.memberClass` enum + 전환 이력 테이블) |
| 회원 프로필(앱 미사용 포함) | `MemberProfile` (userId nullable) | 있음 | 사진 크롭 메타, 주소 구조화(우편번호/도로명/상세/수령지), 생일 양음력 있음 |
| 회사 복수 | `MemberCompany` (isPrimary) | 있음 | 업종/사업분야/이메일/소개 필드 추가 |
| 가족 | `MemberFamily` + `spouseName`,`weddingAnniversary` | 있음 | 동의 기록 |
| 사업 소개·도움 분야 | `introduction`,`specialty` 정도 | 부분 | 제공 서비스/도움 줄·받을 분야 구조 |
| 직책 마스터·이력 | `PositionMaster`, `MemberPositionHistory`(year, sortOrder) | 부분 | 연도별 직책 슬롯(정원·공석·분류 회장단/사무국/임원), 현역/특우 조직 구분, 대수 표기 |
| 역대회장 | 없음(이력에서 도출 가능) | 신규 | 대수(연임 범위), 현역/특우 구분 |
| 인계 | 모임용 `GatheringHandover`(회계연도) — **재사용 불가(다른 기능)** | 신규 | 로컬 인계(지정→수락→효력일→권한 전환), 비상 인계 |
| 관리자 권한 | `LocalMembership.role` | 부분 | 직책과 분리된 권한 부여 기록(권한 키 단위) |
| 정관 | `Document`/`DocumentVersion`/`DocumentArticle`(chapter/articleNo/body/pageNo) + `DocumentProcessingJob` | 부분 | 항 단위, 개정/시행일, 검수 상태, 현역/특우 구분 |
| 공지·일정 | `Notice`, `Event` (localId 격리 골격) | 부분 | 게시 상태·본문·대상, 전체 일정 통합 API |
| 자료실 | `FileObject`(로컬) / 모임 `GatheringDocument*` | 부분 | 로컬 자료실 폴더·권한 다운로드(모임 구현 패턴 재사용) |
| 개인정보 공개범위 | `PrivacySetting` + `services/privacy.ts` | 있음 | 필드 확장 |
| 감사로그 | `AuditLog`(로컬) / `GatheringAuditLog` | 있음 | |
| 문자 | 없음 | 신규 | 업체 미정 — mock provider까지만 |

## 5. 인증·권한 구조 — 충돌 지점
- 운영 사용자 계정은 **모임 인증**(`/api/gathering/auth/*`, 휴대폰+비밀번호, `GatheringSession`)으로 만들어졌다.
- foundation 인증(`/api/auth/*`, `RefreshSession`)은 **토큰이 하나의 LocalMembership에 묶임**(로컬 단위 세션). 통합 앱과 맞지 않음.
- 제안: 통합 앱은 모임 세션을 유일한 로그인으로 사용하고, 로컬 API는 요청마다 `(userId, localId)` ACTIVE 멤버십을 DB에서 검증하는 새 guard(`requireLocalMember(localId)`, `requireLocalPermission(perm)`)를 둔다. foundation 라우트는 회귀 테스트(`member-book-regression.test.ts`) 유지를 위해 제거하지 않고 그대로 둔다.
- 현재 회원가입은 **아이디 없이 휴대폰 번호가 로그인 ID**이며 SMS 인증이 없다. 지시문의 "아이디 + 휴대폰 인증"과 다름 → DECISIONS D-OPEN-6, 7.

## 6. apps/mobile 처리 방침 (사용자 확인 필요)
- `apps/mobile`은 출시된 적 없는 foundation 골격이며 이전 지시로 수정 금지였다.
- 통합 앱은 이미 출시 준비된 `apps/gathering-mobile`(JCI KOREA)에 "내 로컬"을 추가하는 것이 자연스럽다(스토어 앱 ID·OTA·빌드 체계 유지).
- 제안: `apps/mobile`은 **읽기/포팅 참고만** 하고 수정하지 않는다(디자인 시스템·화면은 확정 Figma와 다르므로 재사용 가치 낮음). API/DB 레벨 foundation 모델은 재사용·확장한다.

## 7. 빌드·테스트 상태
- API 테스트 50개 파일(Vitest, 로컬 Postgres 필요), 모임 도메인 테스트, 전 앱 typecheck — CI green.
- 로컬 개발 DB: 박스 임베디드 Postgres(포트 55432). 운영 DB 사용 금지.
- Codex CLI 0.167.1 — PHASE 0 시점 **사용량 소진**(§8).

## 8. Codex 사용량 신호
- 소진 시 `codex exec --json` 출력: `{"type":"error","message":"You’ve hit your usage limit. ... try again at <시각>."}` 후 `turn.failed`. 시각은 박스 로컬(KST).
- 세션 로그 `~/.codex/sessions/**/rollout-*.jsonl`의 `rate_limits`에 5시간(primary, 300분)·주간(secondary, 10080분) `used_percent`/`resets_at`(epoch)이 기록된다.
- 일시적 요청 제한(429/네트워크)은 짧은 대기 후 1회 재시도, "usage limit"은 실제 소진 → WAITING_QUOTA.
- 박스의 Codex 계정은 다른 프로젝트 에이전트와 공유되므로 잔여량이 예고 없이 줄 수 있다.

## 9. 다음 단계
`TASK_QUEUE.md`의 P1-01부터. 사용자 결정 필요 항목은 `DECISIONS.md` OPEN 목록.
