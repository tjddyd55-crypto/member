import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { api } from '../../../../../src/api/client';
import { Button, Screen, Title } from '../../../../../src/design/ui';
import { MediaPane } from '../../../../../src/features/media/MediaPane';
import { UploadLinkPanel } from '../../../../../src/features/media/UploadLinkPanel';

export default function FolderMediaScreen() {
  const params = useLocalSearchParams<{ groupId: string; folderId: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const folderId = typeof params.folderId === 'string' ? params.folderId : '';
  const [title, setTitle] = useState('사진 폴더');
  const [canManage, setCanManage] = useState(false);
  const onTitle = useCallback((next: string) => setTitle(next), []);

  useEffect(() => {
    void api
      .group(groupId)
      .then((group) => setCanManage(group.permissions.includes('EVENT_MANAGE')))
      .catch(() => setCanManage(false));
  }, [groupId]);

  return (
    <Screen>
      <Button label="앨범으로" variant="text" onPress={() => router.back()} />
      <Title>{title}</Title>
      {canManage ? <UploadLinkPanel groupId={groupId} folderId={folderId} /> : null}
      <MediaPane groupId={groupId} folderId={folderId} onTitle={onTitle} />
    </Screen>
  );
}
