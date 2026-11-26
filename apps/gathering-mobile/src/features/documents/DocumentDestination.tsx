import { useEffect, useState } from 'react';
import { Modal } from 'react-native';
import { Body, Button, Screen, Title } from '../../design/ui';
import { formatEventDateTime } from '../schedule/range';
import type { DocumentEvent, DocumentFolder, DocumentLocation, documentApi } from './api';

const root = { folderId: null, eventId: null };

export function DocumentDestination({ api, folderOnly, excludeFolder, browseEvents = false, eventId = null, onCancel, onSelect }: {
  api: ReturnType<typeof documentApi>;
  eventId?: string | null;
  folderOnly: boolean;
  excludeFolder?: string;
  browseEvents?: boolean;
  onCancel: () => void;
  onSelect: (location: DocumentLocation, title?: string, archived?: boolean) => void;
}) {
  const [folder, setFolder] = useState<DocumentFolder | null>(null);
  const [eventsMode, setEventsMode] = useState(browseEvents);
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [events, setEvents] = useState<DocumentEvent[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [parentId, setParentId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const folderId = folder?.id ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessage('');
    async function load() {
      try {
        if (eventsMode) {
          const result = await api.events(offset);
          if (!active) return;
          setEvents((prev) => offset ? [...prev, ...result.events] : result.events);
          setNext(result.nextOffset);
        } else {
          const result = await api.list({ eventId, folderId }, '', 'name', offset);
          if (!active) return;
          setFolders((prev) => offset ? [...prev, ...result.folders] : result.folders);
          setParentId(result.folder?.parentId ?? null);
          setNext(result.nextOffset);
        }
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : '목록을 불러오지 못했습니다.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [api, folderId, eventId, eventsMode, offset, attempt]);

  const navigate = (destination: DocumentFolder | null, eventList = false) => {
    setFolders([]);
    setEvents([]);
    setNext(null);
    setOffset(0);
    setFolder(destination);
    setEventsMode(eventList);
  };
  const eventPicker = !folderOnly && !excludeFolder;

  return (
    <Modal visible animationType="slide" onRequestClose={onCancel}>
      <Screen modal>
        <Title>{eventsMode ? '행사 자료' : '이동할 위치'}</Title>
        <Button label="닫기" variant="text" onPress={onCancel} />
        {eventsMode ? (
          <>
            {events.map((event) => (
              <Button key={event.id} variant="secondary" disabled={event.archived && !browseEvents}
                label={`${formatEventDateTime(event.startsAt)} · ${event.title}${event.archived ? ' (보관)' : ''}`}
                onPress={() => onSelect({ ...root, eventId: event.id }, event.title, event.archived)} />
            ))}
            {!loading && !message && !events.length ? <Body>행사가 없습니다</Body> : null}
          </>
        ) : (
          <>
            {folderId ? <Button label="상위 폴더" variant="text"
              onPress={() => navigate(parentId ? { id: parentId, name: '', fileCount: 0 } : null)} /> : null}
            <Button label={folderId ? '이 폴더로 이동' : '자료실 첫 화면으로 이동'}
              onPress={() => onSelect({ eventId, folderId })} />
            {eventPicker && !eventId && !folderId ? <Button label="행사 자료" variant="secondary" onPress={() => navigate(null, true)} /> : null}
            {folders.filter((item) => item.id !== excludeFolder).map((item) => (
              <Button key={item.id} label={item.name} variant="secondary" onPress={() => navigate(item)} />
            ))}
          </>
        )}
        {next !== null && !loading ? <Button label="더 보기" variant="text" onPress={() => setOffset(next)} /> : null}
        {loading ? <Body>불러오는 중…</Body> : null}
        {message ? <><Body>{message}</Body><Button label="다시 시도" onPress={() => setAttempt((value) => value + 1)} /></> : null}
      </Screen>
    </Modal>
  );
}
