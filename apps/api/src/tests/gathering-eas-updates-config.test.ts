import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../../gathering-mobile/app.config';

const gatheringMobile = new URL('../../../gathering-mobile/', import.meta.url);
const mobile = new URL('../../../mobile/', import.meta.url);

describe('gathering EAS Update configuration', () => {
  it('configures updates for iOS and Android', () => {
    expect(config.updates).toMatchObject({
      url: 'https://u.expo.dev/f5a017a3-82f8-4d73-bc8a-ecd249e994f3',
      checkAutomatically: 'ON_LOAD',
      fallbackToCacheTimeout: 0,
    });
    expect(config.runtimeVersion).toEqual({ policy: 'appVersion' });
    expect(config.ios?.bundleIdentifier).toBe('kr.jcikorea.app');
    expect(config.android?.package).toBe('kr.jcikorea.app');
  });

  it('routes build profiles to their update channels', () => {
    const { build } = JSON.parse(readFileSync(new URL('eas.json', gatheringMobile), 'utf8')) as {
      build: Record<string, { channel?: string; extends?: string }>;
    };

    function resolveChannel(profileName: string): string | undefined {
      const profile = build[profileName];
      return profile.channel ?? (profile.extends && resolveChannel(profile.extends));
    }

    expect(resolveChannel('production')).toBe('production');
    expect(resolveChannel('production-apk')).toBe('production');
    expect(resolveChannel('preview')).toBe('preview');
    expect(resolveChannel('preview-qa')).toBe('preview');
    expect(resolveChannel('development')).toBe('preview');
    expect(resolveChannel('development-device')).toBe('preview');
  });

  it('declares expo-updates only in the gathering mobile app', () => {
    const gatheringPackage = JSON.parse(
      readFileSync(new URL('package.json', gatheringMobile), 'utf8'),
    );
    const mobilePackage = JSON.parse(readFileSync(new URL('package.json', mobile), 'utf8'));

    expect(gatheringPackage.dependencies['expo-updates']).toEqual(expect.any(String));
    expect(mobilePackage.dependencies).not.toHaveProperty('expo-updates');
    expect(mobilePackage.devDependencies).not.toHaveProperty('expo-updates');
  });
});
