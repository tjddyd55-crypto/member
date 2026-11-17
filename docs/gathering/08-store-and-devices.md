# JCI KOREA 스토어 출시와 실기기 확인

표시 이름은 `JCI KOREA`이며 이름 사용 허락을 받았다. iOS bundleIdentifier와 Android package는 모두 `kr.jcikorea.app`이다. `apps/gathering-mobile/app-identity.ts`와 Node 설정용 `app-identity.js`의 `IOS_BUNDLE_ID` / `ANDROID_PACKAGE`를 같게 유지한다. 회원수첩 앱(`apps/mobile`)은 변경하지 않는다.

`kr.jcikorea.app`은 이전 `kr.gathering.mobile` 개발 빌드와 다른 앱으로 설치된다. 기존 설치의 세션·로컬 저장값을 공유하지 않는다.

## 운영 빌드와 제출

앱 버전은 `1.0.0`. EAS `cli.appVersionSource: remote`와 production의 `autoIncrement: true`로 iOS buildNumber / Android versionCode를 관리한다. 기존 development / development-device / preview 프로필은 유지한다.

production은 store 배포, Android AAB, iOS 실기기 빌드이며 다음 값을 쓴다.

- API: `https://gathering-api-production.up.railway.app`
- EAS project ID: `f5a017a3-82f8-4d73-bc8a-ecd249e994f3`
- expo-updates를 사용하지 않아 channel은 설정하지 않는다.

`apps/gathering-mobile`에서 실행한다.

```bash
npx eas-cli build -p android --profile production
npx eas-cli build -p ios --profile production
npx eas-cli submit -p android --profile production --latest
npx eas-cli submit -p ios --profile production --latest
```

사용자가 준비할 사항:

1. Apple Developer 계정과 권한. Apple ID는 `eas build` / `eas submit` 프롬프트에서 직접 입력하며 `eas.json`에 저장하지 않는다. iOS 빌드 시 로그인해 배포 인증서와 프로비저닝을 설정한다.
2. Apple Developer App ID는 `kr.jcikorea.app`이며 Push Notifications capability를 사용한다. App Store Connect 앱은 `JCI KOREA`, `ascAppId`는 `6835749438`, 개인(Individual) 계정 Team은 `HVK2UWPBY9`다. `eas.json`의 `submit.production.ios`에는 이 `ascAppId`와 `appleTeamId`가 설정되어 있다.
3. Play Console에서 package `kr.jcikorea.app` 앱을 만든다. **첫 AAB는 Play Console에서 수동 업로드**한다. 이후 자동 제출용 서비스 계정에 Play Console 권한을 부여하고 JSON 키를 `apps/gathering-mobile/secrets/play-service-account.json`에 둔다. secrets 디렉터리는 gitignore 대상이며 키를 커밋하지 않는다.
4. Android 자동 제출은 internal 트랙의 draft 상태다. 각 스토어의 앱 설명, 스크린샷, 개인정보/Data safety, 심사 계정, 연령 등급을 작성하고 최종 제출한다.

## 권한과 공식 로고

사진 권한 문구는 `행사 사진과 영상을 올리기 위해 사진 보관함에 접근합니다.`이다. iOS의 사진 접근 요청은 유지하며 카메라, 마이크, 사진 보관함 추가 권한을 선언하지 않는다.

Android 사진·영상·영수증 선택은 `launchImageLibraryAsync`의 시스템 Photo Picker를 사용한다(이전 Android는 Play services 백포트). 미디어/저장소 권한 없이 선택한 URI의 임시 접근 권한을 사용한다. 앱에는 MediaLibrary나 보관함 저장·전체 미디어 검색 기능이 없으며 `prepare.ts`는 선택 URI를 앱 캐시에 복사해 처리·업로드한다. 따라서 Android 12 이하도 READ_EXTERNAL_STORAGE가 필요 없다. Android에서는 공통 `canOpenMediaPicker`가 `requestMediaLibraryPermissionsAsync` 호출을 건너뛰어 권한 거부로 선택기가 막히지 않게 한다. iOS/웹의 기존 권한 확인은 유지한다.

