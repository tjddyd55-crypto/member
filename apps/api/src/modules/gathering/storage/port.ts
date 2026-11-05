export type SignedTarget = {
  url: string;
  expiresAt: string;
  headers: Record<string, string>;
};

export interface ObjectStorage {
  readonly prefixEnv: string;
  presignPut(input: { key: string; contentType: string; expiresInSeconds: number }): Promise<SignedTarget>;
  presignGet(input: { key: string; expiresInSeconds: number }): Promise<SignedTarget>;
  head(key: string): Promise<{ sizeBytes: number } | null>;
  readPrefix(key: string, length: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}
