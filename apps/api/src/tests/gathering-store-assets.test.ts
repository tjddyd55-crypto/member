import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses the production App Store IDs and prompts for the Apple ID', () => {
  const eas = JSON.parse(readFileSync(new URL('../../../gathering-mobile/eas.json', import.meta.url), 'utf8'));
  expect(eas.submit.production.ios).toEqual({
    ascAppId: '6835749438',
    appleTeamId: 'HVK2UWPBY9',
  });
  expect(eas.submit.production.ios).not.toHaveProperty('appleId');
});

it('uses an opaque RGB PNG without an alpha channel for the App Store icon', () => {
  const icon = readFileSync(new URL('../../../gathering-mobile/assets/icon.png', import.meta.url));
  expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(icon.toString('ascii', 12, 16)).toBe('IHDR');
  expect(icon.readUInt32BE(16)).toBe(1024);
  expect(icon.readUInt32BE(20)).toBe(1024);
  expect(icon[25]).toBe(2); // PNG IHDR color type: truecolor RGB, no alpha.
});

it.each([
  ['adaptive-icon.png', 1024, 2],
  ['splash-icon.png', 1024, 2],
  ['notification-icon.png', 96, 6],
] as const)('uses the official asset dimensions and color type for %s', (name, size, colorType) => {
  const asset = readFileSync(new URL(`../../../gathering-mobile/assets/${name}`, import.meta.url));
  expect(asset.readUInt32BE(16)).toBe(size);
  expect(asset.readUInt32BE(20)).toBe(size);
  expect(asset[25]).toBe(colorType);
});

it('configures official splash, adaptive icon, and notification colors', () => {
  const config = readFileSync(new URL('../../../gathering-mobile/app.config.ts', import.meta.url), 'utf8');
  expect(config).toMatch(/splash:\s*\{[^}]*backgroundColor:\s*'#130F2D'/);
  expect(config).toMatch(/adaptiveIcon:\s*\{[^}]*backgroundColor:\s*'#130F2D'/);
  expect(config).toMatch(/\['expo-notifications',\s*\{[^}]*color:\s*'#0097D7'/);
});

it('removes the generator that could overwrite official assets with placeholders', () => {
  expect(existsSync(new URL('../../../gathering-mobile/scripts/generate-placeholder-assets.mjs', import.meta.url))).toBe(false);
});
