# 모바일 전자 회원수첩 (Member Book)

여러 로컬 JC가 독립적으로 운영하는 **모바일 전용** 전자 회원수첩 SaaS입니다.

Figma: https://www.figma.com/design/Ren9cwgy3gdJuwghg0P9TX

## 구조

```
apps/mobile   Expo + React Native (Expo Router)
apps/api      Fastify + Prisma + JWT
packages/     shared / contracts / config
prisma/       스키마 · 마이그레이션 · seed
docs/         제품·아키텍처·QA
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

# 6) Mobile
npm run mobile:start
```

## 개발 Seed 계정 (가상 데이터)

| 역할 | 로그인(phone) | 비밀번호 | 로컬 |
|------|---------------|----------|------|
| Owner | 01000001001 | Passw0rd! | 서울광진 |
| Admin | 01000001002 | Passw0rd! | 서울광진 |
| Member | 01000001003 | Passw0rd! | 서울광진 |
| Member | 01000002003 | Passw0rd! | 서울강남 |

교차 로컬 접근은 API에서 404로 차단됩니다.

## 브랜치

작업 브랜치: `feature/mobile-member-book-foundation`  
`main` merge / production 배포는 별도 승인 후 진행합니다.
