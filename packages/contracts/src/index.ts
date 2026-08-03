import { z } from 'zod';

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const loginBodySchema = z.object({
  identifier: z.string().min(3),
  password: z.string().min(8),
  membershipId: z.string().optional(),
});

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20),
});

export const memberListQuerySchema = z.object({
  q: z.string().optional(),
  categoryId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** 클라이언트가 보내도 서버가 무시한다 — 계약상 허용만 표시 */
  localId: z.string().optional(),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type MemberListQuery = z.infer<typeof memberListQuerySchema>;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

export type AuthMeResponse = {
  user: {
    id: string;
    phone: string | null;
    email: string | null;
    status: string;
  };
  membership: {
    id: string;
    localId: string;
    role: string;
    status: string;
    local: {
      id: string;
      name: string;
      slogan: string | null;
      primaryColor: string;
    };
    memberProfile: {
      id: string;
      name: string;
      memberNumber: string | null;
      currentPositionText: string | null;
    } | null;
  };
};

export type MemberListItem = {
  id: string;
  name: string;
  hanjaName: string | null;
  memberNumber: string | null;
  currentPositionText: string | null;
  categoryName: string | null;
  companyName: string | null;
  companyPosition: string | null;
  phone: string | null;
  email: string | null;
};

export type MemberDetail = MemberListItem & {
  birthDate: string | null;
  homeAddress: string | null;
  spouseName: string | null;
  hobby: string | null;
  specialty: string | null;
  introduction: string | null;
  joinedAt: string | null;
  privacy: Record<string, 'MEMBERS' | 'ADMINS' | 'PRIVATE'>;
};
