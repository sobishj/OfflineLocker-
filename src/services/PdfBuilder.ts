/**
 * Builds small PDFs without a native module.
 *
 * Adding a printing library would mean a native rebuild before sharing worked
 * on anyone's phone, and a network-free app has no business pulling in a
 * renderer for what amounts to "some text on a page" and "this photo on a
 * page". Both are assembled here by hand.
 *
 * A photo goes in as the JPEG it already is - PDF can hold one directly, so
 * the bytes are copied rather than decoded and re-encoded, and nothing is lost.
 */

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** A4 at 72dpi, which is what PDF measures in. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;

const FONT_SIZE = 12;
const LINE_HEIGHT = 15;
const TITLE_SIZE = 16;

/** Helvetica averages a little over half its point size per character. */
const CHARS_PER_LINE = Math.floor((PAGE_WIDTH - MARGIN * 2) / (FONT_SIZE * 0.5));
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);

const decodeBase64 = (input: string): string => {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof atob === 'function') {
    try { return atob(clean); } catch (e) { /* fall through */ }
  }
  const parts: string[] = [];
  let piece = '';
  for (let i = 0; i < clean.length; i += 4) {
    const c1 = B64_CHARS.indexOf(clean[i]);
    const c2 = B64_CHARS.indexOf(clean[i + 1]);
    const c3 = B64_CHARS.indexOf(clean[i + 2]);
    const c4 = B64_CHARS.indexOf(clean[i + 3]);
    piece += String.fromCharCode((c1 << 2) | (c2 >> 4));
    if (c3 >= 0) piece += String.fromCharCode(((c2 & 15) << 4) | (c3 >> 2));
    if (c4 >= 0) piece += String.fromCharCode(((c3 & 3) << 6) | c4);
    if (piece.length >= 8192) { parts.push(piece); piece = ''; }
  }
  if (piece) parts.push(piece);
  return parts.join('');
};

/** Latin-1 string to base64, in blocks so a large file does not build one character at a time. */
const encodeBase64 = (binary: string): string => {
  const parts: string[] = [];
  let piece = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i) & 0xff;
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) & 0xff : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) & 0xff : NaN;
    piece += B64_CHARS[a >> 2];
    piece += B64_CHARS[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    piece += isNaN(b) ? '=' : B64_CHARS[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    piece += isNaN(c) ? '=' : B64_CHARS[c & 63];
    if (piece.length >= 8192) { parts.push(piece); piece = ''; }
  }
  if (piece) parts.push(piece);
  return parts.join('');
};

/** Text as a PDF string literal: the three structural characters are escaped,
 *  anything outside Latin-1 becomes a question mark rather than corrupt bytes. */
const pdfString = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const char = text[i];
    if (char === '(' || char === ')' || char === '\\') out += '\\' + char;
    else if (code >= 32 && code <= 126) out += char;
    else if (code < 256) out += '\\' + code.toString(8).padStart(3, '0');
    else out += '?';
  }
  return out;
};

/** Breaks a paragraph at spaces, and mid-word only when a word is longer than a line. */
const wrap = (text: string, width: number): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      let piece = word;
      while (piece.length > width) {
        if (current) { lines.push(current); current = ''; }
        lines.push(piece.slice(0, width));
        piece = piece.slice(width);
      }
      if (!current) current = piece;
      else if (current.length + 1 + piece.length <= width) current += ' ' + piece;
      else { lines.push(current); current = piece; }
    }
    if (current) lines.push(current);
  }
  return lines;
};

interface PdfObject {
  /** The object body, already including its dictionary and any stream. */
  body: string;
}

/** Assembles numbered objects into a file, with the cross-reference table the
 *  format requires pointing at each one's byte offset. */
const assemble = (objects: PdfObject[]): string => {
  let file = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(file.length);
    file += `${index + 1} 0 obj\n${object.body}\nendobj\n`;
  });

  const xrefStart = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(offset => {
    file += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  });
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return file;
};

/** A note as a PDF: its name as a heading, then the body, wrapped and paged. */
export const buildTextPdf = (title: string, body: string): string => {
  const lines = wrap(body || '', CHARS_PER_LINE);
  const pages: string[][] = [];
  for (let i = 0; i < Math.max(lines.length, 1); i += LINES_PER_PAGE) {
    pages.push(lines.slice(i, i + LINES_PER_PAGE));
  }

  const objects: PdfObject[] = [];
  // 1 catalog, 2 pages, 3 font, then a page and a stream for each sheet
  const pageIds = pages.map((_, i) => 4 + i * 2);

  objects.push({ body: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    body: `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  });
  objects.push({ body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });

  pages.forEach((pageLines, pageIndex) => {
    let content = 'BT\n';
    let y = PAGE_HEIGHT - MARGIN;
    if (pageIndex === 0 && title) {
      content += `/F1 ${TITLE_SIZE} Tf\n1 0 0 1 ${MARGIN} ${y} Tm\n(${pdfString(title)}) Tj\n`;
      y -= TITLE_SIZE + 10;
    }
    content += `/F1 ${FONT_SIZE} Tf\n${LINE_HEIGHT} TL\n1 0 0 1 ${MARGIN} ${y} Tm\n`;
    pageLines.forEach(line => {
      content += `(${pdfString(line)}) Tj T*\n`;
    });
    content += 'ET';

    objects.push({
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] `
        + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[pageIndex] + 1} 0 R >>`,
    });
    objects.push({ body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` });
  });

  return encodeBase64(assemble(objects));
};

export interface PdfImage {
  /** JPEG data, base64, without the data: prefix. */
  base64: string;
  width: number;
  height: number;
}

/** One image per page, each scaled to fit the sheet with its aspect kept. */
export const buildImagePdf = (images: PdfImage[]): string => {
  const usable = images.filter(image => image.base64 && image.width > 0 && image.height > 0);
  if (usable.length === 0) return '';

  const objects: PdfObject[] = [];
  const pageIds = usable.map((_, i) => 3 + i * 3);

  objects.push({ body: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    body: `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${usable.length} >>`,
  });

  usable.forEach((image, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;

    const scale = Math.min(
      (PAGE_WIDTH - MARGIN * 2) / image.width,
      (PAGE_HEIGHT - MARGIN * 2) / image.height,
    );
    const drawWidth = Math.round(image.width * scale);
    const drawHeight = Math.round(image.height * scale);
    const x = Math.round((PAGE_WIDTH - drawWidth) / 2);
    const y = Math.round((PAGE_HEIGHT - drawHeight) / 2);

    const content = `q\n${drawWidth} 0 0 ${drawHeight} ${x} ${y} cm\n/Im0 Do\nQ`;
    const bytes = decodeBase64(image.base64);

    objects.push({
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] `
        + `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    });
    objects.push({ body: `<< /Length ${content.length} >>\nstream\n${content}\nendstream` });
    objects.push({
      body: `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} `
        + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\n`
        + `stream\n${bytes}\nendstream`,
    });
  });

  return encodeBase64(assemble(objects));
};
