import { ComingSoon, Screen, AppBar } from '../../../src/design-system/components';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ScheduleScreen() {
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppBar title="일정" />
        <ComingSoon />
      </SafeAreaView>
    </Screen>
  );
}
