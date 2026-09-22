// Content identification and bounded structural checks, not a decoder or a malware scan.
// Validate the exact buffer that will be staged; extensions may label, never authorize.
import fs from 'node:fs';
import path from 'node:path';
export const MEDIA_CAPS = Object.freeze({ image: 8_000_000, pdf: 20_000_000, audio: 30_000_000, video: 120_000_000, text: 8_000_000 });
const kinds = { png: ['image', 'image/png'], jpg: ['image', 'image/jpeg'], gif: ['image', 'image/gif'], webp: ['image', 'image/webp'], bmp: ['image', 'image/bmp'], pdf: ['pdf', 'application/pdf'], wav: ['audio', 'audio/wav'], flac: ['audio', 'audio/flac'], ogg: ['audio', 'audio/ogg'], mp3: ['audio', 'audio/mpeg'], m4a: ['audio', 'audio/mp4'], mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'], mkv: ['video', 'video/x-matroska'] };
const refuse = why => { throw Object.assign(new Error(`Media refused: ${why}`), { code: 'MOMM_MEDIA_INVALID' }); };
export function identifyMedia(b) {
  if (!Buffer.isBuffer(b) || !b.length) return refuse('empty input');
  const ascii = (start, end) => b.subarray(start, end).toString('latin1');
  let kind;
  if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let pos = 8, ihdr = false, idat = false, ended = false;
    while (pos + 12 <= b.length) {
      const n = b.readUInt32BE(pos), type = ascii(pos + 4, pos + 8);
      if (pos + n + 12 > b.length) return refuse('truncated PNG chunk');
      if (!ihdr && (type !== 'IHDR' || n !== 13 || !b.readUInt32BE(pos + 8) || !b.readUInt32BE(pos + 12))) return refuse('invalid PNG header');
      ihdr = true; if (type === 'IDAT' && n) idat = true;
      pos += n + 12;
      if (type === 'IEND') { ended = n === 0 && pos === b.length; break; }
    }
    if (!ended || !idat) return refuse('incomplete PNG'); kind = 'png';
  } else if (b[0] === 255 && b[1] === 216) {
    let pos = 2, frame = false, scan = false;
    while (pos + 4 <= b.length) {
      if (b[pos++] !== 255) return refuse('invalid JPEG marker');
      while (b[pos] === 255) pos++;
      const marker = b[pos++];
      if (pos + 2 > b.length) break;
      const n = b.readUInt16BE(pos);
      if (n < 2 || pos + n > b.length) return refuse('truncated JPEG segment');
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) frame = n >= 8;
      if (marker === 218) { scan = n >= 6; break; }
      pos += n;
    }
    if (!frame || !scan || b.length < 4 || b[b.length - 2] !== 255 || b[b.length - 1] !== 217) return refuse('incomplete JPEG'); kind = 'jpg';
  } else if (/^GIF8[79]a$/.test(ascii(0, 6))) {
    if (b.length < 14 || !b.readUInt16LE(6) || !b.readUInt16LE(8) || b[b.length - 1] !== 59) return refuse('incomplete GIF'); kind = 'gif';
  } else if (ascii(0, 4) === 'RIFF') {
    if (b.length < 20 || b.readUInt32LE(4) + 8 !== b.length) return refuse('truncated RIFF');
    const form = ascii(8, 12); let pos = 12, fmt = false, data = false;
    while (pos + 8 <= b.length) {
      const type = ascii(pos, pos + 4), n = b.readUInt32LE(pos + 4);
      if (pos + 8 + n > b.length) return refuse('truncated RIFF chunk');
      if (type === 'fmt ' && n >= 16) fmt = true;
      if (type === 'data' && n) data = true;
      pos += 8 + n + (n % 2);
    }
    if (pos !== b.length) return refuse('invalid RIFF boundary');
    if (form === 'WAVE' && fmt && data) kind = 'wav';
    else if (form === 'WEBP' && /^(VP8 |VP8L|VP8X)$/.test(ascii(12, 16))) kind = 'webp';
    else return refuse('unknown or incomplete RIFF');
  } else if (ascii(0, 2) === 'BM') {
    if (b.length < 54 || b.readUInt32LE(2) !== b.length || b.readUInt32LE(10) >= b.length) return refuse('incomplete BMP'); kind = 'bmp';
  } else if (/^%PDF-[12]\.\d/.test(ascii(0, 8))) {
    if (!/%%EOF\s*$/.test(ascii(Math.max(0, b.length - 1024), b.length)) || !/\b\d+\s+\d+\s+obj\b/.test(ascii(0, b.length))) return refuse('incomplete PDF'); kind = 'pdf';
  } else if (ascii(0, 4) === 'fLaC') {
    let p = 4, last = false;
    while (!last && p + 4 <= b.length) { last = !!(b[p] & 128); const n = b.readUIntBE(p + 1, 3); if (p === 4 && ((b[p] & 127) !== 0 || n !== 34)) return refuse('invalid FLAC streaminfo'); p += 4 + n; }
    if (!last || p >= b.length) return refuse('incomplete FLAC'); kind = 'flac';
  } else if (ascii(0, 4) === 'OggS') {
    let p = 0;
    while (p < b.length) { if (p + 27 > b.length || ascii(p, p + 4) !== 'OggS' || b[p + 4] !== 0) return refuse('incomplete Ogg'); const count = b[p + 26]; if (p + 27 + count > b.length) return refuse('truncated Ogg lacing'); let size = 0; for (let i = 0; i < count; i++) size += b[p + 27 + i]; p += 27 + count + size; }
    if (p !== b.length || (!b.includes(Buffer.from('OpusHead')) && !b.includes(Buffer.from('vorbis')))) return refuse('not a recognized Ogg audio stream'); kind = 'ogg';
  } else if (ascii(4, 8) === 'ftyp') {
    let p = 0, payload = false, movie = false;
    while (p < b.length) { if (p + 8 > b.length) return refuse('truncated ISO media box'); const n = b.readUInt32BE(p), type = ascii(p + 4, p + 8); if (n < 8 || p + n > b.length) return refuse('unsupported or truncated ISO media box'); if (type === 'mdat' && n > 8) payload = true; if (type === 'moov') movie = true; p += n; }
    if (!payload || !movie) return refuse('incomplete ISO media');
    const brand = ascii(8, 12); kind = brand === 'M4A ' ? 'm4a' : brand === 'qt  ' ? 'mov' : 'mp4';
  } else if (b.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'))) {
    const vint = (p, id = false) => { if (p >= b.length || !b[p]) return refuse('invalid EBML integer'); let len = 1; while (!(b[p] & (128 >> (len - 1)))) len++; if (len > (id ? 4 : 8) || p + len > b.length) return refuse('truncated EBML integer'); let n = BigInt(id ? b[p] : b[p] & ((128 >> (len - 1)) - 1)); for (let i = 1; i < len; i++) n = n * 256n + BigInt(b[p + i]); if (!id && n === (1n << BigInt(7 * len)) - 1n) return refuse('unbounded EBML segment'); if (n > BigInt(Number.MAX_SAFE_INTEGER)) return refuse('oversized EBML element'); return { n: Number(n), len }; };
    let p = 0, header = false, segment = false;
    while (p < b.length) { const id = vint(p, true); p += id.len; const size = vint(p); p += size.len; if (p + size.n > b.length) return refuse('truncated EBML element'); if (id.n === 0x1a45dfa3) { const doc = b.subarray(p, p + size.n); if (doc.includes(Buffer.from('webm'))) kind = 'webm'; else if (doc.includes(Buffer.from('matroska'))) kind = 'mkv'; header = !!kind; } if (id.n === 0x18538067 && size.n > 0) segment = true; p += size.n; }
    if (!header || !segment) return refuse('incomplete Matroska/WebM');
  } else if (ascii(0, 3) === 'ID3' || (b[0] === 255 && (b[1] & 224) === 224)) {
    let p = 0, frames = 0;
    if (ascii(0, 3) === 'ID3') { if (b.length < 10 || b.subarray(6, 10).some(x => x > 127)) return refuse('invalid ID3'); p = 10 + b[6] * 2097152 + b[7] * 16384 + b[8] * 128 + b[9] + ((b[5] & 16) ? 10 : 0); }
    while (p < b.length) {
      if (b.length - p === 128 && ascii(p, p + 3) === 'TAG') { p += 128; break; }
      if (p + 4 > b.length || b[p] !== 255 || (b[p + 1] & 224) !== 224) return refuse('invalid MP3 frame');
      const version = (b[p + 1] >> 3) & 3, layer = (b[p + 1] >> 1) & 3, bi = b[p + 2] >> 4, si = (b[p + 2] >> 2) & 3;
      if (version === 1 || layer !== 1 || !bi || bi === 15 || si === 3) return refuse('unsupported MPEG frame');
      const rates = version === 3 ? [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320] : [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
      const hz = [44100,48000,32000][si] / (version === 3 ? 1 : version === 2 ? 2 : 4);
      const length = Math.floor((version === 3 ? 144 : 72) * rates[bi] * 1000 / hz) + ((b[p + 2] >> 1) & 1);
      if (p + length > b.length) return refuse('truncated MP3 frame'); p += length; frames++;
    }
    if (!frames || p !== b.length) return refuse('incomplete MP3'); kind = 'mp3';
  } else return refuse('unknown bytes');
  return { format: kind, modality: kinds[kind][0], mime: kinds[kind][1] };
}
export function validateMedia(buffer, filename, { allowText = false } = {}) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  let detected;
  try { detected = identifyMedia(buffer); }
  catch (error) {
    if (!allowText || !['txt', 'md', 'json'].includes(ext) || !buffer.length || buffer.includes(0)) throw error;
    try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch { throw error; }
    // Recognizable binary signatures must never be relabelled as text.
    if (buffer[0] === 255 || buffer[0] === 137 || /^(?:%PDF-|GIF8|RIFF|fLaC|OggS|ID3|BM)/.test(buffer.subarray(0, 8).toString('latin1'))) throw error;
    detected = { format: ext, modality: 'text', mime: 'text/plain' };
  }
  if ((ext === 'jpeg' ? 'jpg' : ext) !== detected.format) return refuse(`bytes identify ${detected.format}, not .${ext || '(none)'}`);
  if (buffer.length > MEDIA_CAPS[detected.modality]) return refuse(`${detected.modality} byte limit exceeded`);
  return detected;
}
export function readMedia(file, options) {
  const absolute = path.resolve(file);
  // No link INSIDE the project tree (options.root, by default the working directory): a link planted in
  // a reviewed project could point at the user's private files. Folders ABOVE the project are the
  // machine's own layout (macOS reaches every temp folder through /var -> /private/var) and are not
  // refused. The file itself is never followed, wherever it lies.
  // Containment is decided on REAL paths. Deciding it on the literal path let an alias of the project
  // defeat the check: every component of /alias/... looked outside a root of /real/..., so no component
  // was inspected (independent audit of a5a37b5). A component is refused when it is a link AND the real
  // location of its parent is the project or inside it; folders above the project are the machine's own
  // layout (macOS reaches every temp folder through /var -> /private/var) and are not refused.
  const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const key = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const realRoot = key(real(path.resolve(options?.root ?? process.cwd())));
  const inProject = (p) => { const rel = path.relative(realRoot, key(real(p))); return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)); };
  if (fs.lstatSync(absolute).isSymbolicLink()) return refuse('symlink or junction path');
  for (let p = path.dirname(absolute); ; p = path.dirname(p)) {
    let entry; try { entry = fs.lstatSync(p); } catch { break; }
    if (entry.isSymbolicLink() && inProject(path.dirname(p))) return refuse('symlink or junction path');
    if (p === path.dirname(p)) break;
  }
  const before = fs.lstatSync(absolute);
  if (!before.isFile() || before.size > Math.max(...Object.values(MEDIA_CAPS))) return refuse('not a bounded regular file');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    // Windows lstat can report dev=0 while fstat reports the volume id (Node 22).
    if (!opened.isFile() || (before.dev !== 0 && opened.dev !== before.dev) || opened.ino !== before.ino || opened.size !== before.size) return refuse('file changed before read');
    const buffer = Buffer.alloc(opened.size); let n = 0;
    while (n < buffer.length) { const got = fs.readSync(fd, buffer, n, buffer.length - n, n); if (!got) return refuse('file shortened'); n += got; }
    const after = fs.fstatSync(fd);
    if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) return refuse('file changed during read');
    return { buffer, ...validateMedia(buffer, absolute, options) };
  } finally { fs.closeSync(fd); }
}
