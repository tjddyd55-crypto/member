# 관리자 웹

`apps/gathering-admin`은 Vite와 React로 만든 화면이다. 숫자는 `/api/gathering-admin` 응답만 보여 준다. 이 문서는 이름과 순서만 적는다. 비밀 값은 만들지 않고 적지 않는다.

## 지금 Development

프로젝트 `jci-korea` `ab078792-d0ff-4cd6-a5ad-31c62cd8ce26`

| 구분 | ID |
| --- | --- |
| Development | `7bc59691-18bc-4fc6-922f-4c5f90eee828` |
| API 서비스 | `f5b14779-0b73-4fc7-a20c-d4c564353827` |
| Postgres | `3675af02-9ed7-453c-87de-00d392a2f50e` |

API는 저장소 루트에서 `npm run start -w @member/api`로 뜨고 `/health`가 200이다. `feature/mobile-member-book-foundation`에 병합되면 이 Development API가 배포되고, 배포 전에 `npm run db:migrate:deploy`가 대기 중인 마이그레이션을 적용한다. 지금 배포된 커밋은 `4f7c7352`다. 관리자 풀리퀘스트는 리뷰와 환경 변수가 준비되기 전에는 foundation에 넣지 않는다. Production은 대상이 아니다. 별도 관리자 서비스는 아직 없다. 앱 서비스도 같은 Development 데이터베이스를 쓴다. 새 데이터베이스는 만들지 않는다.

## 로컬 실행

API를 3001에 띄운 뒤 관리 화면은 다음이다.

```bash
npm install
npm run dev -w @member/gathering-admin
```

브라우저는 `http://127.0.0.1:5174` 이다. Vite가 `/api`를 `http://127.0.0.1:3001`로 넘긴다. PC와 좁은 화면은 같은 주소다.

## API 서비스에 부모가 넣을 이름

값은 운영자가 Development API 서비스에만 넣는다. 채팅, 로그, 아티팩트에 값을 남기지 않는다.

| 이름 | 목적 | 형식 |
| --- | --- | --- |
| `GATHERING_ADMIN_TOTP_KEY` | 관리자 TOTP 비밀을 서버에 암호화해 저장 | 16자 이상. 첫 등록 전에 있어야 한다. |
| `GATHERING_ADMIN_BOOTSTRAP_LOGIN` | 최초 슈퍼관리자 아이디 | 영문, 숫자, `.`, `_`, `-`. 3자 이상 64자 이하 |
| `GATHERING_ADMIN_BOOTSTRAP_PASSWORD` | 최초 슈퍼관리자 비밀번호. 명령 한 번 | 12자 이상 |

순서:

1. 위 세 이름을 Development API 서비스에 넣는다. 웹 서비스나 Production에는 넣지 않는다.
2. 리뷰가 끝난 뒤에만 foundation 병합으로 API를 배포한다. 마이그레이션은 그 배포의 `db:migrate:deploy`가 추가만 한다.
3. API 서비스에서 `npx tsx scripts/gathering-admin-bootstrap.ts`를 한 번 실행한다. 출력은 계정을 만들었는지, 이미 있는지만 말한다.
4. 관리 화면에서 그 아이디로 로그인한다. 인증 앱 등록 화면이 비밀을 한 번 보여 준다. 그 화면이 운영자에게 넘기는 자리다. 서버 로그에는 비밀이 없다.
5. 코드를 확인하면 세션 쿠키가 생긴다. 이후 로그인에는 인증 코드가 필요하다.

## 관리 웹을 따로 둘 때

부모가 Development에만 서비스를 만들 수 있다. 서비스의 루트 디렉터리는 저장소 루트다. `apps/gathering-admin`만 컨텍스트로 쓰면 상위 `package-lock.json`이 없어 workspace 설치가 되지 않는다. Dockerfile 경로는 `apps/gathering-admin/Dockerfile`이다.

```bash
docker build -f apps/gathering-admin/Dockerfile -t gathering-admin .
docker run --rm -p 8080:80 -e API_UPSTREAM=https://api-development-46a6.up.railway.app gathering-admin
```

`/health`는 `ok`다. 웹은 API와 같은 Postgres에 직접 붙지 않는다.

| 이름 | 목적 | 형식 |
| --- | --- | --- |
| `API_UPSTREAM` | nginx가 `/api`를 넘길 API 주소 | `http://` 또는 `https://`로 시작하고 경로 없음 |
| `VITE_API_BASE_URL` | 빌드 때 브라우저가 부를 API. nginx를 쓰면 비운다 | 절대 URL 또는 빈 값 |

## 아직 자동으로 막지 않는 것

모임을 지우고 같은 이름으로 다시 만들어 체험을 반복하는 경우는 구분하지 않는다. 이름이나 휴대폰이 같다고 다른 모임의 체험을 거절하지 않는다.
