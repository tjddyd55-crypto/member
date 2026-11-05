# 진행도와 사람이 할 일

검증일: 2026-11-05. 로컬 PostgreSQL에서 `npm test`가 통과했다. 도메인, 회원수첩 격리, 모임 1단계, 회원수첩 회귀, 행사·알림 테스트가 포함된다. 타입체크도 통과했다. 실기기와 브라우저 조작 검증은 하지 않았다. Railway·R2·배포는 하지 않았다.

## 구현된 것

- 모임 모듈 문서, 스키마, 가산 마이그레이션. 기존 회원수첩 테이블을 ALTER하거나 DROP하지 않는다.
- 비밀번호 가입, 전화번호 중복 거절, 복구 코드, 자동 승인 없는 검토 요청.
- 모임 생성, 초대, 다른 모임 차단, 역할의 서버 강제, 회장 역할 잠금.
- 행사 생성·수정·취소, 모임 월별 일정, 전체 일정, 참석/불참/미정.
- 집행부 지정·해임 화면과 임기 이력.
- 푸시 토큰 등록, 권한 거절, 만료 토큰 비활성, 등록·변경·1시간 전 리마인드의 중복 방지.
- 회계연도·용량 규칙 테스트. 사진·영상은 서명 URL, 업로드 확인, 용량, 앨범까지 연결했다. R2 버킷은 만들지 않았고 설정이 없으면 503이다.

## 미완료

- 마감 스냅샷, 인계 실행.
- 이용권 수동 부여와 만료 후 업로드 제한은 연결했다. 앱에는 결제 안내를 넣지 않는다.
- 계정 삭제, 관리자 대시보드.
- Android/iOS 실기기 푸시 수신. 절차는 `08-store-and-devices.md`.
- 스토어 제출, 시연 데이터, 예비 영상.

마감·인계와 위 항목을 완료로 적지 않는다.

## 외부에서 만들지 않은 것

Railway 프로젝트, R2 버킷, 배포, 과금 자원, 기존 GitHub/Railway/R2 변경은 하지 않았다.

## 사람이 할 일

1. JCI 명칭·로고·번들 아이디를 쓰기 전에 상표와 사용 허락을 확인한다. 확인 전에는 스토어에 올리지 않는다.
2. 앱스토어 담당자가 이용료 30,000원의 결제 위치(인앱 또는 외부 입금)를 현재 Apple/Google 가이드라인으로 결정한다. 결정 전 결제 UI를 추가하지 않는다.
3. 새 Railway 프로젝트와 PostgreSQL을 승인 후 만든다. 기존 회원수첩 프로젝트는 수정하지 않는다.
4. 비공개 R2 버킷 `jci-korea-media`와 키를 승인 후 만든다. `R2_PREFIX_ENV`를 dev와 prod로 다르게 둔다. 키 값은 저장소에 넣지 않는다.
5. 운영용 `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`을 발급한다. 예제 값을 운영에 쓰지 않는다.
6. 문자 인증을 넣을지 결정한다. 넣지 않으면 복구 코드 분실의 수동 검토 담당자를 정한다.
7. 개인정보 처리방침·이용약관 URL과 계정 삭제 담당을 정한다.
8. Apple Developer, Google Play, 테스트 배포(TestFlight 또는 내부 트랙) 계정을 연다.
9. 도커가 있는 개발 PC에서는 `docker compose up -d` 후 아래 실행 순서를 쓴다. 이 에이전트 환경은 호스트 PostgreSQL로 같은 마이그레이션을 적용했다.

## 로컬 실행

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/gathering-mobile/.env.example apps/gathering-mobile/.env
# 저장소 루트에도 DATABASE_URL 등이 필요하다. apps/api/.env.example 을 참고해 루트 .env 를 만든다.
# .env 는 커밋하지 않는다.

npm run db:generate
npm run db:migrate
npm run db:seed
npm test
npm run api:dev
npm run start -w @member/gathering-mobile
```

회원수첩 앱은 기존과 같이 `npm run mobile:start`다.

시드 계정 `01000001003` / `Passw0rd!` 는 회원수첩 회원이다. 모임 앱에서도 로그인되지만 프로필을 저장하기 전에는 모임을 만들 수 없다. 모임 전용 가입 계정은 회원수첩 로그인에서 `NO_MEMBERSHIP`이다.
