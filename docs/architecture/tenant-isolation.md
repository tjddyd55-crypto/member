# 로컬(Tenant) 격리

## 용어

- 제품 용어: **Local**
- 기술적으로는 multi-tenant 격리와 동일
- 코드·스키마에서는 `localId`를 우선 사용

## 규칙

1. 로컬 소유 데이터는 반드시 `localId`를 가진다.
2. `localId`는 로그인 사용자의 **active LocalMembership**에서 결정한다.
3. 요청 body/query의 `localId`를 권한 근거로 **사용하지 않는다**.
4. 일반 API는 `request.auth.localId`로 자동 제한한다.
5. 시스템 운영 권한은 로컬 관리자 API와 분리한다. (1차 미구현)
6. 다른 로컬 ID를 주입해도 조회·수정·삭제할 수 없다.
7. 단건 조회 실패는 **존재 여부를 노출하지 않고 404**로 통일한다.

## 금지 / 권장

금지:

```ts
prisma.memberProfile.findMany({ where: { localId: request.query.localId } });
prisma.memberProfile.findUnique({ where: { id } });
```

권장:

```ts
prisma.memberProfile.findMany({
  where: { localId: request.auth.localId, deletedAt: null },
});
prisma.memberProfile.findFirst({
  where: { id, localId: request.auth.localId, deletedAt: null },
});
```

공통 helper: `apps/api/src/lib/local-scope.ts`

## 테스트 필수

- 로컬 A 회원이 로컬 B 회원 단건 조회 → 404
- query/body에 다른 localId를 넣어도 무시·차단
- Seed에 교차 검증용 두 로컬 필수
