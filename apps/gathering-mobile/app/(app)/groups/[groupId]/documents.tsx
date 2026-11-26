import { Redirect, useLocalSearchParams } from 'expo-router';

// Keep existing drawer/deep links while sharing the fixed group tab bar.
export default function GroupDocumentsScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  if (typeof groupId !== 'string') return null;
  return <Redirect href={{ pathname: '/(app)/groups/[groupId]', params: { groupId, view: 'documents' } }} />;
}