명시적으로 요청하는 Android 권한은 POST_NOTIFICATIONS다. READ_MEDIA_IMAGES, READ_MEDIA_VIDEO, READ_MEDIA_VISUAL_USER_SELECTED, READ_MEDIA_AUDIO, READ_EXTERNAL_STORAGE, WRITE_EXTERNAL_STORAGE, RECORD_AUDIO, CAMERA, SYSTEM_ALERT_WINDOW는 모두 blockedPermissions로 제거한다. 실제 네이티브 빌드에는 네트워크·알림 등 라이브러리 권한이 추가될 수 있다. `npx expo config --type introspect`의 androidManifest에서 `tools:node="remove"` 항목은 부여되는 권한이 아닌 병합 제거 지시문이다. Play 제출용 AAB의 최종 Manifest도 확인한다. 이번 introspect 검증에서 제거 지시문을 제외한 병합 Manifest 권한은 `android.permission.INTERNET`, `android.permission.VIBRATE`, `android.permission.POST_NOTIFICATIONS`이며, 위 차단 권한은 모두 `tools:node="remove"`로 확인했다.

Android 12 이하 및 13+에서 미디어 권한을 부여하지 않은 상태로 사진·영상과 영수증 선택, 취소, 업로드를 실기기에서 확인한다.

iOS 비면제 암호화 사용 여부는 false, supportsTablet은 false다. expo-splash-screen 패키지가 설치되어 있지 않아 top-level splash를 사용한다.

Korea/TM 없는 JCI와 방패를 `assets/icon.png`, `adaptive-icon.png`, `splash-icon.png`와 Play 스토어 feature graphic에 적용했다. 앱 아이콘과 splash는 1024×1024 RGB 이미지이며, 로고 너비는 760px이다. feature graphic은 1024×500 이미지에 로고 너비 640px을 사용한다. 모두 남색 `#130F2D` 배경 중앙에 로고를 배치하며, adaptive 아이콘은 안전 영역에 맞춘 크기를 사용한다. notification은 96×96 RGBA 흰색 방패/투명 배경이고 알림 색상은 `#0097D7`이다.

원본은 `apps/gathering-mobile/assets/brand/jci-korea-logo-source.png`이다. Pillow와 numpy를 설치한 환경에서 저장소 루트 기준으로 재생성한다:

```bash
python3 apps/gathering-mobile/scripts/generate-brand-assets.py
# Play 스토어 출력 디렉터리 지정:
python3 apps/gathering-mobile/scripts/generate-brand-assets.py /tmp/jci-store-assets
```

앱 이미지 네 개는 스크립트 기준 `../assets`에 저장한다. Play 스토어 feature graphic(1024×500)과 아이콘(512×512)은 지정한 출력 디렉터리에 저장하며, 기본값 `./store-assets-out`은 gitignore 대상이다.

## 공개 법적 고지와 심사 동선

API 배포 후 사용할 URL:

- https://gathering-api-production.up.railway.app/legal/privacy
- https://gathering-api-production.up.railway.app/legal/terms
- https://gathering-api-production.up.railway.app/legal/account-deletion

인증·DB 조회 없는 한국어 HTML이다. 개인정보와 약관은 `packages/contracts/src/gathering-legal.ts`를 앱과 API가 공유한다. 기존 운영자 이메일 `tjddyd55@naver.com`을 삭제 문의에도 사용한다. 사업자 정보가 실제 운영 주체와 맞는지 확인해야 하며 정책은 여전히 법률 검토 전 초안이다. 검토 결과 기존 스플래시·로그인 등의 DISCLAIMER에는 공식 승인·제휴를 부인하는 문구가 남아 있다. 이름 사용 허락과 별개로 이 화면 문구의 최종 표현을 운영자가 확인해야 한다. 삭제 후 남는 모임 기록과 내부 이력에 자동 삭제 기한이 없는 현재 동작을 공개 안내에 명시했다. 실제 보존 기간 확정은 운영자가 해야 한다.

개인정보·약관은 로그인 화면의 링크 또는 `/legal/privacy`, `/legal/terms`로 로그인 없이 접근한다. 계정 삭제는 `로그인 → 내 모임 → 내 정보 및 설정 → 계정 삭제 → 장부 보존에 동의 → 비밀번호 입력 → 삭제`다. 기존에는 프로필 등록 후 프로필 진입 버튼이 사라져, 내 모임에 항상 보이는 설정 진입 버튼을 추가했다. 회장은 먼저 인계해야 한다.

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
7. 사진, 영수증, 장부, 인계, 계정 삭제는 개발 빌드에서 확인한다. 설치 절차는 `11-dev-builds.md`이다.

리마인드 작업은 `POST /api/gathering/jobs/reminders`와 헤더 `x-gathering-job-secret`이다. `GATHERING_JOB_SECRET`이 없으면 이 경로는 404다. 스케줄러는 사람이 Railway에 따로 연결한다. 이번 작업에서 Railway 자원은 만들지 않았다.
