import { useLocalSearchParams } from 'expo-router';
import { AlbumGallery } from '../../../../../src/features/media/AlbumGallery';
export default function FolderMediaScreen() {
  const { groupId, folderId } = useLocalSearchParams<{ groupId: string; folderId: string }>();
  return <AlbumGallery key={`${groupId}/${folderId}`} groupId={groupId} folderId={folderId} />;
}
