import * as cfb from 'cfb';
import { fromBuffer } from 'yauzl';
import { AppError } from '../../../lib/errors.js';

const formats: Record<string, string[]> = {
  pdf: ['application/pdf'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ppt: ['application/vnd.ms-powerpoint'],
  pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  hwp: ['application/x-hwp', 'application/haansofthwp', 'application/vnd.hancom.hwp', 'application/hwp', 'application/x-ole-storage'],
  hwpx: ['application/vnd.hancom.hwpx', 'application/hwpx', 'application/zip', 'application/x-hwpx'],
  txt: ['text/plain'],
  csv: ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel'],
  jpg: ['image/jpeg', 'image/jpg'],
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  heic: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'],
  zip: ['application/zip', 'application/x-zip-compressed'],
};

export function unsupportedDocument(): AppError {
  return new AppError(415, 'DOCUMENT_TYPE', '지원하지 않거나 파일 내용이 형식과 일치하지 않습니다.');
}

export function documentFormat(name: string, mime?: string) {
  const extension = name.split('.').length > 1 ? name.split('.').at(-1)!.toLowerCase() : '';
  const types = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  const declared = mime?.split(';')[0]?.trim().toLowerCase();
  if (!types || (declared && declared !== 'application/octet-stream' && !types.includes(declared))) {
    throw unsupportedDocument();
  }
  return { extension, mimeType: types[0]! };
}

const executableEntry = /\.(?:exe|dll|com|msi|scr|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|sh|bash|apk|ipa|app|jar|lnk|desktop|reg|sys|dylib|so|elf|macho|xlam|docm|xlsm|pptm)$/i;
const prohibitedPackageEntry = /(?:^|\/)(?:vbaproject\.bin|activex|embeddings)(?:\/|$)/i;

function zipEntries(bytes: Buffer): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(unsupportedDocument());
      const names = new Set<string>();
      zip.on('error', () => reject(unsupportedDocument()));
      zip.on('end', () => resolve(names));
      zip.on('entry', (entry) => {
        const name = entry.fileName;
        const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (names.size >= 10000 || names.has(name) || entry.isEncrypted() || unixType === 0xa000 ||
            executableEntry.test(name.replace(/\/$/, '')) || prohibitedPackageEntry.test(name)) {
          zip.close();
          return reject(unsupportedDocument());
        }
        names.add(name);
        zip.readEntry();
      });
      zip.readEntry();
    });
  });
}

const zipMain: Record<string, string> = {
  docx: 'word/document.xml', xlsx: 'xl/workbook.xml', pptx: 'ppt/presentation.xml',
  hwpx: 'Contents/content.hpf',
};
const legacyMain: Record<string, string[]> = {
  doc: ['WordDocument'], xls: ['Workbook', 'Book'], ppt: ['PowerPoint Document'],
  hwp: ['FileHeader'],
};

export async function matchesDocument(extension: string, bytes: Buffer): Promise<boolean> {
  const ascii = (start: number, end: number) => bytes.toString('ascii', start, end);
  const hex = (length: number) => bytes.toString('hex', 0, length);
  if (Object.hasOwn(zipMain, extension) || extension === 'zip') {
    if (!['504b0304', '504b0506'].includes(hex(4))) return false;
    const names = await zipEntries(bytes);
    if (extension === 'zip') return true;
    return names.has(zipMain[extension]!) &&
      (extension === 'hwpx' ? names.has('mimetype') : names.has('[Content_Types].xml'));
  }
  if (Object.hasOwn(legacyMain, extension)) {
    // Parse only bounded compound documents. Old Office and HWP share the same signature.
    if (hex(8) !== 'd0cf11e0a1b11ae1') return false;
    try {
      const container = cfb.read(bytes, { type: 'buffer' });
      if (container.FullPaths.some((name) => /(?:^|\/)(?:vba|_vba_project_cur|macros|objectpool)(?:\/|$)/i.test(name))) return false;
      const entries = container.FileIndex.filter((entry) => entry.type === 2);
      if (extension === 'hwp') {
        const header = entries.find((entry) => entry.name === 'FileHeader');
        return !!header && Buffer.from(header.content).subarray(0, 17).toString() === 'HWP Document File';
      }
      return entries.some((entry) => legacyMain[extension]!.includes(entry.name));
    } catch {
      return false;
    }
  }

  switch (extension) {
    case 'pdf':
      return /^%PDF-\d\.\d/.test(ascii(0, 8)) && bytes.subarray(-4096).includes(Buffer.from('%%EOF'));
    case 'jpg': case 'jpeg': return hex(3) === 'ffd8ff' && bytes.subarray(-2).toString('hex') === 'ffd9';
    case 'png': return hex(8) === '89504e470d0a1a0a' && ascii(12, 16) === 'IHDR';
    case 'gif': return ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) && bytes.at(-1) === 0x3b;
    case 'webp': return bytes.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' &&
      bytes.readUInt32LE(4) + 8 === bytes.length;
    case 'heic': {
      if (bytes.length < 16 || ascii(4, 8) !== 'ftyp') return false;
      const end = bytes.readUInt32BE(0);
      if (end < 16 || end > bytes.length || end > 4096) return false;
      for (let i = 8; i + 4 <= end; i += 4) {
        if (i !== 12 && /^(?:heic|heix|hevc|hevx|heim|heis|hevm|hevs)$/.test(ascii(i, i + 4))) return true;
      }
      return false;
    }
    case 'txt': case 'csv': {
      try {
        const encoding = hex(2) === 'fffe' ? 'utf-16le' : hex(2) === 'feff' ? 'utf-16be' : 'utf-8';
        const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text);
      } catch {
        return false;
      }
    }
    default: return false;
  }
}
