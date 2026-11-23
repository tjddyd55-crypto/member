import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatheringManualMemberInput, GatheringMemberView } from '@member/contracts';
import { Button, FormError, KeyboardSheet, TextField, Title } from '../../design/ui';
import { theme } from '../../theme';

export function MemberActionSheet({
  title,
  busy,
  error,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      transparent
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardSheet>
        <View
          style={{
            maxHeight: '85%',
            backgroundColor: theme.colors.bg.default,
            borderTopLeftRadius: theme.radius[12],
            borderTopRightRadius: theme.radius[12],
            paddingTop: theme.space[12],
            paddingLeft: theme.layout.horizontalGutter + insets.left,
            paddingRight: theme.layout.horizontalGutter + insets.right,
            paddingBottom: Math.max(theme.layout.horizontalGutter, insets.bottom),
          }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ gap: theme.space[8] }}
          >
            <Title>{title}</Title>
            {children}
            {error ? <FormError>{error}</FormError> : null}
            <Button label="취소" variant="text" disabled={busy} onPress={onClose} />
          </ScrollView>
        </View>
      </KeyboardSheet>
    </Modal>
  );
}

const roles = [
  ['MEMBER', '일반 회원'],
  ['SECRETARY', '총무'],
  ['TREASURER', '재무'],
  ['EXECUTIVE', '집행부'],
] as const;

export function ManualMemberSheet({
  member,
  canAssign,
  onClose,
  onSave,
}: {
  member: GatheringMemberView | null;
  canAssign: boolean;
  onClose: () => void;
  onSave: (input: GatheringManualMemberInput) => Promise<void>;
}) {
  const [name, setName] = useState(member?.displayName ?? '');
  const [phone, setPhone] = useState(member?.phone ?? '');
  const [localJcName, setLocal] = useState(member?.localJcName ?? '');
  const [role, setRole] = useState<NonNullable<GatheringManualMemberInput['role']>>('MEMBER');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onSave({
        name,
        phone,
        localJcName,
        role,
        title: role === 'EXECUTIVE' ? title : undefined,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '회원 정보를 저장하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <MemberActionSheet
      title={member ? '정보 수정' : '앱 미가입 회원 추가'}
      busy={busy}
      error={error}
      onClose={onClose}
    >
      <TextField label="이름" value={name} onChangeText={setName} maxLength={40} />
      <TextField
        label="휴대폰 번호"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={20}
        placeholder="010-1234-5678"
      />
      <TextField label="소속 로컬" value={localJcName} onChangeText={setLocal} maxLength={60} placeholder="예: 서울 ○○" />
      {!member && canAssign
        ? roles.map(([value, label]) => (
            <Button
              key={value}
              label={label}
              variant={role === value ? 'primary' : 'secondary'}
              onPress={() => setRole(value)}
            />
          ))
        : null}
      {!member && canAssign && role === 'EXECUTIVE' ? (
        <TextField label="직함" value={title} onChangeText={setTitle} maxLength={40} />
      ) : null}
      <Button
        label="저장"
        loading={busy}
        disabled={
          !name.trim() ||
          !phone.trim() ||
          !localJcName.trim() ||
          (role === 'EXECUTIVE' && !title.trim())
        }
        onPress={() => void save()}
      />
    </MemberActionSheet>
  );
}
