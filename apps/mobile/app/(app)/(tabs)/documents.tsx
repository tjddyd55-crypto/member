import { ComingSoon, Screen, AppBar } from '../../../src/design-system/components';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DocumentsScreen() {
  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <AppBar title="정관·자료" />
        <ComingSoon />
      </SafeAreaView>
    </Screen>
  );
}
