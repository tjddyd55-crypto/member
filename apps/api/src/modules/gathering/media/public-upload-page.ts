import { publicUploadClient } from './public-upload-client.js';

const styles = `
:root {
  color-scheme: light;
  --bg: #FFFFFF;
  --primary: #1B3A6B;
  --secondary: #616E7C;
  --soft: #E8EEF7;
  --subtle: #F4F7FB;
  --error: #E03131;
  --success: #2F9E44;
  --gutter: 12px;
  --radius: 8px;
  --cell-radius: 12px;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--primary);
  font: 16px/24px system-ui, -apple-system, "Malgun Gothic", sans-serif;
}
body.viewing { overflow: hidden; }
.page {
  padding: 12px var(--gutter);
  padding-top: calc(12px + env(safe-area-inset-top));
  padding-right: calc(var(--gutter) + env(safe-area-inset-right));
  padding-bottom: calc(12px + env(safe-area-inset-bottom));
  padding-left: calc(var(--gutter) + env(safe-area-inset-left));
}
header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
h1 { margin: 0; font-size: 28px; line-height: 36px; font-weight: 700; overflow-wrap: anywhere; }
p { margin: 0; }
button {
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  padding: 0 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  min-height: 40px;
}
button:focus-visible { outline: 2px solid currentColor; outline-offset: -3px; }
button:disabled { opacity: .55; cursor: default; }
#back { font-size: 28px; width: 36px; flex: none; }
.upload-row { display: flex; gap: 6px; }
.chip, #more { background: var(--soft); border-radius: var(--radius); font-weight: 600; }
.chip { flex: 1; min-width: 0; }
.chip span, #percent { font-size: 13px; font-weight: 600; }
#progress, #download-progress, #download-actions, #grid, #gallery-status, #more, .notice { margin-top: 12px; }
.progress-header, .failed { display: flex; align-items: center; gap: 8px; }
.progress-header { justify-content: space-between; font-size: 14px; line-height: 20px; }
#progress[data-done] .progress-header, #download-progress[data-done] .progress-header { color: var(--success); }
.track { margin-top: 8px; height: 6px; border-radius: var(--radius); background: var(--subtle); overflow: hidden; }
#fill, #download-fill { display: block; height: 100%; width: 0; background: var(--primary); }
.failed { margin-top: 8px; justify-content: space-between; }
.failure-text { min-width: 0; }
.filename { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.error-text, #gallery-error, .link-error { color: var(--error); font-size: 14px; line-height: 20px; }
.failed button { flex: none; }
#grid {
  display: grid;
  grid-template-columns: repeat(var(--columns, 3), minmax(0, 1fr));
  gap: 3px;
  margin-inline: -6px;
}
.cell {
  position: relative;
  min-height: 0;
  padding: 0;
  overflow: hidden;
  border-radius: var(--cell-radius);
  background: var(--subtle);
  font-size: 14px;
}
.cell::before { content: ""; display: block; padding-top: 100%; }
#download-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.cell[aria-pressed]::after {
  content: ""; position: absolute; z-index: 1; top: 6px; right: 6px;
  width: 20px; height: 20px; border-radius: 4px; background: white;
  color: var(--primary); box-shadow: 0 1px 4px #0006; line-height: 20px;
}
.cell[aria-pressed="true"]::after { content: "✓"; }
.cell:disabled { opacity: .7; }
.cell.video { background: var(--primary); color: var(--bg); }
.cell img, .cell canvas { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cell-label, .play-badge { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
.play-badge {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(0,0,0,.55);
  font-size: 18px;
}
#more { width: 100%; }
.notice { color: var(--secondary); font-size: 12px; line-height: 18px; }
.viewer {
  position: fixed;
  z-index: 1;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 0 6px;
  padding: env(safe-area-inset-top) calc(6px + env(safe-area-inset-right))
    env(safe-area-inset-bottom) calc(6px + env(safe-area-inset-left));
  background: #000;
  color: var(--bg);
}
.viewer-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.viewer-bar button { min-height: 44px; }
#viewer-content { flex: 1; min-height: 0; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); place-items: center; overflow: hidden; }
#viewer-content img, #viewer-content video { width: 100%; height: 100%; min-height: 0; object-fit: contain; }
`;

