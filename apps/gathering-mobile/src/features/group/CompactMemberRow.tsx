import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { GatheringMemberView } from '@member/contracts';
import { formatMemberDemographics } from '@member/gathering-domain';
import { visibleRoleLabels } from '../../copy';
import { formatPhone } from '../../utils/phone';
import { theme } from '../../theme';

export function CompactMemberRow({
  member,
  children,
}: {
  member: GatheringMemberView;
  children?: ReactNode;
}) {
  const demographics = formatMemberDemographics(member);
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 12,
        paddingHorizontal: theme.space[8],
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.border.default,
        minWidth: 0,
      }}
    >
      <View style={{ flexGrow: 1, flexBasis: 120, minWidth: 0, gap: 2 }}>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.space[4],
          }}
        >
          <Text
            style={{
              flexShrink: 1,
              fontSize: 19,
              lineHeight: 26,
              fontWeight: '600',
              color: theme.colors.text.primary,
            }}
          >
            {member.displayName}
          </Text>
          {!member.isAppRegistered ? (
            <Text
              style={{
                flexShrink: 1,
                fontSize: 14,
                lineHeight: 20,
                borderRadius: theme.radius[12],
                paddingHorizontal: theme.space[8],
                backgroundColor: theme.colors.primary.soft,
                color: theme.colors.text.primary,
              }}
            >
              앱 미가입
            </Text>
          ) : null}
        </View>
        <Text style={{ fontSize: 15, lineHeight: 22, color: theme.colors.text.secondary }}>
          {[member.localDisplayName, visibleRoleLabels(member.roles)].filter(Boolean).join(' · ')}
        </Text>
        {demographics ? (
          <Text style={{ fontSize: 15, lineHeight: 22, color: theme.colors.text.secondary }}>
            {demographics}
          </Text>
        ) : null}
        {member.phone ? (
          <Text style={{ fontSize: 15, lineHeight: 22, color: theme.colors.text.secondary }}>
            {formatPhone(member.phone)}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
