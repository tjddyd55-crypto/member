import { useState, type ReactNode } from 'react';
import { Modal, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatheringManualMemberInput, GatheringMemberView } from '@member/contracts';
import { BirthDateField, SexField } from '../forms/demographics';
import { JcOrgPicker, jcPickerValue } from '../forms/JcOrgPicker';
import { Button, FormError, KeyboardSheet, Notice, TextField, Title } from '../../design/ui';
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
  const [affiliation, setAffiliation] = useState(() => jcPickerValue(member));
  const [birthDate, setBirthDate] = useState(member?.birthDate ?? '');
  const [sex, setSex] = useState<'MALE' | 'FEMALE' | ''>(member?.sex ?? '');
  const [role, setRole] = useState<NonNullable<GatheringManualMemberInput['role']>>('MEMBER');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (busy) return;
    setBusy(true);
    setError('');
    if (!sex) {
      setBusy(false);
      setError('성별을 선택하세요.');
      return;
    }
    try {
      await onSave({
        name,
        phone,
        localId: affiliation.local?.id,
        birthDate,
        sex,
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
      {member?.affiliationNeedsReselect ? <Notice>기존 소속 “{member.localJcName}”의 지구와 로컬을 다시 선택해 주세요.</Notice> : null}
      <JcOrgPicker value={affiliation} onChange={setAffiliation} />
      <BirthDateField value={birthDate} onChange={setBirthDate} />
      <SexField value={sex} onChange={setSex} />
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
          !affiliation.local ||
          !birthDate ||
          !sex ||
          (role === 'EXECUTIVE' && !title.trim())
        }
        onPress={() => void save()}
      />
    </MemberActionSheet>
  );
}
