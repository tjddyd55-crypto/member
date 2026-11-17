/**
 * 보험 저장소 src/config/businessInfo.config.ts 의 공개 사업자 정보.
 * 이 앱의 약관·개인정보 초안만 이 값을 쓴다.
 */
export const businessInfo = {
  businessName: '올인원솔루션',
  representativeName: '박성용',
  businessRegistrationNumber: '232-51-00991',
  businessAddress: '서울특별시 광진구 천호대로114길 39 (능동)',
  businessEmail: 'tjddyd55@naver.com',
  customerServicePhone: '010-2222-1382',
  privacyOfficerName: '박성용',
  mailOrderRegistrationNumber: '제 2026-서울광진-1256 호',
} as const;

export const privacyPolicy = {
  title: '개인정보 처리방침 초안',
  notice: '법률 검토 전 초안입니다.',
  paragraphs: [
    `${businessInfo.businessName}(대표 ${businessInfo.representativeName}, 사업자등록번호 ${businessInfo.businessRegistrationNumber})가 모임 앱의 개인정보를 처리합니다.`,
    `주소 ${businessInfo.businessAddress}`,
    `연락 ${businessInfo.businessEmail} · ${businessInfo.customerServicePhone}`,
    `개인정보 보호책임자 ${businessInfo.privacyOfficerName}`,
    `수집 항목은 이름, 휴대폰 번호, 소속 로컬, 비밀번호, 모임 안에서 올린 사진·영상·영수증입니다. 문자 인증은 하지 않습니다.`,
    `전화번호와 이름은 그 모임 회원에게 명부, 전화, 문자로 쓰입니다. 다른 모임에는 보이지 않습니다.`,
    `장부, 영수증, 회계 스냅샷은 모임의 기록으로 남습니다. 계정을 삭제하면 이름과 전화번호 연결을 끊고, 금액과 일자는 지우지 않습니다. 회원수첩 자격이 있으면 회원수첩 계정은 이 화면에서 지우지 않습니다.`,
    `파일은 비공개 저장소에 두고 짧은 서명 주소로만 엽니다.`,
  ],
} as const;

export const termsPolicy = {
  title: '이용약관 초안',
  notice:
    '법률 검토 전 초안입니다. 스토어 결제 정책이 정해지기 전에는 앱 안에서 이용료를 걷지 않습니다.',
  paragraphs: [
    `${businessInfo.businessName}가 모임 앱을 제공합니다. 통신판매업 신고 ${businessInfo.mailOrderRegistrationNumber}.`,
    `모임은 회원이 만들고, 초대 링크로 참여합니다. 협의회장, 총무, 재무의 권한은 서버가 검사합니다.`,
    `사진과 영상은 모임 회원이 올리고, 다른 모임의 파일은 열 수 없습니다. 신고와 차단을 할 수 있고, 운영자가 검토합니다.`,
    `회계 마감 뒤의 장부와 영수증은 고칠 수 없습니다. 정정은 다음 해 거래로 남깁니다.`,
    `이용권은 모임 단위이며 이 앱 화면에 결제나 계좌를 두지 않습니다. 기간이 끝나면 이미 올린 파일은 볼 수 있고 새 사진·영상은 올릴 수 없습니다.`,
  ],
} as const;
