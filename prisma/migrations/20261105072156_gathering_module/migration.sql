-- CreateEnum
CREATE TYPE "GatheringMembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "GatheringRole" AS ENUM ('PRESIDENT', 'SECRETARY', 'TREASURER', 'EXECUTIVE', 'MEMBER');

-- CreateEnum
CREATE TYPE "GatheringAttendance" AS ENUM ('ATTENDING', 'DECLINED', 'UNDECIDED');

-- CreateEnum
CREATE TYPE "GatheringEventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GatheringObjectStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "GatheringMediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "GatheringReportStatus" AS ENUM ('OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "GatheringEntryDirection" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "GatheringDueStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "GatheringFinanceYearStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "GatheringHandoverStatus" AS ENUM ('NOMINATED', 'ACCEPTED', 'FINALIZED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GatheringSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "GatheringSubscriptionSource" AS ENUM ('PAID', 'COMPLIMENTARY');

-- CreateEnum
CREATE TYPE "GatheringRecoveryStatus" AS ENUM ('OPEN', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "GatheringPushPlatform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "GatheringNotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "gathering_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "directoryConsentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_local_affiliations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localJcName" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_local_affiliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_groups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "inviteRequiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_memberships" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "GatheringMembershipStatus" NOT NULL DEFAULT 'PENDING',
    "directoryConsentAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_invites" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "requiresApproval" BOOLEAN NOT NULL,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_role_assignments" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GatheringRole" NOT NULL,
    "title" TEXT,
    "assignedByUserId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "gathering_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_executive_terms" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "GatheringRole" NOT NULL,
    "title" TEXT,
    "fiscalYear" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_executive_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_events" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "place" TEXT,
    "description" TEXT,
    "status" "GatheringEventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_event_attendances" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "GatheringAttendance" NOT NULL DEFAULT 'UNDECIDED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_event_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_media_assets" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "uploaderUserId" TEXT NOT NULL,
    "kind" "GatheringMediaKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "status" "GatheringObjectStatus" NOT NULL DEFAULT 'PENDING',
    "retentionHold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_media_reports" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "GatheringReportStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_media_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_finance_years" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "GatheringFinanceYearStatus" NOT NULL DEFAULT 'OPEN',
    "openingBalanceWon" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_finance_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_finance_transactions" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "financeYearId" TEXT NOT NULL,
    "direction" "GatheringEntryDirection" NOT NULL,
    "label" TEXT NOT NULL,
    "amountWon" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_finance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_member_dues" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financeYearId" TEXT NOT NULL,
    "amountWon" INTEGER NOT NULL,
    "paidAmountWon" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "status" "GatheringDueStatus" NOT NULL DEFAULT 'UNPAID',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_member_dues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_receipt_assets" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "financeYearId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "checksum" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "immutable" BOOLEAN NOT NULL DEFAULT false,
    "status" "GatheringObjectStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_receipt_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_finance_close_snapshots" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "financeYearId" TEXT NOT NULL,
    "payloadJson" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "closedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_finance_close_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_handovers" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "financeYearId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" "GatheringHandoverStatus" NOT NULL DEFAULT 'NOMINATED',
    "idempotencyKey" TEXT NOT NULL,
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_subscriptions" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "status" "GatheringSubscriptionStatus" NOT NULL,
    "source" "GatheringSubscriptionSource" NOT NULL,
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "storageQuotaBytes" BIGINT NOT NULL DEFAULT 50000000000,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_subscription_audits" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_subscription_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "GatheringPushPlatform" NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gathering_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "type" TEXT NOT NULL,
    "payloadJson" TEXT,
    "status" "GatheringNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "gathering_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_audit_logs" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gathering_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gathering_recovery_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phoneHash" TEXT NOT NULL,
    "note" TEXT,
    "status" "GatheringRecoveryStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "gathering_recovery_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gathering_profiles_userId_key" ON "gathering_profiles"("userId");

-- CreateIndex
CREATE INDEX "gathering_local_affiliations_userId_isCurrent_idx" ON "gathering_local_affiliations"("userId", "isCurrent");

-- CreateIndex
CREATE INDEX "gathering_groups_createdByUserId_idx" ON "gathering_groups"("createdByUserId");

-- CreateIndex
CREATE INDEX "gathering_memberships_userId_status_idx" ON "gathering_memberships"("userId", "status");

-- CreateIndex
CREATE INDEX "gathering_memberships_groupId_status_idx" ON "gathering_memberships"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_memberships_groupId_userId_key" ON "gathering_memberships"("groupId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_invites_tokenHash_key" ON "gathering_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "gathering_invites_groupId_createdAt_idx" ON "gathering_invites"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "gathering_role_assignments_groupId_userId_revokedAt_idx" ON "gathering_role_assignments"("groupId", "userId", "revokedAt");

-- CreateIndex
CREATE INDEX "gathering_role_assignments_groupId_role_revokedAt_idx" ON "gathering_role_assignments"("groupId", "role", "revokedAt");

-- CreateIndex
CREATE INDEX "gathering_executive_terms_groupId_fiscalYear_idx" ON "gathering_executive_terms"("groupId", "fiscalYear");

-- CreateIndex
CREATE INDEX "gathering_executive_terms_userId_idx" ON "gathering_executive_terms"("userId");

-- CreateIndex
CREATE INDEX "gathering_events_groupId_startsAt_idx" ON "gathering_events"("groupId", "startsAt");

-- CreateIndex
CREATE INDEX "gathering_events_groupId_deletedAt_idx" ON "gathering_events"("groupId", "deletedAt");

-- CreateIndex
CREATE INDEX "gathering_event_attendances_groupId_eventId_idx" ON "gathering_event_attendances"("groupId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_event_attendances_eventId_userId_key" ON "gathering_event_attendances"("eventId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_media_assets_storageKey_key" ON "gathering_media_assets"("storageKey");

-- CreateIndex
CREATE INDEX "gathering_media_assets_groupId_eventId_idx" ON "gathering_media_assets"("groupId", "eventId");

-- CreateIndex
CREATE INDEX "gathering_media_assets_uploaderUserId_idx" ON "gathering_media_assets"("uploaderUserId");

-- CreateIndex
CREATE INDEX "gathering_media_reports_groupId_status_idx" ON "gathering_media_reports"("groupId", "status");

-- CreateIndex
CREATE INDEX "gathering_media_reports_mediaAssetId_idx" ON "gathering_media_reports"("mediaAssetId");

-- CreateIndex
CREATE INDEX "gathering_finance_years_groupId_status_idx" ON "gathering_finance_years"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_finance_years_groupId_year_key" ON "gathering_finance_years"("groupId", "year");

-- CreateIndex
CREATE INDEX "gathering_finance_transactions_groupId_paidAt_idx" ON "gathering_finance_transactions"("groupId", "paidAt");

-- CreateIndex
CREATE INDEX "gathering_finance_transactions_eventId_idx" ON "gathering_finance_transactions"("eventId");

-- CreateIndex
CREATE INDEX "gathering_finance_transactions_financeYearId_idx" ON "gathering_finance_transactions"("financeYearId");

-- CreateIndex
CREATE INDEX "gathering_member_dues_financeYearId_idx" ON "gathering_member_dues"("financeYearId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_member_dues_groupId_userId_financeYearId_key" ON "gathering_member_dues"("groupId", "userId", "financeYearId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_receipt_assets_storageKey_key" ON "gathering_receipt_assets"("storageKey");

-- CreateIndex
CREATE INDEX "gathering_receipt_assets_groupId_eventId_idx" ON "gathering_receipt_assets"("groupId", "eventId");

-- CreateIndex
CREATE INDEX "gathering_receipt_assets_financeYearId_idx" ON "gathering_receipt_assets"("financeYearId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_finance_close_snapshots_financeYearId_key" ON "gathering_finance_close_snapshots"("financeYearId");

-- CreateIndex
CREATE INDEX "gathering_finance_close_snapshots_groupId_idx" ON "gathering_finance_close_snapshots"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_handovers_idempotencyKey_key" ON "gathering_handovers"("idempotencyKey");

-- CreateIndex
CREATE INDEX "gathering_handovers_groupId_financeYearId_status_idx" ON "gathering_handovers"("groupId", "financeYearId", "status");

-- CreateIndex
CREATE INDEX "gathering_subscriptions_groupId_status_idx" ON "gathering_subscriptions"("groupId", "status");

-- CreateIndex
CREATE INDEX "gathering_subscription_audits_groupId_createdAt_idx" ON "gathering_subscription_audits"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_push_tokens_token_key" ON "gathering_push_tokens"("token");

-- CreateIndex
CREATE INDEX "gathering_push_tokens_userId_idx" ON "gathering_push_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_notifications_dedupeKey_key" ON "gathering_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "gathering_notifications_userId_createdAt_idx" ON "gathering_notifications"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "gathering_notifications_groupId_idx" ON "gathering_notifications"("groupId");

-- CreateIndex
CREATE INDEX "gathering_audit_logs_groupId_createdAt_idx" ON "gathering_audit_logs"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "gathering_audit_logs_actorUserId_createdAt_idx" ON "gathering_audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_sessions_tokenHash_key" ON "gathering_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "gathering_sessions_userId_idx" ON "gathering_sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "gathering_recovery_codes_codeHash_key" ON "gathering_recovery_codes"("codeHash");

-- CreateIndex
CREATE INDEX "gathering_recovery_codes_userId_usedAt_idx" ON "gathering_recovery_codes"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "gathering_recovery_requests_userId_createdAt_idx" ON "gathering_recovery_requests"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "gathering_recovery_requests_phoneHash_createdAt_idx" ON "gathering_recovery_requests"("phoneHash", "createdAt");

-- AddForeignKey
ALTER TABLE "gathering_profiles" ADD CONSTRAINT "gathering_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_local_affiliations" ADD CONSTRAINT "gathering_local_affiliations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_groups" ADD CONSTRAINT "gathering_groups_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_memberships" ADD CONSTRAINT "gathering_memberships_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_memberships" ADD CONSTRAINT "gathering_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_memberships" ADD CONSTRAINT "gathering_memberships_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_invites" ADD CONSTRAINT "gathering_invites_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_invites" ADD CONSTRAINT "gathering_invites_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_role_assignments" ADD CONSTRAINT "gathering_role_assignments_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_role_assignments" ADD CONSTRAINT "gathering_role_assignments_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "gathering_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_role_assignments" ADD CONSTRAINT "gathering_role_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_role_assignments" ADD CONSTRAINT "gathering_role_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_role_assignments" ADD CONSTRAINT "gathering_role_assignments_revokedByUserId_fkey" FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_executive_terms" ADD CONSTRAINT "gathering_executive_terms_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_executive_terms" ADD CONSTRAINT "gathering_executive_terms_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_events" ADD CONSTRAINT "gathering_events_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_events" ADD CONSTRAINT "gathering_events_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_event_attendances" ADD CONSTRAINT "gathering_event_attendances_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_event_attendances" ADD CONSTRAINT "gathering_event_attendances_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "gathering_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_event_attendances" ADD CONSTRAINT "gathering_event_attendances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_media_assets" ADD CONSTRAINT "gathering_media_assets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_media_assets" ADD CONSTRAINT "gathering_media_assets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "gathering_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_media_assets" ADD CONSTRAINT "gathering_media_assets_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_media_reports" ADD CONSTRAINT "gathering_media_reports_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_media_reports" ADD CONSTRAINT "gathering_media_reports_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "gathering_media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_media_reports" ADD CONSTRAINT "gathering_media_reports_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_years" ADD CONSTRAINT "gathering_finance_years_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_transactions" ADD CONSTRAINT "gathering_finance_transactions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_transactions" ADD CONSTRAINT "gathering_finance_transactions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "gathering_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_transactions" ADD CONSTRAINT "gathering_finance_transactions_financeYearId_fkey" FOREIGN KEY ("financeYearId") REFERENCES "gathering_finance_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_transactions" ADD CONSTRAINT "gathering_finance_transactions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_member_dues" ADD CONSTRAINT "gathering_member_dues_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_member_dues" ADD CONSTRAINT "gathering_member_dues_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_member_dues" ADD CONSTRAINT "gathering_member_dues_financeYearId_fkey" FOREIGN KEY ("financeYearId") REFERENCES "gathering_finance_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_receipt_assets" ADD CONSTRAINT "gathering_receipt_assets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_receipt_assets" ADD CONSTRAINT "gathering_receipt_assets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "gathering_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_receipt_assets" ADD CONSTRAINT "gathering_receipt_assets_financeYearId_fkey" FOREIGN KEY ("financeYearId") REFERENCES "gathering_finance_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_receipt_assets" ADD CONSTRAINT "gathering_receipt_assets_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_close_snapshots" ADD CONSTRAINT "gathering_finance_close_snapshots_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_close_snapshots" ADD CONSTRAINT "gathering_finance_close_snapshots_financeYearId_fkey" FOREIGN KEY ("financeYearId") REFERENCES "gathering_finance_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_finance_close_snapshots" ADD CONSTRAINT "gathering_finance_close_snapshots_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_handovers" ADD CONSTRAINT "gathering_handovers_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_handovers" ADD CONSTRAINT "gathering_handovers_financeYearId_fkey" FOREIGN KEY ("financeYearId") REFERENCES "gathering_finance_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_handovers" ADD CONSTRAINT "gathering_handovers_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_handovers" ADD CONSTRAINT "gathering_handovers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_subscriptions" ADD CONSTRAINT "gathering_subscriptions_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_subscriptions" ADD CONSTRAINT "gathering_subscriptions_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_subscription_audits" ADD CONSTRAINT "gathering_subscription_audits_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_subscription_audits" ADD CONSTRAINT "gathering_subscription_audits_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "gathering_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_subscription_audits" ADD CONSTRAINT "gathering_subscription_audits_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_push_tokens" ADD CONSTRAINT "gathering_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_notifications" ADD CONSTRAINT "gathering_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_notifications" ADD CONSTRAINT "gathering_notifications_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_audit_logs" ADD CONSTRAINT "gathering_audit_logs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "gathering_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_audit_logs" ADD CONSTRAINT "gathering_audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_sessions" ADD CONSTRAINT "gathering_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_recovery_codes" ADD CONSTRAINT "gathering_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gathering_recovery_requests" ADD CONSTRAINT "gathering_recovery_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
