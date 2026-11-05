# 모임 앱 개발 빌드

`apps/gathering-mobile`의 EAS 프로필이다. Expo 소유자는 `tjddyd55`이고 projectId는 `f5a017a3-82f8-4d73-bc8a-ecd249e994f3`이다. 이 값은 비밀이 아니다.

API 주소는 `https://api-development-46a6.up.railway.app`이다. 프로필 `env`의 `EXPO_PUBLIC_API_BASE_URL`과 `EXPO_PUBLIC_EAS_PROJECT_ID`에 들어 있다.

## 프로필

- `development`: 개발 클라이언트. JS는 Metro가 제공한다. Android는 APK, iOS는 시뮬레이터. `npx expo start`로 Metro를 켠 뒤에 연다. Metro는 `eas.json`을 읽지 않으므로, 로컬에서 다른 API를 쓰려면 `apps/gathering-mobile/.env`의 `EXPO_PUBLIC_API_BASE_URL`을 바꾼다.
- `development-device`: 실기기 개발 클라이언트. Android는 APK, iOS는 시뮬레이터가 아니다. 역시 Metro가 필요하다.
- `preview`: JS 번들이 들어 있는 내부 배포. Metro가 필요 없다. Android는 APK, iOS는 실기기다. `developmentClient`가 없다.

## 사람이 할 일

1. `apps/gathering-mobile`에서 `npx eas login` 한다. 계정은 `tjddyd55`다.
2. Android 개발 클라이언트: `npx eas build --profile development --platform android`. 설치 뒤 Metro를 켠다.
3. Android에서 Metro 없이 바로 실행: `npx eas build --profile preview --platform android`. Play 스토어 제출은 별도다.
4. iOS 시뮬레이터: `npx eas build --profile development --platform ios`. Apple 배포 인증서는 필요 없다.
5. iPhone 실기기 preview: `npx eas build --profile preview --platform ios`. Apple Developer 계정이 필요하다. 이 환경에서는 그 빌드를 실행하지 않는다.
6. 설치 뒤 가입, 초대, 행사, 사진 업로드, 장부, 인계, 계정 삭제를 확인한다.

번들 식별자는 `app-identity.ts`와 `app-identity.js`의 임시 값이다. 둘을 같이 바꾼다. 스토어 제출 전에 상표와 사용 허락을 확인한다.
