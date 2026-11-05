# Railway, R2, 다음 기능 준비

실제 프로젝트, 데이터베이스, 버킷, 배포는 만들지 않았다. 회원수첩에 연결된 Railway 서비스도 변경하지 않는다.

## 나중에 만들 자원

모임 전용으로 새로 만든다.

- Railway 프로젝트 1개, PostgreSQL 1개. `DATABASE_URL`만 모임 API에 연결한다.
- Cloudflare R2 버킷 1개. 비공개. `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`.
- 리마인드용 `GATHERING_JOB_SECRET`, 필요 시 `EXPO_ACCESS_TOKEN`.

키 이름만 `apps/api/.env.example`에 있다. 값은 비어 있거나 로컬 예시이다.

## 파일 저장 코드

`apps/api/src/modules/gathering/storage/r2.ts`는 키 형식 `gathering/{groupId}/{media|receipt}/{objectId}`만 정한다. 환경변수가 없으면 503이다. 변수가 있어도 서명 URL은 501이다. 버킷이 없으므로 업로드 API는 열지 않았다.

용량 규칙은 기존 `packages/gathering-domain`의 `evaluateUpload`를 업로드 구현 때 호출한다. 50GB는 사진·영상·영수증을 합친 십진 바이트이고, 만료로 파일을 지우지 않는다.

## 다음 구현 순서

스키마는 이미 있다. API는 없다.

1. 사진·영상: `GatheringMediaAsset`. 회원 업로드, 본인 또는 회장·총무 삭제, 신고는 `GatheringMediaReport`. 행사 마감이 업로드를 잠그지 않는다.
2. 영수증: `GatheringReceiptAsset`. 행사 단위. 열린 해는 재무만 삭제. 마감 후 `immutable`.
3. 회계: `GatheringFinanceTransaction.paidAt`으로 회계연도를 정한다. 금액은 정수 원. 회비는 `GatheringMemberDue`.
4. 인계: `GatheringHandover` 상태 `NOMINATED → ACCEPTED → FINALIZED`. 최종 승인은 스냅샷 한 트랜잭션과 `idempotencyKey`로 한 번만 닫는다. 회장 역할 변경은 그 전이 아니다.

결제 화면, 계좌번호, 외부 송금 안내는 정책 결정 전에 넣지 않는다. 요금은 모임당 연 30,000원, 누적 50GB, 회원 수 제한 없음, 자동결제 없음이다.
