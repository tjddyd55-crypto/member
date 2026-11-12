import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import type { GatheringEventView } from '@member/contracts';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { api } from '../../../../../src/api/client';
import { EventFinancePane } from '../../../../../src/features/finance/FinancePanes';
import { MediaPane } from '../../../../../src/features/media/MediaPane';
import { AddressField, DateTimeField } from '../../../../../src/design/pickers';
import {
  Body,
  Button,
  ErrorState,
  LoadingState,
  Screen,
  TextField,
} from '../../../../../src/design/ui';
import { UploadLinkPanel } from '../../../../../src/features/media/UploadLinkPanel';
import { eventStartsAt } from '../../../../../src/features/forms/values';
import {
  ATTENDANCE_OPTIONS,
  EVENT_TABS,
  attendanceSummary,
  eventActions,
  eventLocation,
  eventMapQuery,
  eventTabLabelSize,
  initialEventTab,
  splitEventLocation,
  type EventTab,
} from '../../../../../src/features/events/detail';
import { theme } from '../../../../../src/theme';

export default function EventDetailScreen() {
  const params = useLocalSearchParams<{ groupId: string; eventId: string; tab?: string }>();
  const groupId = typeof params.groupId === 'string' ? params.groupId : '';
  const eventId = typeof params.eventId === 'string' ? params.eventId : '';
  // Reset all local drafts, uploads and tabs when another event opens in this route.
  return (
    <EventDetail
      key={`${groupId}/${eventId}`}
      groupId={groupId}
      eventId={eventId}
      initialTab={initialEventTab(params.tab)}
    />
  );
}

