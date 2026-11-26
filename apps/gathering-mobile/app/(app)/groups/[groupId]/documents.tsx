import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../src/design/ui';
import { DocumentsPane } from '../../../../src/features/documents/DocumentsPane';

export default function GroupDocumentsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  if (typeof groupId !== 'string') return null;
  return (
    <Screen>
      <DocumentsPane key={groupId} groupId={groupId} />
    </Screen>
  );
}
