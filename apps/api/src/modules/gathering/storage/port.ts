export type SignedTarget = {
  url: string;
  expiresAt: string;
  headers: Record<string, string>;
};

export interface ObjectStorage {
  readonly prefixEnv: string;
  presignPut(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<SignedTarget>;
  presignGet(input: { key: string; expiresInSeconds: number }): Promise<SignedTarget>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  readPrefix(key: string, length: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
  /** 업로드 대기 키를 확정 키로 옮긴다. 확정 키에는 서명된 PUT을 주지 않는다. */
  relocate(fromKey: string, toKey: string): Promise<void>;
}
