import { createElement } from 'react';

export function PdfPreview({ url, onError }: { url: string; onError: () => void }) {
  return createElement('iframe', {
    src: url, title: 'PDF 미리보기', sandbox: '', onError, style: { flex: 1, width: '100%', border: 0 },
  });
}
