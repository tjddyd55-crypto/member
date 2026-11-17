import { termsPolicy as policy } from '@member/contracts';
import { router } from 'expo-router';
import { Body, Button, Notice, Screen, Title } from '../../../src/design/ui';

export default function LegalScreen() {
  return (
    <Screen>
      <Title>{policy.title}</Title>
      <Notice>{policy.notice}</Notice>
      {policy.paragraphs.map((text) => (
        <Body key={text}>{text}</Body>
      ))}
      <Button label="뒤로" variant="text" onPress={() => router.back()} />
    </Screen>
  );
}
