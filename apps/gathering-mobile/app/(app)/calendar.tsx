import { router } from 'expo-router';
import { Button, Screen, Title } from '../../src/design/ui';
import { EventsTimeline } from '../../src/features/schedule/EventsTimeline';

export default function CalendarScreen() {
  return (
    <Screen scroll={false}>
      <Title>전체 일정</Title>
      <EventsTimeline />
      <Button label="내 모임" variant="text" onPress={() => router.replace('/(app)/groups')} />
    </Screen>
  );
}
