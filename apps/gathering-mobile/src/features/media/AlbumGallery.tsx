import { useCallback, useEffect, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../api/client';
import { Screen, Title } from '../../design/ui';
import { MediaPane } from './MediaPane';
import { UploadLinkPanel } from './UploadLinkPanel';

type Target = { groupId: string } & (
  { folderId: string; eventId?: never } | { eventId: string; folderId?: never }
);
export function AlbumGallery(props: Target) {
  const { groupId, eventId, folderId } = props;
  const [title, setTitle] = useState('');
  const [canManage, setCanManage] = useState(false);
  const onTitle = useCallback((next: string) => setTitle(next), []);
  useEffect(() => {
    let active = true;
    void api
      .group(groupId)
      .then((group) => {
        if (active) setCanManage(group.permissions.includes('EVENT_MANAGE'));
      })
      .catch(() => undefined);
    if (eventId)
      void api
        .event(groupId, eventId)
        .then((event) => {
          if (active) setTitle(event.title);
        })
        .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [groupId, eventId]);
  return (
    <Screen
      header={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
            style={{ minWidth: 36, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace(`/(app)/groups/${groupId}`)
            }
          >
            <Text style={{ fontSize: 22 }}>‹</Text>
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Title>{title}</Title>
          </View>
        </View>
      }
    >
      <MediaPane
        groupId={groupId}
        eventId={eventId}
        folderId={folderId}
        onTitle={onTitle}
        uploadLinks={canManage ? <UploadLinkPanel {...props} compact /> : undefined}
      />
    </Screen>
  );
}
