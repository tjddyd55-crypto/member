import { z } from 'zod';

export const gatheringPhoneSchema = z.string().trim().min(8).max(20);
export const gatheringPasswordSchema = z
  .string()
  .min(8, '비밀번호는 8자 이상이어야 합니다.')
  .max(72, '비밀번호는 72자 이하여야 합니다.')
  .regex(/[A-Za-z]/, '비밀번호에 영문을 포함하세요.')
  .regex(/[0-9]/, '비밀번호에 숫자를 포함하세요.');

export const gatheringDisplayNameSchema = z.string().trim().min(1).max(40);
export const gatheringLocalJcSchema = z.string().trim().min(1).max(60);

export const gatheringRegisterSchema = z.object({
  name: gatheringDisplayNameSchema,
  phone: gatheringPhoneSchema,
  password: gatheringPasswordSchema,
  localJcName: gatheringLocalJcSchema,
  directoryConsent: z.literal(true, {
    errorMap: () => ({ message: '모임 안 연락처 공개에 동의해야 합니다.' }),
  }),
});

export const gatheringLoginSchema = z.object({
  phone: gatheringPhoneSchema,
  password: z.string().min(1).max(72),
});

export const gatheringRefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const gatheringLogoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

export const gatheringProfileSchema = z.object({
  name: gatheringDisplayNameSchema,
  localJcName: gatheringLocalJcSchema,
  directoryConsent: z.literal(true, {
    errorMap: () => ({ message: '모임 안 연락처 공개에 동의해야 합니다.' }),
  }),
});

export const gatheringRecoveryRedeemSchema = z.object({
  phone: gatheringPhoneSchema,
  recoveryCode: z.string().trim().min(8).max(32),
  newPassword: gatheringPasswordSchema,
});

export const gatheringRecoveryRequestSchema = z.object({
  phone: gatheringPhoneSchema,
  note: z.string().trim().max(500).optional(),
});

export const gatheringGroupCreateSchema = z.object({
  name: gatheringDisplayNameSchema,
  description: z.string().trim().max(500).optional(),
});

export const gatheringGroupUpdateSchema = z
  .object({
    name: gatheringDisplayNameSchema.optional(),
    description: z.string().trim().max(500).nullable().optional(),
    inviteRequiresApproval: z.boolean().optional(),
    fiscalStartMonth: z.number().int().min(1).max(12).optional(),
    fiscalStartDay: z.number().int().min(1).max(31).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '변경할 항목이 없습니다.');

export const gatheringInviteCreateSchema = z.object({
  expiresInHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  requiresApproval: z.boolean().optional(),
  maxUses: z.number().int().min(1).max(1000).nullable().optional(),
  revokeInviteId: z.string().min(1).optional(),
  groupId: z.string().optional(),
});

export const gatheringAcceptInviteSchema = z.object({
  directoryConsent: z.literal(true, {
    errorMap: () => ({ message: '모임 안 연락처 공개에 동의해야 합니다.' }),
  }),
});

export const gatheringRoleAssignSchema = z
  .object({
    userId: z.string().min(1),
    role: z.enum(['SECRETARY', 'TREASURER', 'EXECUTIVE']),
    title: z.string().trim().min(1).max(40).optional(),
    groupId: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.role === 'EXECUTIVE' && !value.title) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['title'],
        message: '추가 집행부 직함이 필요합니다.',
      });
    }
  });

export const gatheringMemberQuerySchema = z.object({
  q: z.string().trim().max(40).optional(),
  status: z.enum(['ACTIVE', 'PENDING']).optional(),
});

export const gatheringMembershipDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
});

export const gatheringEventWriteSchema = z.object({
  title: z.string().trim().min(1).max(80),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().nullable().optional(),
  place: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});

export const gatheringEventUpdateSchema = gatheringEventWriteSchema
  .partial()
  .extend({
    status: z.enum(['SCHEDULED', 'CANCELLED']).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, '변경할 항목이 없습니다.');

export const gatheringAttendanceSchema = z.object({
  status: z.enum(['ATTENDING', 'DECLINED', 'UNDECIDED']),
});

export const gatheringRangeQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});

export const gatheringMediaItemSchema = z.object({
  kind: z.enum(['PHOTO', 'VIDEO']),
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  durationMs: z.number().int().positive().optional(),
  width: z.number().int().positive().max(20000).optional(),
  height: z.number().int().positive().max(20000).optional(),
  originalName: z.string().trim().max(200).optional(),
});

export const gatheringMediaUploadSchema = z.object({
  items: z.array(gatheringMediaItemSchema).min(1).max(20),
});

export const gatheringMediaCompleteSchema = z.object({
  sizeBytes: z.number().int().positive(),
});

export const gatheringMediaListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const gatheringAlbumQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const gatheringMediaReportSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const gatheringMediaResolveSchema = z.object({
  status: z.enum(['RESOLVED', 'DISMISSED']),
});

export const gatheringTransactionSchema = z.object({
  direction: z.enum(['INCOME', 'EXPENSE']),
  label: z.string().trim().min(1).max(80),
  amountWon: z.number().int(),
  paidAt: z.string().datetime({ offset: true }),
  note: z.string().trim().max(500).nullable().optional(),
  adjustment: z.boolean().optional(),
});

export const gatheringDueSchema = z.object({
  userId: z.string().min(1).optional(),
  displayName: z.string().trim().min(1).max(40).optional(),
  year: z.number().int().min(2000).max(2100),
  amountWon: z.number().int(),
  paidAmountWon: z.number().int(),
  paidAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(['UNPAID', 'PARTIAL', 'PAID', 'WAIVED']).optional(),
});

