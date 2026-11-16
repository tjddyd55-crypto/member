export function mediaDeletePrompt(items: Array<{ kind: 'PHOTO' | 'VIDEO' }>) {
  const photos = items.filter((item) => item.kind === 'PHOTO').length;
  const videos = items.length - photos;
  return (
    [photos ? `사진 ${photos}개` : '', videos ? `영상 ${videos}개` : '']
      .filter(Boolean)
      .join(', ') + '를 삭제할까요?'
  );
}
