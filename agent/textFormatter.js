const ENCODING_REPLACEMENTS = [
  ['\u00d4\u00c7\u00f6', '-'], // mojibake em dash
  ['\u00d4\u00c7\u00f4', '-'],
  ['\u00e2\u20ac\u201d', '-'], // mojibake em dash
  ['\u00e2\u20ac\u201c', '-'], // mojibake en dash / quote
  ['\u00e2\u20ac\u0153', '"'],
  ['\u00e2\u20ac\u009d', '"'],
  ['\u00e2\u20ac\u02dc', "'"],
  ['\u00e2\u20ac\u2122', "'"],
  ['\u00e2\u20ac\u00a6', '...'],
  ['\u00c3\u00a1', '\u00e1'],
  ['\u00c3\u00a0', '\u00e0'],
  ['\u00c3\u00a2', '\u00e2'],
  ['\u00c3\u00a3', '\u00e3'],
  ['\u00c3\u00a9', '\u00e9'],
  ['\u00c3\u00aa', '\u00ea'],
  ['\u00c3\u00ad', '\u00ed'],
  ['\u00c3\u00b3', '\u00f3'],
  ['\u00c3\u00b4', '\u00f4'],
  ['\u00c3\u00b5', '\u00f5'],
  ['\u00c3\u00ba', '\u00fa'],
  ['\u00c3\u00bc', '\u00fc'],
  ['\u00c3\u00a7', '\u00e7'],
  ['\u00c3\u0081', '\u00c1'],
  ['\u00c3\u0080', '\u00c0'],
  ['\u00c3\u0082', '\u00c2'],
  ['\u00c3\u0083', '\u00c3'],
  ['\u00c3\u0089', '\u00c9'],
  ['\u00c3\u008a', '\u00ca'],
  ['\u00c3\u008d', '\u00cd'],
  ['\u00c3\u0093', '\u00d3'],
  ['\u00c3\u0094', '\u00d4'],
  ['\u00c3\u0095', '\u00d5'],
  ['\u00c3\u009a', '\u00da'],
  ['\u00c3\u0087', '\u00c7'],
];

export function normalizeTextEncodingArtifacts(value) {
  let text = String(value ?? '').normalize('NFC');

  for (const [bad, good] of ENCODING_REPLACEMENTS) {
    text = text.split(bad).join(good);
  }

  return text
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\u21d2/g, '=>');
}

export function sanitizeWhatsAppText(value) {
  return normalizeTextEncodingArtifacts(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function sanitizeWhatsAppPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  if (payload.type === 'text' && payload.text?.body !== undefined) {
    return {
      ...payload,
      text: {
        ...payload.text,
        body: sanitizeWhatsAppText(payload.text.body),
      },
    };
  }

  return payload;
}
