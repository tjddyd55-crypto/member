// Inline browser code keeps shared links usable without a separate static asset request.
export const publicUploadClient = String.raw`
const byId = (id) => document.getElementById(id);
const base = '/api/gathering/public/uploads/' + encodeURIComponent(token);
const grid = byId('grid');
const viewer = byId('viewer');
const viewerContent = byId('viewer-content');
const items = new Map();
const newest = new Map();
const cells = new Map();
const signed = new Map();
let jobs = [];
let nextCursor = null;
let galleryReady = false;
let loading = false;
let uploadActive = false;
let clearProgress;
let viewedId = null;
let viewerOrigin = null;
let viewerRequest = 0;

async function request(path, payload) {
  const options = { cache: 'no-store', credentials: 'omit' };
  if (payload) {
    options.method = 'POST';
    options.headers = { 'content-type': 'application/json' };
    options.body = JSON.stringify(payload);
  }
  const response = await fetch(base + path, options);
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || '요청을 처리하지 못했습니다.');
    error.code = body.error?.code;
    throw error;
  }
  return body;
}

function readyItems() {
  return [...Array.from(newest.values()).reverse(), ...items.values()];
}

function measureGrid() {
  grid.style.setProperty('--columns', Math.max(3, Math.floor(grid.clientWidth / 130)));
}
if (typeof ResizeObserver === 'function') new ResizeObserver(measureGrid).observe(grid);
window.addEventListener('resize', measureGrid);

function renderGrid() {
  const entries = [...jobs.filter((job) => job.state !== 'done'), ...readyItems()];
  const visible = new Set(entries);
  for (const [entry, cell] of cells) {
    if (visible.has(entry)) continue;
    if (thumbnailObserver) thumbnailObserver.unobserve(cell);
    cell.remove();
    cells.delete(entry);
  }
  for (const [index, entry] of entries.entries()) {
    const cell = cells.get(entry) || createCell(entry);
    const label = entry.kind === 'VIDEO' ? '영상 ' : '사진 ';
    cell.setAttribute('aria-label', label + (index + 1));
    if (grid.children[index] !== cell) grid.insertBefore(cell, grid.children[index] || null);
  }
  grid.hidden = entries.length === 0;
  byId('empty').hidden = !galleryReady || entries.length > 0;
  byId('gallery-status').hidden = [
    'loading', 'empty', 'gallery-error', 'gallery-retry',
  ].every((id) => byId(id).hidden);
  measureGrid();
  if (viewedId) updateViewerControls();
}

async function loadGallery(cursor) {
  if (loading) return;
  loading = true;
  byId('more').disabled = true;
  byId('gallery-error').hidden = true;
  byId('gallery-retry').hidden = true;
  try {
    const result = await request('/media' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
    for (const item of result.items) {
      if (!newest.has(item.id) && !items.has(item.id)) items.set(item.id, item);
    }
    nextCursor = result.nextCursor;
    galleryReady = true;
  } catch (error) {
    byId('gallery-error').textContent = error.message || '사진·영상을 불러오지 못했습니다.';
    byId('gallery-error').hidden = false;
    byId('gallery-retry').hidden = Boolean(cursor);
  } finally {
    loading = false;
    byId('loading').hidden = true;
    byId('more').disabled = false;
    byId('more').hidden = !nextCursor;
    renderGrid();
  }
}
byId('gallery-retry').onclick = () => loadGallery(null);
byId('more').onclick = () => loadGallery(nextCursor);

async function mediaTarget(id) {
  const cached = signed.get(id);
  if (cached) {
    const target = await cached;
    if (Date.parse(target.expiresAt) > Date.now() + 30000) return target;
  }
  const pending = request('/media/' + encodeURIComponent(id));
  signed.set(id, pending);
  try {
    return await pending;
  } catch (error) {
    if (signed.get(id) === pending) signed.delete(id);
    throw error;
  }
}

const thumbnailTasks = [];
let thumbnailsActive = 0;
const thumbnailObserver = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries, observer) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        queueThumbnail(entry.target);
      }
    }, { rootMargin: '200px' })
  : null;
const thumbnailEntries = new WeakMap();

function queueThumbnail(cell) {
  thumbnailTasks.push(cell);
  loadThumbnails();
}

function loadThumbnails() {
  while (thumbnailsActive < 4 && thumbnailTasks.length > 0) {
    const cell = thumbnailTasks.shift();
    if (!cell.isConnected) continue;
    thumbnailsActive++;
    loadThumbnail(cell, thumbnailEntries.get(cell)).catch(() => {
      // The play badge or photo label stays visible when a preview is unavailable.
    }).finally(() => {
      thumbnailsActive--;
      loadThumbnails();
    });
  }
}

function createCell(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = entry.kind === 'VIDEO' ? 'cell video' : 'cell';
  const badge = document.createElement('span');
  badge.className = entry.kind === 'VIDEO' ? 'play-badge' : 'cell-label';
  badge.textContent = entry.kind === 'VIDEO' ? '▶' : '사진';
  badge.setAttribute('aria-hidden', 'true');
  button.append(badge);
  if (entry.file) button.disabled = true;
  else button.onclick = () => openViewer(entry.id, button);
  cells.set(entry, button);
  thumbnailEntries.set(button, entry);
  if (thumbnailObserver) thumbnailObserver.observe(button);
  else setTimeout(() => queueThumbnail(button), 0);
  return button;
}

async function loadThumbnail(cell, entry) {
  const target = entry.file ? { url: entry.preview } : await mediaTarget(entry.id);
  if (!cell.isConnected) return;
  if (entry.kind === 'VIDEO' && !target.posterUrl) {
    const frame = await videoFrame(target.url);
    if (cell.isConnected) cell.prepend(frame);
    return;
  }
  const image = new Image();
  image.alt = '';
  image.decoding = 'async';
  const loaded = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 10000);
    image.onload = () => { clearTimeout(timer); resolve(true); };
    image.onerror = () => { clearTimeout(timer); resolve(false); };
    image.src = target.posterUrl || target.url;
  });
  if (!cell.isConnected) return;
  if (loaded) {
    const label = cell.querySelector('.cell-label');
    if (label) label.hidden = true;
    cell.prepend(image);
  } else if (entry.kind === 'VIDEO') {
    const frame = await videoFrame(target.url);
    if (cell.isConnected) cell.prepend(frame);
  }
}

function videoFrame(url) {
  return readVideo(url, 'auto', (video, finish) => {
    video.onloadedmetadata = () => {
      if (video.duration > 0.2) video.currentTime = 0.1;
    };
    const draw = () => {
      if (video.seeking || video.readyState < 2) return;
      try {
        const canvas = document.createElement('canvas');
        const scale = 256 / Math.max(video.videoWidth, video.videoHeight);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        // Display the frame in place. Cross-origin video may taint the canvas, so never read it back.
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas);
      } catch {
        finish(null);
      }
    };
    video.onloadeddata = draw;
    video.onseeked = draw;
  });
}

function readVideo(url, preload, setup) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = preload;
    video.muted = true;
    video.playsInline = true;
    const timer = setTimeout(() => finish(null), 10000);
    function finish(value) {
      clearTimeout(timer);
      video.onloadedmetadata = video.onloadeddata = video.onseeked = video.onerror = null;
      video.removeAttribute('src');
      video.load();
      if (value === null) reject(new Error('영상을 읽지 못했습니다.'));
      else resolve(value);
    }
    video.onerror = () => finish(null);
    setup(video, finish);
    video.src = url;
  });
}

async function videoDurationMs(url) {
  try {
    return await readVideo(url, 'metadata', (video, finish) => {
      video.onloadedmetadata = () => {
        const durationMs = Math.round(video.duration * 1000);
        finish(Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null);
      };
    });
  } catch {
    throw new Error('영상 길이를 읽지 못했습니다.');
  }
}

function labelButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.onclick = handler;
  return button;
}

function renderProgress(updateFailures) {
  const progress = byId('progress');
  progress.hidden = jobs.length === 0;
  if (progress.hidden) return;
  const done = jobs.filter((job) => job.state === 'done').length;
  const failed = jobs.filter((job) => job.state === 'failed');
  const allDone = done === jobs.length;
  const units = jobs.every((job) => job.kind === 'PHOTO') ? '장' : '개';
  const bytes = jobs.reduce((sum, job) => sum + job.size, 0);
  const loaded = jobs.reduce((sum, job) => sum + job.loaded, 0);
  const percent = allDone ? 100 : Math.min(99, Math.round(loaded / (bytes || 1) * 100));
  progress.toggleAttribute('data-done', allDone);
  byId('progress-label').textContent = (allDone ? '업로드 완료 ' : '업로드 중 ') +
    done + '/' + jobs.length + units + (failed.length ? ' · 실패 ' + failed.length : '');
  byId('percent').textContent = percent + '%';
  byId('track').setAttribute('aria-valuenow', String(percent));
  byId('fill').style.width = percent + '%';
  if (!updateFailures) return;
  const failures = byId('failures');
  failures.textContent = '';
  for (const job of failed) {
    const row = document.createElement('div');
    row.className = 'failed';
    const text = document.createElement('div');
    text.className = 'failure-text';
    const name = document.createElement('p');
    name.className = 'filename';
    name.textContent = job.file.name;
    const message = document.createElement('p');
    message.className = 'error-text';
    message.textContent = job.message;
    text.append(name, message);
    const retry = labelButton('다시 시도', () => upload([job]));
    retry.disabled = uploadActive;
    row.append(text, retry);
    failures.append(row);
  }
  if (failed.length > 1) {
    const retry = labelButton('실패한 항목 모두 다시 시도', () => upload(failed));
    retry.disabled = uploadActive;
    failures.append(retry);
  }
}

function failUpload(job, error) {
  job.state = 'failed';
  job.message = error.message || '업로드에 실패했습니다.';
  renderProgress(true);
}

function mimeType(file) {
  const types = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    mp4: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime',
  };
  return file.type || types[file.name.split('.').pop().toLowerCase()] || 'application/octet-stream';
}

async function reserveJobs(chunk) {
  const pending = [];
  const metadata = [];
  for (const job of chunk) {
    if (job.reservation && (job.sent || Date.parse(job.reservation.expiresAt) > Date.now())) continue;
    job.reservation = null;
    job.loaded = 0;
    try {
      const item = {
        kind: job.kind, mimeType: mimeType(job.file), sizeBytes: job.size,
        originalName: job.file.name.slice(0, 200),
      };
      if (job.kind === 'VIDEO') item.durationMs = await videoDurationMs(job.preview);
      pending.push(job);
      metadata.push(item);
    } catch (error) {
      failUpload(job, error);
    }
  }
  if (pending.length === 0) return;
  try {
    const result = await request('/reserve', { items: metadata });
    pending.forEach((job, index) => { job.reservation = result.items[index]; });
  } catch (error) {
    pending.forEach((job) => failUpload(job, error));
  }
}

function putFile(job) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', job.reservation.uploadUrl);
    for (const [name, value] of Object.entries(job.reservation.headers || {})) {
      if (name.toLowerCase() !== 'content-length') xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      job.loaded = Math.min(event.loaded, job.size);
      renderProgress(false);
    };
    const failure = () => reject(new Error('파일을 전송하지 못했습니다.'));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : failure();
    xhr.onerror = xhr.ontimeout = xhr.onabort = failure;
    xhr.timeout = 10 * 60 * 1000;
    xhr.send(job.file);
  });
}

async function transfer(job) {
  try {
    if (!job.sent) {
      if (Date.parse(job.reservation.expiresAt) <= Date.now()) {
        await reserveJobs([job]);
        if (!job.reservation) return;
      }
      await putFile(job);
      job.sent = true;
      job.loaded = job.size;
    }
    const { media } = await request('/complete', {
      assetId: job.reservation.id, sizeBytes: job.size,
    });
    items.delete(media.id);
    newest.set(media.id, media);
    job.state = 'done';
    renderGrid();
    URL.revokeObjectURL(job.preview);
    job.preview = job.file = job.reservation = null;
    renderProgress(true);
  } catch (error) {
    if (['UPLOAD_EXPIRED', 'UPLOAD_FAILED'].includes(error.code)) {
      job.reservation = null;
      job.sent = false;
    } else if (['OBJECT_MISSING', 'SIZE_MISMATCH', 'UNSUPPORTED_TYPE'].includes(error.code)) {
      job.sent = false;
    }
    if (!job.sent) job.loaded = 0;
    failUpload(job, error);
  }
}

async function upload(pending) {
  if (uploadActive) return;
  clearTimeout(clearProgress);
  uploadActive = true;
  byId('photos-button').disabled = byId('videos-button').disabled = true;
  for (const job of pending) job.state = 'queued';
  renderGrid();
  renderProgress(true);
  try {
    for (let index = 0; index < pending.length; index += 20) {
      const chunk = pending.slice(index, index + 20);
      await reserveJobs(chunk);
      for (const job of chunk) {
        if (job.state !== 'failed' && job.reservation) await transfer(job);
      }
    }
  } finally {
    uploadActive = false;
    byId('photos-button').disabled = byId('videos-button').disabled = false;
    renderProgress(true);
    if (jobs.every((job) => job.state === 'done')) {
      clearProgress = setTimeout(() => {
        jobs = [];
        renderProgress(true);
      }, 3000);
    }
  }
}

function bindPicker(id, kind) {
  const input = byId(id);
  byId(id + '-button').onclick = () => input.click();
  input.onchange = () => {
    const files = Array.from(input.files || []);
    input.value = '';
    if (files.length === 0 || uploadActive) return;
    if (jobs.every((job) => job.state === 'done')) jobs = [];
    const selected = files.map((file) => ({
      file, kind, size: file.size, preview: URL.createObjectURL(file), state: 'queued', loaded: 0,
    }));
    jobs = [...selected, ...jobs];
    void upload(selected);
  };
}
bindPicker('photos', 'PHOTO');
bindPicker('videos', 'VIDEO');

function updateViewerControls() {
  const list = readyItems();
  const index = list.findIndex((item) => item.id === viewedId);
  byId('counter').textContent = (index + 1) + ' / ' + list.length;
  byId('previous').disabled = index <= 0;
  byId('next').disabled = index >= list.length - 1;
}

function clearViewer() {
  const video = viewerContent.querySelector('video');
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
  viewerContent.textContent = '';
}

async function showMedia(id) {
  const sequence = ++viewerRequest;
  viewedId = id;
  updateViewerControls();
  clearViewer();
  viewerContent.textContent = '불러오는 중입니다.';
  try {
    const target = await mediaTarget(id);
    if (sequence !== viewerRequest) return;
    const node = document.createElement(target.kind === 'VIDEO' ? 'video' : 'img');
    if (target.kind === 'VIDEO') {
      node.controls = true;
      node.playsInline = true;
      if (target.posterUrl) node.poster = target.posterUrl;
    } else {
      node.alt = '사진';
    }
    node.onerror = () => {
      if (sequence !== viewerRequest) return;
      signed.delete(id);
      viewerContent.replaceChildren(labelButton('다시 시도', () => showMedia(id)));
      viewerContent.firstChild.focus();
    };
    node.src = target.url;
    viewerContent.replaceChildren(node);
  } catch (error) {
    if (sequence === viewerRequest) viewerContent.textContent = error.message || '사진·영상을 열지 못했습니다.';
  }
}

function openViewer(id, origin) {
  viewerOrigin = origin;
  viewer.hidden = false;
  document.body.classList.add('viewing');
  byId('page').setAttribute('inert', '');
  byId('close').focus();
  void showMedia(id);
}

function closeViewer() {
  viewerRequest++;
  viewedId = null;
  clearViewer();
  viewer.hidden = true;
  document.body.classList.remove('viewing');
  byId('page').removeAttribute('inert');
  if (viewerOrigin) viewerOrigin.focus();
  viewerOrigin = null;
}

function stepViewer(direction) {
  const list = readyItems();
  const item = list[list.findIndex((entry) => entry.id === viewedId) + direction];
  if (item) {
    byId('close').focus();
    void showMedia(item.id);
  }
}

byId('close').onclick = closeViewer;
byId('previous').onclick = () => stepViewer(-1);
byId('next').onclick = () => stepViewer(1);
document.addEventListener('keydown', (event) => {
  if (viewer.hidden) return;
  if (event.key === 'Escape') closeViewer();
  if (event.target.tagName === 'VIDEO') return;
  if (event.key === 'ArrowLeft') stepViewer(-1);
  if (event.key === 'ArrowRight') stepViewer(1);
  if (event.key === 'Tab') {
    const controls = Array.from(viewer.querySelectorAll('button:not(:disabled), video[controls]'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

void loadGallery(null);
`;
