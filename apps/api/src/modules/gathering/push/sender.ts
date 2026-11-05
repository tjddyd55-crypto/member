export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, string>;
};

export type PushTicket =
  | { token: string; status: 'ok' }
  | { token: string; status: 'error'; reason: 'DeviceNotRegistered' | 'Unknown' };

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

type ExpoTicket = { status?: string; details?: { error?: string } };

export class ExpoPushSender implements PushSender {
  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    if (messages.length === 0) return [];
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: expoHeaders(),
      body: JSON.stringify(
        messages.map((message) => ({
          to: message.to,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: 'default',
        })),
      ),
    });
    if (!response.ok) return messages.map((message) => unknownTicket(message.to));
    const payload = (await response.json()) as { data?: ExpoTicket[] };
    return messages.map((message, index) => toTicket(message.to, payload.data?.[index]));
  }
}

export class RecordingPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  nextReason: PushTicket['status'] | 'DeviceNotRegistered' = 'ok';

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map((message) => {
      if (this.nextReason === 'DeviceNotRegistered') {
        return { token: message.to, status: 'error', reason: 'DeviceNotRegistered' as const };
      }
      return { token: message.to, status: 'ok' as const };
    });
  }
}

function expoHeaders() {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return headers;
}

function toTicket(token: string, ticket: ExpoTicket | undefined): PushTicket {
  if (ticket?.status === 'ok') return { token, status: 'ok' };
  if (ticket?.details?.error === 'DeviceNotRegistered') {
    return { token, status: 'error', reason: 'DeviceNotRegistered' };
  }
  return unknownTicket(token);
}

function unknownTicket(token: string): PushTicket {
  return { token, status: 'error', reason: 'Unknown' };
}
