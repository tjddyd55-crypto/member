export function downloadFileName(
  original: string | undefined,
  mime: string | null | undefined,
  kind: 'PHOTO' | 'VIDEO',
) {
  const extension =
    (
      {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'video/mp4': 'mp4',
        'video/quicktime': 'mov',
      } as Record<string, string>
    )[mime?.split(';')[0]?.trim() ?? ''] ?? (kind === 'VIDEO' ? 'mp4' : 'jpg');
  const stem =
    (original ?? 'JCI')
      .replace(/\.[^.]+$/, '')
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
      .slice(0, 100) || 'JCI';
  return `${stem}.${extension}`;
}
