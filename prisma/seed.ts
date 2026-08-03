import { PrismaClient, MembershipRole, MembershipStatus, PrivacyVisibility } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(phone: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { phone },
    update: { passwordHash, status: 'ACTIVE' },
    create: { phone, passwordHash, status: 'ACTIVE' },
  });
}

async function createLocalBundle(params: {
  districtId: string;
  name: string;
  code: string;
  slug: string;
  slogan: string;
  ownerPhone: string;
  adminPhone: string;
  memberPhones: string[];
  pendingPhone: string;
}) {
  const local = await prisma.local.upsert({
    where: { code: params.code },
    update: { name: params.name, slogan: params.slogan, isActive: true },
    create: {
      districtId: params.districtId,
      name: params.name,
      englishName: params.slug,
      code: params.code,
      slug: params.slug,
      slogan: params.slogan,
      primaryColor: '#1B3A6B',
      officePhone: '02-0000-0000',
      email: `office@${params.slug}.test`,
    },
  });

  const category = await prisma.membershipCategory.upsert({
    where: { id: `${local.id}-regular` },
    update: { name: '정회원' },
    create: {
      id: `${local.id}-regular`,
      localId: local.id,
      name: '정회원',
      shortName: '정',
      sortOrder: 1,
    },
  });

  await prisma.positionMaster.upsert({
    where: { id: `${local.id}-president` },
    update: { name: '회장' },
    create: {
      id: `${local.id}-president`,
      localId: local.id,
      name: '회장',
      groupName: '회장단',
      sortOrder: 1,
    },
  });

  const password = 'Passw0rd!';

  async function createMember(opts: {
    phone: string;
    name: string;
    role: MembershipRole;
    status: MembershipStatus;
    memberNumber: string;
    position?: string;
    companyName?: string;
    phonePrivate?: boolean;
  }) {
    const user = await upsertUser(opts.phone, password);
    const profile = await prisma.memberProfile.create({
      data: {
        localId: local.id,
        userId: user.id,
        memberNumber: opts.memberNumber,
        name: opts.name,
        hanjaName: '會員',
        phone: opts.phone,
        email: `${opts.phone}@example.test`,
        membershipCategoryId: category.id,
        currentPositionText: opts.position ?? '회원',
        status: opts.status === 'PENDING' ? 'PENDING' : 'ACTIVE',
        joinedAt: new Date('2020-01-01'),
        homeAddress: '서울특별시 광진구 가상로 1',
        hobby: '독서',
        specialty: '네트워킹',
        introduction: '개발용 가상 회원입니다.',
        adminMemo: '관리자 메모 — 일반 API 비노출',
      },
    });

    await prisma.memberCompany.create({
      data: {
        localId: local.id,
        memberProfileId: profile.id,
        companyName: opts.companyName ?? `${opts.name}상사`,
        position: '대표',
        industry: '서비스',
        address: '서울특별시 가상구 테스트로 10',
        isPrimary: true,
      },
    });

    await prisma.privacySetting.createMany({
      data: [
        {
          localId: local.id,
          memberProfileId: profile.id,
          fieldKey: 'phone',
          visibility: opts.phonePrivate ? PrivacyVisibility.PRIVATE : PrivacyVisibility.MEMBERS,
        },
        {
          localId: local.id,
          memberProfileId: profile.id,
          fieldKey: 'email',
          visibility: PrivacyVisibility.MEMBERS,
        },
        {
          localId: local.id,
          memberProfileId: profile.id,
          fieldKey: 'homeAddress',
          visibility: PrivacyVisibility.ADMINS,
        },
      ],
    });

    await prisma.localMembership.create({
      data: {
        userId: user.id,
        localId: local.id,
        memberProfileId: profile.id,
        role: opts.role,
        status: opts.status,
        joinedAt: new Date('2020-01-01'),
        approvedAt: opts.status === 'ACTIVE' ? new Date('2020-01-02') : null,
      },
    });

    return profile;
  }

  await createMember({
    phone: params.ownerPhone,
    name: `${params.name.replace('청년회의소', '')}소유`,
    role: 'LOCAL_OWNER',
    status: 'ACTIVE',
    memberNumber: 'M-001',
    position: '회장',
    companyName: '가상홀딩스',
  });

  await createMember({
    phone: params.adminPhone,
    name: `${params.name.replace('청년회의소', '')}관리`,
    role: 'LOCAL_ADMIN',
    status: 'ACTIVE',
    memberNumber: 'M-002',
    position: '사무국장',
  });

  let i = 3;
  for (const phone of params.memberPhones) {
    await createMember({
      phone,
      name: `김회원${params.code}${i}`,
      role: 'MEMBER',
      status: 'ACTIVE',
      memberNumber: `M-00${i}`,
      companyName: `주식회사 글로벌테스트${i}`,
      phonePrivate: i === 3,
    });
    i += 1;
  }

  await createMember({
    phone: params.pendingPhone,
    name: `이대기회원${params.code}`,
    role: 'MEMBER',
    status: 'PENDING',
    memberNumber: 'M-PENDING',
  });

  return local;
}

async function main() {
  await prisma.refreshSession.deleteMany();
  await prisma.privacySetting.deleteMany();
  await prisma.memberCompany.deleteMany();
  await prisma.memberFamily.deleteMany();
  await prisma.memberBusinessCard.deleteMany();
  await prisma.memberPositionHistory.deleteMany();
  await prisma.localMembership.deleteMany();
  await prisma.memberProfile.deleteMany();
  await prisma.positionMaster.deleteMany();
  await prisma.membershipCategory.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.fileObject.deleteMany();
  await prisma.documentProcessingJob.deleteMany();
  await prisma.printExportJob.deleteMany();
  await prisma.documentArticle.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.document.deleteMany();
  await prisma.notice.deleteMany();
  await prisma.event.deleteMany();
  await prisma.local.deleteMany();
  await prisma.user.deleteMany();
  await prisma.district.deleteMany();

  const district = await prisma.district.create({
    data: { name: '서울지구', code: 'SEOUL', sortOrder: 1 },
  });

  await createLocalBundle({
    districtId: district.id,
    name: '서울광진청년회의소',
    code: 'GWANGJIN',
    slug: 'seoul-gwangjin',
    slogan: '함께 성장하는 광진',
    ownerPhone: '01000001001',
    adminPhone: '01000001002',
    memberPhones: ['01000001003', '01000001004', '01000001005', '01000001006', '01000001007'],
    pendingPhone: '01000001099',
  });

  await createLocalBundle({
    districtId: district.id,
    name: '서울강남청년회의소',
    code: 'GANGNAM',
    slug: 'seoul-gangnam',
    slogan: '도전하는 강남',
    ownerPhone: '01000002001',
    adminPhone: '01000002002',
    memberPhones: ['01000002003', '01000002004', '01000002005', '01000002006', '01000002007'],
    pendingPhone: '01000002099',
  });

  console.log('Seed completed (virtual data only).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
