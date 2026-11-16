export function folderDeletePrompt(folder: { photoCount: number; videoCount: number }) {
  const { photoCount, videoCount } = folder;
  const contents = [
    photoCount ? `사진 ${photoCount}개` : '',
    videoCount ? `영상 ${videoCount}개` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return contents ? `폴더와 ${contents}가 삭제됩니다` : '폴더를 삭제할까요?';
}
