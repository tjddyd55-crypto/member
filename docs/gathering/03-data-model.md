# 모임관리 데이터 모델

Prisma 모델은 `prisma/schema.prisma` 하단 모임 구역이다. 물리 테이블은 `gathering_` 접두사다. 모든 모임 데이터는 `groupId`를 가지고 외래 키와 인덱스가 있다. 계정만 기존 `User`를 참조한다.

| 지시문 엔터티             | Prisma 모델                     | 1단계 사용                                         |
| ------------------------- | ------------------------------- | -------------------------------------------------- |
| User                      | `User` + `GatheringProfile`     | 가입·로그인. 이름은 프로필에만 둔다                |
| UserLocalAffiliation      | `GatheringLocalAffiliation`     | 가입 시 소속 로컬 문자열                           |
| Group                     | `GatheringGroup`                | 생성·조회·초대 승인 설정                           |
| GroupMembership           | `GatheringMembership`           | 참여, 승인 대기, 거절                              |
| GroupInvite               | `GatheringInvite`               | 토큰 해시만 저장                                   |
| GroupRoleAssignment       | `GatheringRoleAssignment`       | 부여·해제 이력. `revokedAt`이 없으면 현재 역할     |
| ExecutiveTerm             | `GatheringExecutiveTerm`        | 회장·총무·재무·추가 집행부 임기                    |
| Event                     | `GatheringEvent`                | 스키마만                                           |
| EventAttendance           | `GatheringEventAttendance`      | 스키마만                                           |
| MediaAsset                | `GatheringMediaAsset`           | 스키마만. 크기, 체크섬, 업로더, 행사, 보존 플래그  |
| MediaReport               | `GatheringMediaReport`          | 스키마만                                           |
| FinanceYear               | `GatheringFinanceYear`          | 모임 생성 시 열린 해 1행                           |
| FinanceTransaction        | `GatheringFinanceTransaction`   | 스키마만. `amountWon`은 정수, `paidAt`이 귀속 기준 |
| MemberDue                 | `GatheringMemberDue`            | 스키마만                                           |
| ReceiptAsset              | `GatheringReceiptAsset`         | 스키마만. `immutable`, 버전, 해시                  |
| FinanceCloseSnapshot      | `GatheringFinanceCloseSnapshot` | 스키마만. 본문 JSON과 해시                         |
| Handover                  | `GatheringHandover`             | 스키마만. `idempotencyKey` 자리                    |
| SubscriptionEntitlement   | `GatheringSubscription`         | 스키마만                                           |
| SubscriptionApprovalAudit | `GatheringSubscriptionAudit`    | 스키마만                                           |
| PushToken                 | `GatheringPushToken`            | 스키마만                                           |
| Notification              | `GatheringNotification`         | 스키마만. `dedupeKey`                              |
| AuditLog                  | `GatheringAuditLog`             | 가입, 로그인, 복구, 모임, 초대, 역할               |
| (지시문 밖)               | `GatheringSession`              | 리프레시 토큰 해시. 회원수첩 세션과 분리           |
| (지시문 밖)               | `GatheringRecoveryCode`         | 복구 코드 해시. 평문은 발급 응답 한 번             |
| (지시문 밖)               | `GatheringRecoveryRequest`      | 코드가 없을 때의 수동 검토. 자동 승인 없음         |

`User.phone` 유니크가 중복 가입을 막는다. 회원수첩에 이미 있는 번호로 모임 가입을 하면 409다. 그 사람은 모임 로그인 후 프로필을 채운다.

미디어와 영수증의 `sizeBytes`는 `BigInt`다. 50GB 합계가 32비트 정수를 넘기 때문이다.
