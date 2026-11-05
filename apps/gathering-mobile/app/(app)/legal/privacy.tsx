import { router } from 'expo-router';
import { businessInfo } from '../../../src/legal/business-info';
import { Body, Button, Notice, Screen, Title } from '../../../src/design/ui';

export default function PrivacyScreen() {
  return (
    <Screen>
      <Title>개인정보 처리방침 초안</Title>
      <Notice>법률 검토 전 초안입니다. 모임 앱의 공식 승인이나 제휴를 뜻하지 않습니다.</Notice>
      <Body>{`${businessInfo.businessName}(대표 ${businessInfo.representativeName}, 사업자등록번호 ${businessInfo.businessRegistrationNumber})가 모임 앱의 개인정보를 처리합니다.`}</Body>
      <Body>주소 {businessInfo.businessAddress}</Body>
      <Body>연락 {businessInfo.businessEmail} · {businessInfo.customerServicePhone}</Body>
      <Body>개인정보 보호책임자 {businessInfo.privacyOfficerName}</Body>
      <Body>수집 항목은 이름, 휴대폰 번호, 소속 로컬, 비밀번호, 모임 안에서 올린 사진·영상·영수증입니다. 문자 인증은 하지 않습니다.</Body>
      <Body>전화번호와 이름은 그 모임 회원에게 명부, 전화, 문자로 쓰입니다. 다른 모임에는 보이지 않습니다.</Body>
      <Body>장부, 영수증, 회계 스냅샷은 모임의 기록으로 남습니다. 계정을 삭제하면 이름과 전화번호 연결을 끊고, 금액과 일자는 지우지 않습니다. 회원수첩 자격이 있으면 회원수첩 계정은 이 화면에서 지우지 않습니다.</Body>
      <Body>파일은 비공개 저장소에 두고 짧은 서명 주소로만 엽니다.</Body>
      <Button label="뒤로" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
