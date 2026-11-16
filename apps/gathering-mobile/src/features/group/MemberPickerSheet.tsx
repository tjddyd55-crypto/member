import { theme } from '../../theme';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import type { GatheringMemberView } from '@member/contracts';
import { Body, Button, TextField } from '../../design/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CompactMemberRow } from './CompactMemberRow';

export type AssignableRole = {
  role: 'SECRETARY' | 'TREASURER' | 'EXECUTIVE';
  title?: string;
  label: string;
};
export const officerRoles = (titles: string[]): AssignableRole[] => [
  { role: 'SECRETARY', label: '총무' },
  { role: 'TREASURER', label: '재무' },
  ...titles.map((title): AssignableRole => ({ role: 'EXECUTIVE', title, label: title })),
];
export function MemberPickerSheet({
  members,
  target,
  fixedMember,
  onClose,
  onAssign,
}: {
  members: GatheringMemberView[];
  target: AssignableRole | null;
  fixedMember?: GatheringMemberView | null;
  onClose: () => void;
  onAssign: (member: GatheringMemberView, role: AssignableRole) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GatheringMemberView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const member = fixedMember ?? selected;
  return (
    <Modal
      transparent
      visible={!!target}
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' }}
      >
        <View
          style={{
            backgroundColor: '#fff',
            padding: theme.layout.horizontalGutter,
            paddingLeft: theme.layout.horizontalGutter + insets.left,
            paddingRight: theme.layout.horizontalGutter + insets.right,
            paddingBottom: Math.max(theme.layout.horizontalGutter, insets.bottom),
            gap: 8,
            maxHeight: '85%',
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
          }}
        >
          <Body>{target?.label}</Body>
          {member ? (
            <>
              <Body>{`${member.displayName}님을 ${target?.label}으로 임명할까요?`}</Body>
              <Button
                label="임명"
                loading={busy}
                onPress={() => {
                  if (!target || busy) return;
                  setBusy(true);
                  setError('');
                  void onAssign(member, target)
                    .catch((caught: unknown) =>
                      setError(caught instanceof Error ? caught.message : '임명하지 못했습니다.'),
                    )
                    .finally(() => setBusy(false));
                }}
              />
            </>
          ) : (
            <>
              <TextField label="회원 검색" value={query} onChangeText={setQuery} />
              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                {members
                  .filter(
                    (item) =>
                      `${item.displayName} ${item.phone ?? ''} ${item.localJcName}`
                        .toLocaleLowerCase()
                        .includes(query.trim().toLocaleLowerCase()) ||
                      (!!query.replace(/\D/g, '') &&
                        (item.phone ?? '').replace(/\D/g, '').includes(query.replace(/\D/g, ''))),
                  )
                  .map((item) => (
                    <Pressable
                      key={item.userId}
                      accessibilityRole="button"
                      onPress={() => setSelected(item)}
                    >
                      <CompactMemberRow member={item} />
                    </Pressable>
                  ))}
              </ScrollView>
            </>
          )}
          {error ? <Body>{error}</Body> : null}
          <Button label="취소" variant="text" disabled={busy} onPress={onClose} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
