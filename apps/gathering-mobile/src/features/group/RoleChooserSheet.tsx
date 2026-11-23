import { theme } from '../../theme';
import { useState } from 'react';
import { Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, KeyboardSheet, TextField } from '../../design/ui';
import { officerRoles, type AssignableRole } from './MemberPickerSheet';
export function RoleChooserSheet({
  titles,
  onChoose,
  onClose,
  addOnly = false,
}: {
  titles: string[];
  onChoose: (role: AssignableRole) => void;
  onClose: () => void;
  addOnly?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [adding, setAdding] = useState(addOnly);
  const [title, setTitle] = useState('');
  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <KeyboardSheet>
        <ScrollView
          style={{ maxHeight: '80%', backgroundColor: '#fff' }}
          contentContainerStyle={{
            padding: theme.layout.horizontalGutter,
            paddingLeft: theme.layout.horizontalGutter + insets.left,
            paddingRight: theme.layout.horizontalGutter + insets.right,
            paddingBottom: Math.max(theme.layout.horizontalGutter, insets.bottom),
            gap: 8,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {adding ? (
            <>
              <TextField label="직책" value={title} onChangeText={setTitle} maxLength={40} />
              <Button
                label="회원 선택"
                disabled={!title.trim()}
                onPress={() =>
                  onChoose({ role: 'EXECUTIVE', title: title.trim(), label: title.trim() })
                }
              />
            </>
          ) : (
            <>
              {officerRoles(titles).map((role) => (
                <Button
                  key={`${role.role}:${role.title ?? ''}`}
                  label={role.label}
                  variant="text"
                  onPress={() => onChoose(role)}
                />
              ))}
              <Button label="직책 추가…" variant="text" onPress={() => setAdding(true)} />
            </>
          )}
          <Button label="취소" variant="text" onPress={onClose} />
        </ScrollView>
      </KeyboardSheet>
    </Modal>
  );
}
