-- 관리자 계정은 모임 회원 테이블을 바꾸지 않는다.
CREATE TYPE "GatheringAdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN');

CREATE TABLE "gathering_admin_accounts" (
    "id" TEXT NOT NULL,
    "loginId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "GatheringAdminRole" NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "totpSecretCipher" TEXT,
    "totpConfirmedAt" TIMESTAMP(3),
    "passwordChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_admin_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gathering_admin_accounts_loginId_key" ON "gathering_admin_accounts"("loginId");

CREATE TABLE "gathering_admin_sessions" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_admin_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gathering_admin_sessions_tokenHash_key" ON "gathering_admin_sessions"("tokenHash");
CREATE INDEX "gathering_admin_sessions_adminId_idx" ON "gathering_admin_sessions"("adminId");

CREATE TABLE "gathering_admin_enrollments" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pendingSecretCipher" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_admin_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gathering_admin_enrollments_tokenHash_key" ON "gathering_admin_enrollments"("tokenHash");
CREATE INDEX "gathering_admin_enrollments_adminId_idx" ON "gathering_admin_enrollments"("adminId");

CREATE TABLE "gathering_admin_scopes" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_admin_scopes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gathering_admin_scopes_adminId_groupId_capability_key" ON "gathering_admin_scopes"("adminId", "groupId", "capability");
CREATE INDEX "gathering_admin_scopes_groupId_idx" ON "gathering_admin_scopes"("groupId");

CREATE TABLE "gathering_admin_audits" (
    "id" TEXT NOT NULL,
    "actorAdminId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_admin_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "gathering_admin_audits_createdAt_idx" ON "gathering_admin_audits"("createdAt");
CREATE INDEX "gathering_admin_audits_actorAdminId_createdAt_idx" ON "gathering_admin_audits"("actorAdminId", "createdAt");

ALTER TABLE "gathering_admin_sessions" ADD CONSTRAINT "gathering_admin_sessions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_admin_enrollments" ADD CONSTRAINT "gathering_admin_enrollments_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_admin_scopes" ADD CONSTRAINT "gathering_admin_scopes_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_admin_scopes" ADD CONSTRAINT "gathering_admin_scopes_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "gathering_admin_audits" ADD CONSTRAINT "gathering_admin_audits_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "gathering_admin_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