function EventDetail({
  groupId,
  eventId,
  initialTab,
}: {
  groupId: string;
  eventId: string;
  initialTab: EventTab;
}) {
  const { width, fontScale } = useWindowDimensions();
  const tabLabelSize = eventTabLabelSize(width - 2 * theme.layout.horizontalGutter, fontScale);
  const [tab, setTab] = useState(initialTab);
  const [visited, setVisited] = useState<EventTab[]>([initialTab]);
  const [event, setEvent] = useState<GatheringEventView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const attendancePending = useRef(false);
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date());
  const [time, setTime] = useState(() => new Date());
  const [actions, setActions] = useState(() => eventActions([]));

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const [next, group] = await Promise.all([api.event(groupId, eventId), api.group(groupId)]);
      setEvent(next);
      setActions(eventActions(group.permissions));
      setStatus('ready');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '행사를 불러오지 못했습니다.');
      setStatus('error');
    }
  }, [eventId, groupId]);
  useEffect(() => {
    void load();
  }, [load]);

  const edit = () => {
    if (!event) return;
    const location = splitEventLocation(event.place);
    setTitle(event.title);
    setPlace(location.place);
    setAddress(location.address);
    setDescription(event.description ?? '');
    setDate(new Date(event.startsAt));
    setTime(new Date(event.startsAt));
    setFormError('');
    setEditing(true);
  };
  const attend = async (next: (typeof ATTENDANCE_OPTIONS)[number]['status']) => {
    if (attendancePending.current) return;
    attendancePending.current = true;
    setSavingAttendance(true);
    setMessage('');
    try {
      setEvent(await api.setAttendance(groupId, eventId, next));
      setMessage('참석 여부를 저장했습니다.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '참석 여부를 저장하지 못했습니다.');
    } finally {
      attendancePending.current = false;
      setSavingAttendance(false);
    }
  };
  const save = async (cancel = false) => {
    if (saving) return;
    setFormError('');
    const startsAt = eventStartsAt(date, time);
    const location = eventLocation(place, address);
    if (!cancel) {
      if (!title.trim() || title.trim().length > 80) {
        setFormError('행사명은 1~80자로 입력해 주세요.');
        return;
      }
      if (!startsAt) {
        setFormError('날짜와 시간을 다시 고르세요.');
        return;
      }
      if (location.length > 120) {
        setFormError('장소와 상세 주소는 합쳐서 120자까지 입력할 수 있습니다.');
        return;
      }
    }
    setSaving(true);
    try {
      const updated = await api.updateEvent(
        groupId,
        eventId,
        cancel
          ? { status: 'CANCELLED' }
          : {
              title: title.trim(),
              startsAt: startsAt!,
              place: location,
              description: description.trim(),
            },
      );
      setEvent(updated);
      setEditing(false);
      setMessage(cancel ? '행사를 취소했습니다.' : '행사를 수정했습니다.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '행사를 바꾸지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };
  const location = splitEventLocation(event?.place ?? null);
  const mapQuery = eventMapQuery(event?.place ?? null);
  const header =
    status === 'ready' && event ? (
      <>
        <View style={styles.heading}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="뒤로 가기"
            style={styles.back}
            onPress={() =>
              router.canGoBack() ? router.back() : router.replace(`/(app)/groups/${groupId}`)
            }
          >
            <Text style={styles.backLabel}>‹</Text>
          </Pressable>
          <Text accessibilityRole="header" style={styles.title}>
            {event.title}
          </Text>
          {actions.edit && event.status === 'SCHEDULED' ? (
            <Pressable accessibilityRole="button" style={styles.edit} onPress={edit}>
              <Text style={styles.editLabel}>수정</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.date}>
          {new Date(event.startsAt).toLocaleString('ko-KR', {
            timeZone: 'Asia/Seoul',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
        <View style={styles.tabs}>
          {EVENT_TABS.map(([id, label]) => (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              style={[styles.tab, tab === id && styles.selectedTab]}
              onPress={() => {
                setTab(id);
                setMessage('');
                setVisited((current) => (current.includes(id) ? current : [...current, id]));
              }}
            >
              <Text
                adjustsFontSizeToFit
                minimumFontScale={0.75}
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={[
                  styles.tabLabel,
                  { fontSize: tabLabelSize },
                  tab === id && styles.selectedLabel,
                ]}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </>
    ) : undefined;
  return (
    <Screen header={header} scrollKey={tab}>
      {status === 'loading' ? <LoadingState /> : null}
      {status === 'error' ? <ErrorState message={message} onRetry={() => void load()} /> : null}
      {status === 'ready' && event ? (
        <View style={styles.content}>
          {message ? (
            <Text accessibilityLiveRegion="polite" style={styles.feedback}>
              {message}
            </Text>
          ) : null}
          <View style={[styles.stack, tab !== 'info' && styles.hidden]}>
            {event.status === 'CANCELLED' ? <Body>취소된 행사</Body> : null}
            {location.place || location.address ? (
              <>
                {location.place ? <Text style={styles.place}>{location.place}</Text> : null}
                {location.address ? <Body>{location.address}</Body> : null}
                <Button
                  label="지도 열기"
                  variant="text"
                  onPress={() =>
                    void Linking.openURL(
                      `https://map.naver.com/p/search/${encodeURIComponent(mapQuery)}`,
                    ).catch(() => setMessage('지도를 열지 못했습니다.'))
                  }
                />
              </>
            ) : null}
            {event.description ? <Body>{event.description}</Body> : null}
            <Body>{attendanceSummary(event.counts)}</Body>
            {event.status === 'SCHEDULED' ? (
              <View style={styles.attendance}>
                {ATTENDANCE_OPTIONS.map((item) => (
                  <Pressable
                    key={item.status}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: event.myAttendance === item.status,
                      disabled: savingAttendance,
                    }}
                    disabled={savingAttendance}
                    style={[
                      styles.attendanceButton,
                      event.myAttendance === item.status && styles.attendanceSelected,
                    ]}
                    onPress={() => void attend(item.status)}
                  >
                    <Text
                      style={[
                        styles.attendanceLabel,
                        event.myAttendance === item.status && styles.attendanceSelectedLabel,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
          {visited.includes('media') ? (
            <View style={tab !== 'media' && styles.hidden}>
              <MediaPane
                eventId={eventId}
                groupId={groupId}
                active={tab === 'media'}
                uploadLinks={
                  actions.uploadLink ? (
                    <UploadLinkPanel groupId={groupId} eventId={eventId} compact />
                  ) : undefined
                }
              />
            </View>
          ) : null}
          {visited.includes('finance') ? (
            <View style={tab !== 'finance' && styles.hidden}>
              <EventFinancePane
                startsAt={event.startsAt}
                canAttach={actions.receipt}
                canWrite={actions.finance}
                eventId={eventId}
                groupId={groupId}
                active={tab === 'finance'}
              />
            </View>
          ) : null}
          {actions.edit && editing ? (
            <Modal
              visible
              animationType="slide"
              onRequestClose={() => {
                if (!saving) setEditing(false);
              }}
            >
              <Screen modal>
                <Text style={styles.modalTitle}>행사 수정</Text>
                <TextField label="행사명" value={title} onChangeText={setTitle} maxLength={80} />
                <DateTimeField label="행사 날짜" mode="date" value={date} onChange={setDate} />
                <DateTimeField label="시작 시간" mode="time" value={time} onChange={setTime} />
                <TextField label="장소" value={place} onChangeText={setPlace} />
                <AddressField label="상세 주소" value={address} onChange={setAddress} />
                <TextField
                  label="설명"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  maxLength={2000}
                />
                {formError ? <Body>{formError}</Body> : null}
                <Button label="변경 저장" loading={saving} onPress={() => void save()} />
                <Button
                  label="행사 취소"
                  disabled={saving}
                  variant="secondary"
                  onPress={() => void save(true)}
                />
                <Button
                  label="닫기"
                  disabled={saving}
                  variant="text"
                  onPress={() => setEditing(false)}
                />
              </Screen>
            </Modal>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  title: {
    flex: 1,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  date: { fontSize: 14, color: theme.colors.text.secondary, marginBottom: 4 },
  back: { width: 28, minHeight: 44, justifyContent: 'center' },
  backLabel: { fontSize: 22, color: theme.colors.text.secondary },
  edit: { minHeight: 44, paddingHorizontal: 8, justifyContent: 'center' },
  editLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.primary.default },
  tabs: { flexDirection: 'row', gap: 2 },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    backgroundColor: '#ECEFF3',
  },
  tabLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text.secondary },
  selectedLabel: { color: theme.colors.text.primary },
  selectedTab: {
    backgroundColor: theme.colors.bg.subtle,
    borderTopWidth: 2,
    borderColor: theme.colors.text.primary,
  },
  content: {
    backgroundColor: theme.colors.bg.subtle,
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
    padding: 12,
    marginTop: -theme.layout.horizontalGutter,
    gap: 12,
  },
  place: { ...theme.typography.body, fontWeight: '700', color: theme.colors.text.primary },
  stack: { gap: 12 },
  hidden: { display: 'none' },
  feedback: { fontSize: 14, color: theme.colors.text.primary },
  attendance: { flexDirection: 'row', gap: 4 },
  attendanceButton: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    borderRadius: 8,
    backgroundColor: theme.colors.bg.default,
  },
  attendanceSelected: {
    backgroundColor: theme.colors.text.primary,
    borderColor: theme.colors.text.primary,
  },
  attendanceLabel: { fontSize: 15, color: theme.colors.text.primary },
  attendanceSelectedLabel: { color: theme.colors.text.onPrimary, fontWeight: '700' },
  modalTitle: { ...theme.typography.sectionTitle, color: theme.colors.text.primary },
});
