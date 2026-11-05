import { useCallback, useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { API_BASE, api, type UploadLinkView } from '../../api/client';
import { Body, Button, Notice } from '../../design/ui';
import { theme } from '../../theme';
import { formatKoreanDateTime, uploadLinkStatus } from '../forms/values';

type Target = { groupId: string; eventId: string; folderId?: undefined } | { groupId: string; folderId: string; eventId?: undefined };

export function UploadLinkPanel(props: Target) {
  const { groupId } = props;
  const eventId = props.eventId;
  const folderId = props.folderId;
  const scope = eventId ? { eventId } : { folderId: folderId ?? '' };
  const [items, setItems] = useState<UploadLinkView[]>([]);
  const [fresh, setFresh] = useState<{ id: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const listed = await api.uploadLinks(groupId, eventId ? { eventId } : { folderId: folderId ?? '' });
      setItems(listed.items);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드 링크를 불러오지 못했습니다.');
    }
  }, [eventId, folderId, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setMessage('');
    setCopied(false);
    try {
      const created = await api.createUploadLink(groupId, scope);
      setFresh({ id: created.id, url: `${API_BASE}/api/gathering/public/uploads/${created.token}` });
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드 링크를 만들지 못했습니다.');
    }
  };

  const copy = async () => {
    if (!fresh) return;
    await Clipboard.setStringAsync(fresh.url);
    setCopied(true);
  };

  const share = async () => {
    if (!fresh) return;
    await Share.share({ message: `사진과 영상을 올리는 링크입니다.\n${fresh.url}`, title: '업로드 링크' });
  };

  const change = async (linkId: string, action: 'pause' | 'resume' | 'revoke') => {
    setMessage('');
    try {
      await api.setUploadLinkState(groupId, linkId, action);
      if (action === 'revoke' && linkId === fresh?.id) {
        setFresh(null);
        setCopied(false);
      }
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '업로드 링크를 바꾸지 못했습니다.');
    }
  };

  return (
    <View style={{ gap: theme.space[8] }}>
      <Button label="업로드 링크 만들기" variant="secondary" onPress={() => void create()} />
      <Body>이 링크는 이 {props.folderId ? '폴더' : '행사'}에만 사진과 영상을 올립니다. 주소는 만들 때 한 번만 보입니다.</Body>
      {fresh ? (
        <>
          <Notice>이 주소는 지금만 전체 표시됩니다. 복사하거나 공유해 두세요.</Notice>
          <Text selectable style={{ color: theme.colors.text.primary }}>{fresh.url}</Text>
          <Button label={copied ? '복사했습니다' : '링크 복사'} variant="secondary" onPress={() => void copy()} />
          <Button label="링크 공유" variant="secondary" onPress={() => void share()} />
        </>
      ) : null}
      {items.map((link) => {
        const status = uploadLinkStatus(link);
        const closed = status === '폐기됨' || status === '만료됨';
        return (
          <View key={link.id} style={{ gap: theme.space[8] }}>
            <Text style={{ color: theme.colors.text.primary }}>
              {status} · {formatKoreanDateTime(link.expiresAt)}까지
            </Text>
            {closed ? null : (
              <>
                {status === '일시중지' ? (
                  <Button label="다시 열기" variant="secondary" onPress={() => void change(link.id, 'resume')} />
                ) : (
                  <Button label="일시중지" variant="secondary" onPress={() => void change(link.id, 'pause')} />
                )}
                <Button label="폐기" variant="secondary" onPress={() => void change(link.id, 'revoke')} />
              </>
            )}
          </View>
        );
      })}
      {message ? <Notice>{message}</Notice> : null}
    </View>
  );
}
