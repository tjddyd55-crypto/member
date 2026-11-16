import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { formatPhone, phoneDigits } from '../../../gathering-mobile/src/utils/phone';
import { mediaGridLayout } from '../../../gathering-mobile/src/features/media/grid-layout';
const root = new URL('../../../gathering-mobile/', import.meta.url);
const source = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('t53 phone display and full bleed gallery', () => {
  it.each([
    ...[
      '01012345678',
      '010-1234-5678',
      '010 1234 5678',
      '010.1234.5678',
      '(010)1234-5678',
      '+82 10-1234-5678',
      '+821012345678',
      '82 10 1234 5678',
      '82-10-1234-5678',
    ].map((value) => [value, '010-1234-5678']),
    ['0101234567', '010-123-4567'],
    ['01112345678', '011-1234-5678'],
    ['0212345678', '02-1234-5678'],
    ['021234567', '02-123-4567'],
    ['02-123-4567', '02-123-4567'],
    ['+82 2 123 4567', '02-123-4567'],
    ['0311234567', '031-123-4567'],
    ['03112345678', '031-1234-5678'],
    ['0511234567', '051-123-4567'],
    ['0641234567', '064-123-4567'],
    ['07012345678', '070-1234-5678'],
    ['05071234567', '0507-123-4567'],
    ['15881234', '1588-1234'],
    ['16881234', '1688-1234'],
    ['18881234', '1888-1234'],
    ['', ''],
    ['   ', ''],
    [' garbage ', 'garbage'],
    [' 123-45 ', '123-45'],
    ['+1 (212) 555-1234', '+1 (212) 555-1234'],
  ])('%s displays as %s', (value, expected) => expect(formatPhone(value)).toBe(expected));

  it('dialing and picker matching use domestic digits regardless of punctuation/country code', () => {
    for (const value of ['010.1234.5678', '+82 10-1234-5678', '82 10 1234 5678']) {
      expect(phoneDigits(value)).toBe('01012345678');
      expect(phoneDigits(value).includes(phoneDigits('010-1234'))).toBe(true);
    }
    expect(phoneDigits('')).toBe('');
    expect(source('src/features/group/MemberPickerSheet.tsx')).toContain(
      "phoneDigits(item.phone ?? '').includes(phoneDigits(query))",
    );
  });

  it('greps all JSX phone display expressions and requires the shared formatter', () => {
    const files = (dir: URL): URL[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const url = new URL(entry.name, dir);
        return entry.isDirectory()
          ? files(new URL(`${entry.name}/`, dir))
          : entry.name.endsWith('.tsx')
            ? [url]
            : [];
      });
    const displays: string[] = [];
    for (const file of [...files(new URL('app/', root)), ...files(new URL('src/', root))]) {
      const ast = ts.createSourceFile(
        file.pathname,
        readFileSync(file, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const visit = (node: ts.Node) => {
        // Conditions, input props and callbacks are not displayed text. Inspect leaf JSX expressions.
        if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
          const expression = node.expression.getText(ast);
          if (!/<[A-Za-z]/.test(expression) && /\b(?:phone|\w*Phone)\b/.test(expression)) {
            displays.push(file.pathname);
            expect(expression, `${file.pathname}: ${expression}`).toMatch(/formatPhone\(/);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    expect(displays).toHaveLength(2);
  });

  it.each([360, 390])('event and album grids share the same 6px edges at %ipx', (width) => {
    const gutter = 20;
    const cardPadding = 12;
    const albumWidth = width - 2 * gutter - 2 * (6 - gutter);
    const eventWidth = width - 2 * gutter - 2 * cardPadding - 2 * (6 - gutter - cardPadding);
    expect(eventWidth).toBe(width - 12);
    expect(mediaGridLayout(eventWidth)).toEqual(mediaGridLayout(albumWidth));
    expect(mediaGridLayout(eventWidth).columns).toBe(3);
    expect(source('app/(app)/groups/[groupId]/events/[eventId].tsx')).toContain(
      'contentInset={12}',
    );
    const pane = source('src/features/media/MediaPane.tsx');
    expect(pane).toContain('6 - theme.layout.horizontalGutter - contentInset');
    expect(pane).toContain('mediaGridLayout(gridWidth)');
    expect(pane).toContain('setGridWidth(event.nativeEvent.layout.width)');
    for (const retained of [
      'styles.uploadRow',
      'styles.selectionBar',
      'onLongPress',
      'setSelected([item.id])',
    ])
      expect(pane).toContain(retained);
  });
});
