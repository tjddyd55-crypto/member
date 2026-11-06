import { bootstrapSuperAdmin } from '../apps/api/src/modules/gathering/admin/bootstrap.js';
import { prisma } from '../apps/api/src/lib/prisma.js';

// 저장소 루트 package.json 은 CommonJS다. tsx 가 이 파일을 CJS로 바꾸므로 top-level await 를 쓰지 않는다.
main().catch(() => {
  console.error('슈퍼관리자 초기 계정을 만들지 못했습니다.');
  process.exit(1);
});

async function main() {
  const loginId = process.env.GATHERING_ADMIN_BOOTSTRAP_LOGIN ?? '';
  const password = process.env.GATHERING_ADMIN_BOOTSTRAP_PASSWORD ?? '';
  if (!loginId || !password) {
    console.error('GATHERING_ADMIN_BOOTSTRAP_LOGIN과 GATHERING_ADMIN_BOOTSTRAP_PASSWORD가 필요합니다.');
    process.exit(1);
  }
  const result = await bootstrapSuperAdmin({ loginId, password });
  console.log(result.created ? '슈퍼관리자 계정을 만들었습니다.' : '슈퍼관리자가 이미 있습니다.');
  await prisma.$disconnect();
}