export const gatheringReceiptItemSchema = z.object({
  mimeType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().positive(),
  originalName: z.string().trim().max(200).optional(),
});

export const gatheringReceiptUploadSchema = z.object({
  items: z.array(gatheringReceiptItemSchema).min(1).max(10),
});

export const gatheringFinanceQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const gatheringAccountDeleteSchema = z.object({
  password: z.string().min(1).max(72),
  confirm: z.literal(true, {
    errorMap: () => ({ message: '계정 삭제에 동의해야 합니다.' }),
  }),
});

export const gatheringBlockSchema = z.object({
  userId: z.string().min(1),
});

export const gatheringPushSchema = z
  .object({
    permission: z.enum(['granted', 'denied']),
    platform: z.enum(['IOS', 'ANDROID']),
    token: z.string().trim().min(16).max(256).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.permission === 'granted' && !value.token) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['token'],
        message: '알림 토큰이 필요합니다.',
      });
    }
  });

export type GatheringRegisterBody = z.infer<typeof gatheringRegisterSchema>;
export type GatheringLoginBody = z.infer<typeof gatheringLoginSchema>;
export type GatheringProfileBody = z.infer<typeof gatheringProfileSchema>;

export type GatheringAuthUser = {
  id: string;
  phone: string | null;
  status: string;
};

export type GatheringAuthProfile = {
  displayName: string;
  localJcName: string;
  directoryConsentAt: string;
};

export type GatheringSessionResponse = {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  user: GatheringAuthUser;
  profile: GatheringAuthProfile | null;
  identityLimitation: string;
  recoveryCodes?: string[];
};

export type GatheringGroupSummary = {
  id: string;
  name: string;
  description: string | null;
  membershipStatus: 'ACTIVE' | 'PENDING';
  roles: string[];
  presidentName: string | null;
  memberCount: number;
  financeYear: number | null;
};

export type GatheringFinanceYearView = {
  year: number;
  startsAt: string;
  endsAt: string;
  status: string;
  openingBalanceWon: number;
};

export type GatheringGroupDetail = {
  id: string;
  name: string;
  description: string | null;
  inviteRequiresApproval: boolean;
  fiscalStartMonth: number;
  fiscalStartDay: number;
  roles: string[];
  permissions: string[];
  president: { userId: string; displayName: string; localJcName: string } | null;
  memberCount: number;
  financeYear: GatheringFinanceYearView | null;
  pendingCount: number | null;
};

export type GatheringMemberView = {
  membershipId: string;
  userId: string;
  displayName: string;
  localJcName: string;
  phone: string | null;
  status: string;
  roles: Array<{ id: string; role: string; title: string | null }>;
};

export type GatheringInviteView = {
  id: string;
  expiresAt: string;
  revokedAt: string | null;
  requiresApproval: boolean;
  maxUses: number | null;
  useCount: number;
};

export type GatheringInviteCreated = {
  invite: GatheringInviteView;
  token: string;
  link: string;
};

export type GatheringEventView = {
  id: string;
  groupId: string;
  groupName: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  place: string | null;
  description: string | null;
  status: 'SCHEDULED' | 'CANCELLED';
  myAttendance: 'ATTENDING' | 'DECLINED' | 'UNDECIDED' | null;
  counts: { attending: number; declined: number; undecided: number };
};

export type GatheringOfficerView = {
  assignmentId: string;
  userId: string;
  displayName: string;
  role: string;
  title: string | null;
  assignedAt: string;
};

export type GatheringOfficerTermView = {
  id: string;
  userId: string;
  displayName: string;
  role: string;
  title: string | null;
  fiscalYear: number;
  startedAt: string;
  endedAt: string | null;
};

export type GatheringInvitePreview = {
  groupName: string;
  requiresApproval: boolean;
  expiresAt: string;
};

export type GatheringMediaView = {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: string;
  uploaderUserId: string;
  mine: boolean;
};

export type GatheringMediaUploadItem = {
  id: string;
  kind: 'PHOTO' | 'VIDEO';
  uploadUrl: string;
  expiresAt: string;
  headers: Record<string, string>;
};

export type GatheringAlbumEvent = {
  eventId: string;
  title: string;
  startsAt: string;
  year: number;
  photoCount: number;
  videoCount: number;
};

export type GatheringAlbumYear = {
  year: number;
  photoCount: number;
  videoCount: number;
};

export type GatheringTransactionView = {
  id: string;
  eventId: string;
  direction: 'INCOME' | 'EXPENSE';
  label: string;
  amountWon: number;
  paidAt: string;
  note: string | null;
  adjustment: boolean;
  fiscalYear: number;
};

export type GatheringReceiptView = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  immutable: boolean;
  createdAt: string;
};

export type GatheringDueView = {
  id: string;
  userId: string;
  displayName: string;
  amountWon: number;
  paidAmountWon: number;
  paidAt: string | null;
  status: string;
};

export type GatheringFinanceSummary = {
  year: number;
  status: string;
  startsAt: string;
  endsAt: string;
  openingBalanceWon: number;
  incomeWon: number;
  expenseWon: number;
  balanceWon: number;
  eventIncomeWon: number;
  duesWon: number;
  years: Array<{ year: number; status: string; startsAt: string; endsAt: string }>;
  dues: GatheringDueView[];
  events: Array<{ eventId: string; title: string; incomeWon: number; expenseWon: number; netWon: number }>;
};

export type GatheringStorageUsage = {
  mediaBytes: number;
  receiptBytes: number;
  otherBytes: number;
  usedBytes: number;
  quotaBytes: number;
  subscriptionActive: boolean;
};
