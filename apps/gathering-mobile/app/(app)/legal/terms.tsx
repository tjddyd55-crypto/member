import { router } from 'expo-router';
import { businessInfo } from '../../../src/legal/business-info';
import { Body, Button, Notice, Screen, Title } from '../../../src/design/ui';

export default function TermsScreen() {
  return (
    <Screen>
      <Title>이용약관 초안</Title>
      <Notice>법률 검토 전 초안입니다. 스토어 결제 정책이 정해지기 전에는 앱 안에서 이용료를 걷지 않습니다.</Notice>
      <Body>{`${businessInfo.businessName}가 모임 앱을 제공합니다. 통신판매업 신고 ${businessInfo.mailOrderRegistrationNumber}.`}</Body>
      <Body>모임은 회원이 만들고, 초대 링크로 참여합니다. 협의회장, 총무, 재무의 권한은 서버가 검사합니다.</Body>
      <Body>사진과 영상은 모임 회원이 올리고, 다른 모임의 파일은 열 수 없습니다. 신고와 차단을 할 수 있고, 운영자가 검토합니다.</Body>
      <Body>회계 마감 뒤의 장부와 영수증은 고칠 수 없습니다. 정정은 다음 해 거래로 남깁니다.</Body>
      <Body>이용권은 모임 단위이며 이 앱 화면에 결제나 계좌를 두지 않습니다. 기간이 끝나면 이미 올린 파일은 볼 수 있고 새 사진·영상은 올릴 수 없습니다.</Body>
      <Button label="뒤로" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
