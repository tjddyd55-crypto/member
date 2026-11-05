# member

이 저장소에는 두 개의 모바일 모듈이 있다.

- **전자 회원수첩** (`apps/mobile`, `/api`): 로컬 단위 회원명부. 기존 foundation.
- **모임관리** (`apps/gathering-mobile`, `/api/gathering`): 독립 모임의 계정, 초대, 권한. 1단계이며 행사·사진·장부 입력·인계는 아직 없다.

모임 앱에 보이는 `JCI KOREA`는 화면 이름이다. 공식 승인이나 제휴를 뜻하지 않는다. 상세는 `docs/gathering/`에 있다.

여러 로컬이 독립적으로 운영하는 **모바일 전용** 전자 회원수첩이 이 저장소의 기존 축이다.

Figma: https://www.figma.com/design/Ren9cwgy3gdJuwghg0P9TX

## 구조

```
apps/mobile            회원수첩 Expo 앱
apps/gathering-mobile  모임 Expo 앱
apps/api               Fastify. 회원수첩 /api 와 모임 /api/gathering
packages/              shared / contracts / gathering-domain / config
prisma/                스키마 · 마이그레이션 · seed
docs/gathering/        모임 1단계 점검, 결정, API, 화면, 남은 일
```

## 빠른 시작

```bash
# 1) 의존성
npm install

# 2) 환경변수
cp apps/api/.env.example apps/api/.env
cp apps/mobile/.env.example apps/mobile/.env

# 3) DB (Docker)
docker compose up -d

# 4) 마이그레이션 + Seed
npm run db:generate
npm run db:migrate
npm run db:seed

# 5) API
npm run api:dev

# 6) 회원수첩 앱
npm run mobile:start

# 7) 모임 앱 (다른 터미널)
cp apps/gathering-mobile/.env.example apps/gathering-mobile/.env
npm run start -w @member/gathering-mobile
```

Prisma는 저장소 루트의 `DATABASE_URL`을 읽는다. `apps/api/.env.example`과 같은 값을 루트 `.env`에도 둔다. `.env`와 비밀값은 커밋하지 않는다.

모임 모듈의 남은 일과 사람이 할 외부 작업은 `docs/gathering/06-progress-and-human-checklist.md`에 있다.

## 개발 Seed 계정 (가상 데이터)

| 역할   | 로그인(phone) | 비밀번호  | 로컬     |
| ------ | ------------- | --------- | -------- |
| Owner  | 01000001001   | Passw0rd! | 서울광진 |
| Admin  | 01000001002   | Passw0rd! | 서울광진 |
| Member | 01000001003   | Passw0rd! | 서울광진 |
| Member | 01000002003   | Passw0rd! | 서울강남 |

교차 로컬 접근은 API에서 404로 차단됩니다.

## 브랜치

작업 브랜치: `feature/mobile-member-book-foundation`  
`main` merge / production 배포는 별도 승인 후 진행합니다.
