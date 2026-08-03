# 권한 모델

## 1차 역할

| Role | 설명 |
|------|------|
| MEMBER | 일반 회원 |
| LOCAL_ADMIN | 로컬 관리자 |
| LOCAL_OWNER | 최고관리자 |

앱 하단 탭은 역할과 무관하게 동일하다. 관리자는 홈/내정보에서 관리자 메뉴로 진입한다.

## 향후 세부 권한 (확장 지점)

`MEMBER_READ`, `MEMBER_WRITE`, `MEMBER_APPROVE`, `OFFICER_MANAGE`, `EVENT_MANAGE`, `NOTICE_MANAGE`, `DOCUMENT_MANAGE`, `PRINT_EXPORT`, `LOCAL_SETTINGS_MANAGE`, `ADMIN_MANAGE`

1차는 역할 기반(`requireRole`)만 구현하고, 세부 권한 테이블/체크는 훅만 남긴다.

## 멤버십 상태

| Status | 앱 접근 |
|--------|---------|
| PENDING | Pending 화면만 |
| ACTIVE | 정상 |
| REJECTED / SUSPENDED / WITHDRAWN | 차단 |

## 개인정보

`PrivacySetting.visibility`: `MEMBERS` | `ADMINS` | `PRIVATE`  
목록/상세 API는 공개 설정을 반영한다. `adminMemo`는 일반 회원 API에 노출하지 않는다.
