# 표시 이름, 번들 식별자, 실기기

표시 이름은 `JCI KOREA` 한 곳이다. 상수 파일은 `apps/gathering-mobile/app-identity.ts`이고 `app.config.ts`와 화면 문구가 그 값을 쓴다. 이 이름은 공식 승인이나 제휴를 뜻하지 않는다. JCIM이라는 표기는 쓰지 않는다.

회원수첩 앱(`apps/mobile`)의 표시 이름은 그대로 둔다. 두 모듈을 한 스토어 앱으로 합치기 전에 회원수첩 이름을 바꾸지 않는다.

## 임시 번들 식별자

`PROVISIONAL_IOS_BUNDLE_ID`와 `PROVISIONAL_ANDROID_PACKAGE`만 수정한다. 다른 파일에 식별자를 복사하지 않는다.

스토어 제출 전 절차:

1. 상표와 사용 허락을 확인한다. 허락 전에는 제출하지 않는다.
2. `app-identity.ts`의 두 상수를 확정 식별자로 바꾼다.
3. Apple Developer와 Google Play에 그 식별자로 앱을 등록한다.
4. `EXPO_PUBLIC_EAS_PROJECT_ID`를 모임 앱 `.env`에 넣는다. 예제 파일에는 값을 비워 둔다.
5. 개발 빌드를 실기기에 설치해 로그인, 모임, 행사, 참석, 알림 권한을 확인한다.

## 실기기에서 볼 것

이 환경에서는 Android/iOS 기기를 실행하지 못했다. 아래는 사람이 할 확인이다.

```bash
cp apps/gathering-mobile/.env.example apps/gathering-mobile/.env
npm run api:dev
npm run start -w @member/gathering-mobile
```

1. Expo Go 또는 개발 빌드로 Android와 iPhone에 설치한다.
2. 가입 → 복구 코드 기록 → 모임 생성 → 초대 → 다른 기기에서 참여.
3. 회장 또는 총무가 행사를 만들고, 회원이 참석/불참/미정을 바꾼다.
4. 전체 일정에 자기 모임 행사만 보이는지 확인한다.
5. 알림 권한을 거절하면 앱이 계속 동작하는지, 허용하면 토큰 등록이 실패해도 화면이 멈추지 않는지 확인한다.
6. 푸시가 실제로 도착하는지는 EAS projectId와 실기기 빌드가 있어야 한다. Expo Go만으로는 토큰 발급이 실패할 수 있다.
7. 사진, 영수증, 장부, 인계 화면은 아직 없다. 그 탭에 미구현 안내가 있는 것은 정상이다.

리마인드 작업은 `POST /api/gathering/jobs/reminders`와 헤더 `x-gathering-job-secret`이다. `GATHERING_JOB_SECRET`이 없으면 이 경로는 404다. 스케줄러는 사람이 Railway에 따로 연결한다. 이번 작업에서 Railway 자원은 만들지 않았다.
