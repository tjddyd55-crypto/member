import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { devObjectStorage } from '../modules/gathering/storage/file-sink.js';

describe('개발용 파일 저장소', () => {
  afterEach(() => {
    delete process.env.GATHERING_DEV_STORAGE;
  });

  it('앱을 닫으면 수신 서버도 닫고 다음 기동은 새 주소로 연다', async () => {
    process.env.GATHERING_DEV_STORAGE = '1';
    const first = await buildApp();
    await first.ready();
    const firstUrl = await devObjectStorage().presignGet({ key: 'probe', expiresInSeconds: 60 });
    const firstPort = new URL(firstUrl.url).port;
    await first.close();

    await expect(fetch(firstUrl.url)).rejects.toThrow();

    const second = await buildApp();
    await second.ready();
    try {
      const secondUrl = await devObjectStorage().presignGet({ key: 'probe', expiresInSeconds: 60 });
      expect(new URL(secondUrl.url).port).not.toBe(firstPort);
      const put = await devObjectStorage().presignPut({
        key: 'probe',
        contentType: 'text/plain',
        sizeBytes: 2,
        expiresInSeconds: 60,
      });
      const response = await fetch(put.url, {
        method: 'PUT',
        headers: put.headers,
        body: Buffer.from('ok'),
      });
      expect(response.status).toBe(200);
    } finally {
      await second.close();
    }
  });
});
