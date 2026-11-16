import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mediaGridLayout } from '../../../gathering-mobile/src/features/media/grid-layout';
import { theme } from '../../../gathering-mobile/src/theme';
const source = (path: string) =>
  readFileSync(new URL(`../../../gathering-mobile/${path}`, import.meta.url), 'utf8');

describe('t51 화면 구조', () => {
  it('회원은 300ms 검색과 오래된 요청 무효화를 사용한다', () => {
    const group = source('app/(app)/groups/[groupId]/index.tsx');
    const members = group.slice(group.indexOf('function MembersPane'));
    expect(members).not.toContain('label="검색"');
    expect(members).toContain('setTimeout(() => void load(query.trim() || undefined), 300)');
    expect(members).toContain('clearTimeout(timer)');
    expect(members).toContain('requestVersion.current += 1');
    expect(members).toContain('if (version !== requestVersion.current) return');
    expect(members).toContain("api.members(groupId, 'ACTIVE', q)");
    expect(source('src/features/group/MemberPickerSheet.tsx')).not.toContain('label="검색"');
  });
  it.each([[360, 3], [390, 3], [430, 3], [600, 4], [768, 5]])(
    '%idp 그리드는 %i열이며 정사각형 타일과 3dp 간격이 들어간다',
    (width, columns) => {
      const grid = mediaGridLayout(width);
      expect(grid.columns).toBe(columns);
      expect(grid.cellSize * columns + (columns - 1) * 3).toBeLessThanOrEqual(width);
    },
  );
  it('모바일 전용 12dp 여백과 공통 그리드·선택·하단 공간을 유지한다', () => {
    expect(theme.layout.horizontalGutter).toBe(12);
    const ui = source('src/design/ui.tsx');
    expect(ui).toContain('padding: theme.layout.horizontalGutter');
    expect(ui).toContain('paddingBottom: 120');
    expect(ui).toContain("['top', 'left', 'right', 'bottom']");
    const media = source('src/features/media/MediaPane.tsx');
    expect(media).toContain('gap: 3, marginHorizontal: 6 - theme.layout.horizontalGutter');
    expect(theme.layout.horizontalGutter + (6 - theme.layout.horizontalGutter)).toBe(6);
    expect(ui).toContain('padding: theme.space[12]');
    expect(source('app/(app)/groups/index.tsx')).toContain('padding: theme.space[12]');
    expect(source('app/(app)/groups/[groupId]/index.tsx')).toContain('padding: theme.space[12]');
    expect(media).toContain('{ width: cellSize, height: cellSize }');
    expect(media).toContain('onLongPress={onLongPress}');
    expect(media).toContain('selecting && !item.canDelete && { opacity: 0.35 }');
    expect(media).toContain('size={20}');
    expect(source('src/features/media/AlbumGallery.tsx')).toContain('<MediaPane');
    expect(source('app/(app)/groups/[groupId]/events/[eventId].tsx')).toContain('<MediaPane');
  });
});


describe('t51 전체 화면 여백 감사', () => {
  const root = new URL('../../../gathering-mobile/', import.meta.url);
  function files(directory: URL): URL[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      return entry.isDirectory() ? files(url) : /\.tsx?$/.test(entry.name) ? [url] : [];
    });
  }
  it('모든 앱 소스에 큰 수평 여백이나 별도 gutter 기본값이 없다', () => {
    for (const directory of ['app/', 'src/']) {
      for (const file of files(new URL(directory, root))) {
        const text = readFileSync(file, 'utf8');
        expect(text, file.pathname).not.toMatch(
          /(?:padding(?:Horizontal|Left|Right)?|margin(?:Horizontal|Left|Right)?|left|right)\s*:\s*(?:(?:20|24|28|30|32)\b|theme\.space\[(?:20|24|28|30|32)\])/, 
        );
        expect(text, file.pathname).not.toMatch(/width\s*-\s*(?:40|48|56|60|64)\b|gutter\s*=\s*20/);
      }
    }
  });
  it('시트·드로어·토스트·뷰어·날짜 및 주소 모달이 같은 gutter를 사용한다', () => {
    for (const path of [
      'src/features/group/MemberPickerSheet.tsx',
      'src/features/group/RoleChooserSheet.tsx',
      'src/features/group/AppChrome.tsx',
      'src/design/toast.tsx',
      'src/design/pickers.tsx',
      'src/features/media/MediaViewer.tsx',
      'src/design/dialog.tsx',
    ]) expect(source(path), path).toContain('theme.layout.horizontalGutter');
    const dialog = source('src/design/dialog.tsx');
    expect(dialog).toContain('SafeAreaView');
    expect(dialog).toContain('padding: theme.space[12]');
    expect(dialog).toContain("button.style === 'cancel'");
    for (const feature of ['media/MediaPane', 'media/AlbumsPane', 'finance/FinancePanes']) {
      expect(source(`src/features/${feature}.tsx`)).toContain('useAppAlert');
      expect(source(`src/features/${feature}.tsx`)).not.toContain('Alert.alert');
    }
    expect(source('src/features/media/MediaViewer.tsx')).toContain('{props.overlay}');
    expect(source('src/design/toast.tsx')).toContain("maxWidth: '100%'");
  });
});
