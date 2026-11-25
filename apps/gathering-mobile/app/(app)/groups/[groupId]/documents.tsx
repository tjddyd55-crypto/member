import { useLocalSearchParams } from 'expo-router';
import { Screen, Title } from '../../../../src/design/ui';
import { DocumentsPane } from '../../../../src/features/documents/DocumentsPane';

export default function GroupDocumentsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  if (typeof groupId !== 'string') return null;
  return (
    <Screen>
      <Title>자료실</Title>
      <DocumentsPane key={groupId} groupId={groupId} />
    </Screen>
  );
}
