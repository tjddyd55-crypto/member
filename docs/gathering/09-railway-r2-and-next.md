# Railway, R2, 다음 기능 준비

실제 프로젝트, 데이터베이스, 버킷, 배포는 만들지 않았다. 회원수첩에 연결된 Railway 서비스도 변경하지 않는다.

## 나중에 만들 자원

모임 전용으로 새로 만든다.

- Railway 프로젝트 1개, PostgreSQL 1개. `DATABASE_URL`만 모임 API에 연결한다.
- Cloudflare R2 버킷 `jci-korea-media` 1개. 비공개. `R2_BUCKET`, `R2_PREFIX_ENV`(dev 또는 prod), `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. 기존 `STORAGE_*` 이름은 별칭이다.
- 리마인드용 `GATHERING_JOB_SECRET`, 필요 시 `EXPO_ACCESS_TOKEN`.

키 이름만 `apps/api/.env.example`에 있다. 값은 비어 있거나 로컬 예시이다.

## 파일 저장 코드

키는 `{접두사}/gatherings/{groupId}/events/{eventId}/photos|videos|receipts/{objectId}` 이다. 환경변수가 없으면 503이다. 변수가 있으면 S3 호환 서명 URL을 발급한다. 서명 요청이 실패하면 501이다. 이 저장소는 버킷을 만들지 않는다.

용량 규칙은 기존 `packages/gathering-domain`의 `evaluateUpload`를 업로드 구현 때 호출한다. 50GB는 사진·영상·영수증을 합친 십진 바이트이고, 만료로 파일을 지우지 않는다.

## 다음 구현 순서

1. 사진·영상 API와 앨범 화면은 연결했다. 실기기 업로드와 실제 R2 자격 증명은 아직이다.
2. 영수증과 행사 장부, 회비는 연결했다. 마감 후 영수증 잠금은 인계 PR에서 닫는다.
3. 인계: `GatheringHandover` 상태 `NOMINATED → ACCEPTED → FINALIZED`. 최종 승인은 스냅샷 한 트랜잭션과 `idempotencyKey`로 한 번만 닫는다. 회장 역할 변경은 그 전이 아니다.

결제 화면, 계좌번호, 외부 송금 안내는 정책 결정 전에 넣지 않는다. 요금은 모임당 연 30,000원, 누적 50GB, 회원 수 제한 없음, 자동결제 없음이다.
