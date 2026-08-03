# Figma ↔ 앱 라우트 맵

Figma: https://www.figma.com/design/Ren9cwgy3gdJuwghg0P9TX

## 1차 구현

| Figma | Route |
|-------|-------|
| AUTH_01_Splash | `/` (index redirect) |
| AUTH_03_Login_Default / AUTH_04_Login_Error | `/(auth)/login` |
| JOIN_09 Pending 성격 | `/(auth)/join/pending` |
| HOME_01_Member / HOME_02_Admin | `/(app)/(tabs)/home` |
| MEMBER_01_List | `/(app)/(tabs)/members` |
| MEMBER_04_Detail (파일 실명) | `/(app)/members/[memberId]` |
| MY_01_Home | `/(app)/(tabs)/profile` |

## 전체 계획 (후속)

| Figma | Route |
|-------|-------|
| SCHEDULE_01_Calendar | `/(app)/(tabs)/schedule` |
| DOC_01_Home | `/(app)/(tabs)/documents` |
| MEMBER business-card / officers / past-presidents | `/(app)/members/...` |
| ADMIN_MEMBER_* | `/(app)/admin/members/...` |
| ADMIN_OFFICER_* | `/(app)/admin/officers/...` |
| ADMIN_SCHEDULE_* / ADMIN_NOTICE_* | `/(app)/admin/content/...` |
| ADMIN_DOC_* | `/(app)/admin/documents/...` |
| ADMIN_PRINT_* | `/(app)/admin/print/...` |
| LOCAL_SETTINGS_* | `/(app)/admin/local-settings/...` |
| ADMIN_PERMISSION_* | `/(app)/admin/permissions/...` |

미구현 라우트는 개발 환경에서만 “다음 단계에서 제공” placeholder를 표시한다.
