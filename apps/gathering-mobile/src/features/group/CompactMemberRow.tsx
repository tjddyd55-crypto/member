import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import type { GatheringMemberView } from '@member/contracts';
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
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderBottomWidth: 0.5,
        borderBottomColor: theme.colors.border.default,
        minWidth: 0,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: theme.colors.text.primary }}>
          {member.displayName}{' '}
          <Text style={{ fontSize: 12, fontWeight: '400', color: theme.colors.text.secondary }}>
            {[member.localJcName, visibleRoleLabels(member.roles)].filter(Boolean).join(' ')}
          </Text>
        </Text>
        {member.phone ? (
          <Text style={{ fontSize: 12, color: theme.colors.text.secondary }}>
            {formatPhone(member.phone)}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}
