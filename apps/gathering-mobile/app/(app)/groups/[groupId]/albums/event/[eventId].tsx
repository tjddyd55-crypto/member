import { useLocalSearchParams } from 'expo-router';
import { AlbumGallery } from '../../../../../../src/features/media/AlbumGallery';
export default function EventAlbumScreen() {
  const { groupId, eventId } = useLocalSearchParams<{ groupId: string; eventId: string }>();
  return <AlbumGallery key={`${groupId}/${eventId}`} groupId={groupId} eventId={eventId} />;
}
