import { View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '../../design/ui';
import { theme } from '../../theme';
import { EventsTimeline } from './EventsTimeline';

export function EventsPane({ groupId, canManage }: { groupId: string; canManage: boolean }) {
  return (
    <View style={{ flex: 1, gap: theme.space[12] }}>
      {canManage ? (
        <Button
          label="행사 만들기"
          onPress={() => router.push(`/(app)/groups/${groupId}/events/new`)}
        />
      ) : null}
      <EventsTimeline groupId={groupId} />
    </View>
  );
}
