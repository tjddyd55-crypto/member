import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses an opaque RGB PNG without an alpha channel for the App Store icon', () => {
  const icon = readFileSync(new URL('../../../gathering-mobile/assets/icon.png', import.meta.url));
  expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(icon.toString('ascii', 12, 16)).toBe('IHDR');
  expect(icon.readUInt32BE(16)).toBe(1024);
  expect(icon.readUInt32BE(20)).toBe(1024);
  expect(icon[25]).toBe(2); // PNG IHDR color type: truecolor RGB, no alpha.
});