function escapeHtml(value: string) {
  const entities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function document(title: string, body: string, script: string) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>${styles}</style>
</head>
<body>
${body}
<script>
'use strict';
const back = document.getElementById('back');
back.hidden = history.length <= 1;
back.onclick = () => { if (history.length > 1) history.back(); };
${script}
</script>
</body>
</html>`;
}

function header(title: string) {
  return `<header><button id="back" type="button" aria-label="뒤로" hidden>‹</button><h1>${title}</h1></header>`;
}

export function uploadErrorPage(message: string) {
  const title = '사진 업로드';
  return document(
    title,
    `<main class="page">${header(title)}<p class="link-error">${escapeHtml(message)}</p></main>`,
    '',
  );
}

export function uploadPage(
  info: { title: string; notice: string; kind: 'event' | 'folder' },
  token: string,
) {
  const title = escapeHtml(info.title);
  const empty = info.kind === 'event' ? '등록된 사진이 없습니다' : '아직 올린 사진·영상이 없습니다';
  const serializedToken = JSON.stringify(token).replace(/</g, '\\u003c');
  return document(
    title,
    `<main class="page" id="page">
${header(title)}
<div class="upload-row">
  <button class="chip" id="photos-button" type="button"><span>사진 올리기</span></button>
  <button class="chip" id="videos-button" type="button"><span>영상 올리기</span></button>
  <input id="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>
  <input id="videos" type="file" accept="video/mp4,video/quicktime" multiple hidden>
</div>
<section id="progress" aria-label="업로드 진행 상황" hidden>
  <div class="progress-header"><span id="progress-label" role="status"></span><span id="percent"></span></div>
  <div id="track" class="track" role="progressbar" aria-label="업로드 진행률" aria-valuemin="0" aria-valuemax="100"><span id="fill"></span></div>
  <div id="failures"></div>
</section>
<div id="gallery-status">
  <p id="loading" role="status">사진·영상을 불러오는 중입니다.</p>
  <p id="empty" hidden>${empty}</p>
  <p id="gallery-error" role="alert" hidden></p>
  <button id="gallery-retry" type="button" hidden>다시 시도</button>
</div>
<div id="download-actions" hidden>
  <button class="chip" id="select-media" type="button">선택</button>
  <span id="selected-count" role="status" hidden></span>
  <button id="download-media" type="button" hidden>다운로드</button>
</div>
<section id="download-progress" aria-label="저장 진행 상황" hidden>
  <div class="progress-header"><span id="download-label" role="status"></span><span id="download-percent"></span></div>
  <div id="download-track" class="track" role="progressbar" aria-label="저장 진행률" aria-valuemin="0" aria-valuemax="100"><span id="download-fill"></span></div>
  <div id="download-failures"></div>
</section>
<div id="grid" aria-label="갤러리" hidden></div>
<button id="more" type="button" hidden>이전 사진 더 보기</button>
<p class="notice">${escapeHtml(info.notice)}</p>
</main>
<section id="viewer" class="viewer" role="dialog" aria-modal="true" aria-label="사진·영상 보기" hidden>
  <div class="viewer-bar">
    <button id="close" type="button">닫기</button>
    <span id="counter" role="status"></span>
    <div>
      <button id="previous" type="button" aria-label="이전 항목">‹</button>
      <button id="next" type="button" aria-label="다음 항목">›</button>
    </div>
  </div>
  <div id="viewer-content"></div>
</section>`,
    `const token = ${serializedToken};\n${publicUploadClient}`,
  );
}
