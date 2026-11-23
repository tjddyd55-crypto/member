import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { canOpenMediaPicker } from '../../../gathering-mobile/src/features/media/picker-access';

const mobile = new URL('../../../gathering-mobile/', import.meta.url);
describe('system Photo Picker access', () => {
  it('opens on Android without requesting library permissions', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Library permission unavailable'));
    expect(await canOpenMediaPicker('android', request)).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['ios', 'web'])('preserves permission checks on %s', async (platform) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ granted: false })
      .mockResolvedValueOnce({ granted: true });
    expect(await canOpenMediaPicker(platform, request)).toBe(false);
    expect(await canOpenMediaPicker(platform, request)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each(['src/features/media/MediaPane.tsx', 'src/features/finance/FinancePanes.tsx'])(
    'guards picker access in %s',
    (file) => {
      const source = readFileSync(new URL(file, mobile), 'utf8');
      expect(source).toMatch(
        /canOpenMediaPicker\(\s*Platform.OS,\s*ImagePicker.requestMediaLibraryPermissionsAsync,?\s*\)/,
      );
      expect(source).not.toContain('requestMediaLibraryPermissionsAsync()');
      expect(source).toContain('ImagePicker.launchImageLibraryAsync(');
    },
  );
  it('allows photo and video permissions for gallery save and blocks unrelated permissions', () => {
    const config = readFileSync(new URL('app.config.ts', mobile), 'utf8');
    expect(config).toContain("permissions: ['android.permission.POST_NOTIFICATIONS']");
    const blocked = config.split('blockedPermissions: [')[1].split(']')[0];
    expect(config).toContain("'expo-media-library'");
    expect(config).toContain("granularPermissions: ['photo', 'video']");
    expect(config).toContain('선택한 사진과 영상을 사진 보관함에 저장합니다.');
    for (const permission of [
      'READ_MEDIA_IMAGES',
      'READ_MEDIA_VIDEO',
      'READ_MEDIA_VISUAL_USER_SELECTED',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
    ]) {
      expect(blocked).not.toContain(`'android.permission.${permission}'`);
    }
    for (const permission of [
      'READ_MEDIA_AUDIO',
      'RECORD_AUDIO',
      'CAMERA',
      'SYSTEM_ALERT_WINDOW',
    ]) {
      expect(blocked).toContain(`'android.permission.${permission}'`);
    }
  });
});
