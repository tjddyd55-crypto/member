# 시스템 아키텍처

## 구성

```
[Expo Mobile] --HTTPS/JSON--> [Fastify API] --> [PostgreSQL]
                                   |
                                   +--> [S3 호환 Object Storage] (이미지·PDF)
                                   |
                                   +--> (향후) [Worker] <-- Job 테이블
```

| 계층 | 기술 |
|------|------|
| Mobile | Expo, RN, TS, Expo Router, TanStack Query, RHF, Zod, SecureStore |
| API | Node.js, Fastify, Zod, JWT Access+Refresh |
| ORM/DB | Prisma, PostgreSQL |
| Storage | S3 호환 (signed URL) |

## 인증 흐름

1. `POST /api/auth/login` — phone/email + password
2. Access Token(짧은 TTL) + Refresh Token(세션 추적, 해시만 저장)
3. 모바일 SecureStore 보관
4. `POST /api/auth/refresh` — rotation
5. `POST /api/auth/logout` — 서버 세션 폐기 + 로컬 토큰 삭제
6. `GET /api/auth/me` — user + activeMembership

요청 컨텍스트:

```ts
request.auth = { userId, membershipId, localId, role, membershipStatus }
```

## 파일 업로드 (향후)

1. API가 업로드 URL/키 발급
2. 클라이언트가 Object Storage에 직접 업로드
3. `FileObject.storageKey`만 DB 저장
4. 조회 시 signed URL 발급

## 문서 변환 · PDF 출력 (향후 Worker)

- API는 `DocumentProcessingJob` / `PrintExportJob` 행만 생성
- Worker가 비동기 처리 (상태: QUEUED → PROCESSING → DONE/FAILED)
- 1차에 Redis 필수 아님. **동기 처리에 종속되지 않는** job 테이블 구조만 스키마·문서에 반영

## 로컬 데이터 격리

모든 로컬 소유 엔티티는 `localId`를 가지며, API는 **세션의 localId**로만 조회한다.  
클라이언트가 보낸 `localId`는 권한 근거가 아니다. 상세: `tenant-isolation.md`
