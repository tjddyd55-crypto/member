import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');
describe('영상 썸네일 화면 구조', () => {
  it('공용 타일은 포스터와 네이티브 대체 썸네일, 재생 배지를 표시한다', () => {
    const pane = source('src/features/media/MediaPane.tsx');
    const thumb = pane.slice(pane.indexOf('function MediaThumb'));
    expect(thumb).toContain('result.posterUrl');
    expect(thumb).toContain("Platform.OS !== 'web'");
    expect(thumb).toContain('videoThumbnail(item.id, result.url)');
    expect(thumb).toContain('item.canDelete || item.mine');
    expect(thumb).toContain('styles.playBadge');
    expect(thumb).toContain('▶');
    const posters = source('src/features/media/video-posters.ts');
    expect(posters).toContain('VideoThumbnails.getThumbnailAsync');
    expect(posters).toContain('running >= 2');
    expect(posters).toContain('thumbnails.get(assetId)');
    expect(posters).toContain('backfilled.has(assetId)');
  });
  it('영상 확정 후 포스터를 전송하며 실패는 선택 사항으로 처리한다', () => {
    const pane = source('src/features/media/MediaPane.tsx');
    expect(
      pane.indexOf('await uploadVideoPoster', pane.indexOf('await api.completeMedia')),
    ).toBeGreaterThan(pane.indexOf('await api.completeMedia'));
    const posters = source('src/features/media/video-posters.ts');
    expect(posters).toContain('api.posterUpload');
    expect(posters).toContain('putPreparedFile');
    expect(posters).toContain('api.posterComplete');
    expect(posters).toContain('catch {');
  });
  it('행사 갤러리와 앨범·폴더는 MediaPane을 공유한다', () => {
    expect(source('src/features/media/AlbumGallery.tsx')).toContain('<MediaPane');
    expect(source('app/(app)/groups/[groupId]/events/[eventId].tsx')).toContain('<MediaPane');
    for (const path of [
      'app/(app)/groups/[groupId]/albums/event/[eventId].tsx',
      'app/(app)/groups/[groupId]/folders/[folderId].tsx',
    ])
      expect(source(path)).toContain('<AlbumGallery');
  });
});
