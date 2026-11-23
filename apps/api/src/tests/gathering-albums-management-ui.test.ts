import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { folderDeletePrompt } from '../../../gathering-mobile/src/features/media/folder-values';

const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/src/features/${path}`, import.meta.url), 'utf8');
describe('사진 메뉴 폴더 관리', () => {
  it.each([
    [0, 0, '폴더를 삭제할까요?'],
    [12, 0, '폴더와 사진 12개가 삭제됩니다'],
    [3, 1, '폴더와 사진 3개, 영상 1개가 삭제됩니다'],
    [0, 2, '폴더와 영상 2개가 삭제됩니다'],
  ])('사진 %i 영상 %i 삭제 안내', (photoCount, videoCount, expected) => {
    expect(folderDeletePrompt({ photoCount, videoCount })).toBe(expected);
  });
  it('최상위에는 업로드와 대상 선택 없이 폴더 만들기만 유지한다', () => {
    const albums = source('media/AlbumsPane.tsx');
    expect(albums).not.toContain('사진 올리기');
    expect(albums).not.toContain('영상 올리기');
    expect(albums).not.toContain('setDestination');
    expect(albums).not.toContain('ImagePicker');
    expect(source('media/MediaPane.tsx')).toContain('사진 올리기');
    expect(albums).not.toContain('행사 만들기');
    expect(albums).not.toContain('/events/new');
    expect(albums).toContain('폴더 만들기');
    expect(albums).toContain('새 폴더 이름');
    expect(source('schedule/EventsPane.tsx')).toContain('행사 만들기');
    expect(source('schedule/EventsPane.tsx')).toContain('/events/new');
  });
  it('사용자 폴더에만 권한에 따라 관리 메뉴와 Android 입력 모달을 표시한다', () => {
    const albums = source('media/AlbumsPane.tsx');
    expect(albums).toContain('folder.canManage ?');
    for (const label of [
      '이름 변경',
      '삭제',
      '취소',
      '폴더 이름 변경',
      '저장되었습니다.',
      '삭제되었습니다.',
    ])
      expect(albums).toContain(label);
    expect(albums).toContain('<Modal');
    expect(albums).not.toContain('Alert.prompt');
    expect(albums).toContain('deleteFolder(groupId, folder.folderId)');
    const events = albums.slice(
      albums.indexOf("if (item.type === 'event')"),
      albums.indexOf('const folder = item;'),
    );
    expect(events).toContain('styles.eventBadge');
    expect(events).not.toContain('canManage');
    expect(events).not.toContain('⋯');
    const folders = albums.slice(
      albums.indexOf('const folder = item;'),
      albums.indexOf('{status ==='),
    );
    expect(folders).toContain('styles.folderBadge');
    expect(folders).toContain('⋯');
    expect(folders).toContain('confirmDeleteFolder(folder)');
    expect(events).not.toContain('confirmDeleteFolder');
  });
});
