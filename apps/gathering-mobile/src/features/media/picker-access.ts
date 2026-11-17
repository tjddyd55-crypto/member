/** Android system Photo Picker grants access to selected URIs without library permissions. */
export async function canOpenMediaPicker(
  platform: string,
  requestLibraryPermission: () => Promise<{ granted: boolean }>,
): Promise<boolean> {
  if (platform === 'android') return true;
  return (await requestLibraryPermission()).granted;
}
