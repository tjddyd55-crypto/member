# 모임 앱 개발 빌드

이 문서는 `apps/gathering-mobile`의 EAS development 프로필이다. 이 환경에서 EAS 빌드는 실행하지 않았다.

## 프로필

`apps/gathering-mobile/eas.json`

- `development`: 개발 클라이언트. Android는 APK. iOS는 시뮬레이터. API 주소는 `http://127.0.0.1:3001`.
- `development-device`: 실기기용 내부 배포. Android는 APK. iOS는 시뮬레이터가 아니다. 기본 API 주소도 `http://127.0.0.1:3001`이라 실기기에서는 동작하지 않는다. 빌드 전에 같은 망의 개발 PC 주소나 배포된 API 주소로 바꾼다.

앱이 읽는 값은 `EXPO_PUBLIC_API_BASE_URL`이다. 개발 클라이언트는 Metro가 연 프로젝트에서 이 값을 다시 읽는다. `npm start`는 `eas.json` 프로필을 불러오지 않으므로, 실행 전에 `apps/gathering-mobile/.env`에 기기가 닿는 주소를 넣는다. 예제는 `apps/gathering-mobile/.env.example`이다. `eas.json`만 바꿔서는 이미 켜진 Metro의 요청 주소가 바뀌지 않는다.

## 사람이 할 일

1. Expo 계정으로 `npx eas login` 한다. 이 저장소에는 EAS projectId가 없다.
2. `apps/gathering-mobile`에서 `npx eas init`으로 프로젝트를 만들고, 나온 projectId를 `EXPO_PUBLIC_EAS_PROJECT_ID`에만 넣는다. 예제 파일의 주석 자리에 값을 커밋하지 않는다.
3. Android APK: `npx eas build --profile development --platform android`. Google Play 계정은 APK를 기기에 직접 설치할 때 필요 없다. Play 스토어 제출은 별도 계정과 상표 확인이 필요하다.
4. iOS 시뮬레이터: `npx eas build --profile development --platform ios`. 시뮬레이터 빌드는 Apple 배포 인증서 없이 받을 수 있다. Expo 계정은 필요하다.
5. iPhone 실기기: `development-device` 프로필과 Apple Developer 계정이 필요하다. 내부 배포 프로비저닝은 EAS가 안내하는 대로 사람이 승인한다.
6. 실기기 API 주소는 localhost가 아니다. 빌드 전에 `eas.json`의 `development-device.env.EXPO_PUBLIC_API_BASE_URL`을 배포된 API 또는 개발 PC의 LAN 주소로 바꾼다. Metro를 띄우기 전에도 같은 값을 `apps/gathering-mobile/.env`의 `EXPO_PUBLIC_API_BASE_URL`에 넣는다. 시뮬레이터만 `http://127.0.0.1:3001`을 쓴다.
7. 설치 뒤 가입, 초대, 행사, 사진 업로드, 장부, 인계, 계정 삭제를 Android와 iPhone에서 각각 확인한다.

번들 식별자는 아직 `app-identity.ts`의 임시 값이다. 스토어 제출 전에 상표와 사용 허락을 확인하고 그 파일만 바꾼다.
