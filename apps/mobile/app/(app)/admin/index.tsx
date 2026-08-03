import { ComingSoon, Screen, AppBar } from '../../../src/design-system/components';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function AdminHome() {
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppBar title="관리자" />
        <ComingSoon />
      </SafeAreaView>
    </Screen>
  );
}
