# 보안 체크리스트

저장소가 Public일 수 있다고 보고 2026-11-05에 작업 트리와 커밋 2개(`7416bf8`, `0cab21d`)를 스캔했다. 운영용 클라우드 키, 개인 전화번호, 운영 DB URL은 찾지 못했다.

## 발견한 위치 (값은 적지 않음)

| 위치 | 내용 |
|---|---|
| `apps/api/.env.example` | 로컬 PostgreSQL URL, 개발용 JWT 자리표시자 |
| `docker-compose.yml` | 로컬 Postgres 계정 |
| `README.md`, `prisma/seed.ts`, `apps/api/src/tests/` | 가상 전화번호와 개발 시드 비밀번호 |
| `packages/gathering-domain/src/phone.test.ts` | 형식 예시 번호 |
| `apps/mobile/app/(auth)/login.tsx` | 이전에는 시드 번호가 입력칸에 채워져 있었다. 지금은 비워 두었다 |

`.env`, `apps/api/.env`는 gitignore 대상이다. 이력에 실운영 비밀이 들어간 커밋은 없다.

## 비밀번호 재설정과 회원수첩 세션

모임 계정과 회원수첩은 `User.passwordHash`를 공유한다. 복구 코드로 비밀번호를 바꾸면 `GatheringSession`과 회원수첩 `RefreshSession`을 함께 폐기한다. 그래서 재설정 전에 발급된 리프레시 토큰으로는 어느 쪽도 다시 로그인할 수 없다.

유지하는 것:

- 로컬 멤버십, 역할, 회원 데이터는 지우지 않는다.
- 새 비밀번호로 회원수첩 로그인은 그대로 가능하다.
- 서버에 저장하지 않는 액세스 토큰은 기존과 같이 짧은 만료 시각까지 남는다. 폐기 목록은 두지 않는다. 세션을 이어 가는 수단은 리프레시 토큰이다.

## 사람이 할 일

- 저장소가 Public이면 시드 비밀번호를 운영에 재사용하지 않는다. 가능하면 저장소를 Private로 둔다.
- `.env.example`의 자리표시자를 그대로 배포하지 않는다. 운영 JWT, `GATHERING_JOB_SECRET`, `EXPO_ACCESS_TOKEN`, R2 키는 배포 환경에만 넣는다.
- 실수로 비밀을 커밋하면 값을 지우는 커밋만으로는 부족하다. 키를 폐기하고 이력에서 제거한다.
- 회원수첩 Railway와 기존 DB는 이 작업에서 변경하지 않는다. 모임용 자원은 새 프로젝트로 만든다.
