const XOR_KEY = 11;

function decodeHtml(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value ?? '');
  return textarea.value.trim();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeXml(bytes) {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 80)).trimStart();
  return head.startsWith('<?xml') || head.startsWith('<plist');
}

function gdBase64BytesFromXoredBytes(xored) {
  // Match Python's base64.urlsafe_b64decode behavior used by the private
  // MoonGrinder tools as closely as possible. Geometry Dash saves are XOR'd
  // byte-for-byte with 11, then URL-safe Base64 decoded and gzip decompressed.
  //
  // Python's decoder is permissive about non-alphabet bytes. Browser atob()
  // is stricter, so sanitize the XOR result before decoding instead of feeding
  // the raw TextDecoder output directly to atob().
  const parts = [];
  const CHUNK = 0x8000;
  for (let i = 0; i < xored.length; i += CHUNK) {
    parts.push(String.fromCharCode(...xored.subarray(i, i + CHUNK)));
  }

  let compact = parts.join('')
    .replace(/[^A-Za-z0-9_\-=+/]/g, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');

  // Existing padding is not needed. Removing and recreating it also avoids
  // atob() rejecting malformed/multiple trailing padding characters.
  compact = compact.replace(/=/g, '');
  compact += '='.repeat((4 - (compact.length % 4)) % 4);

  let binary;
  try {
    binary = atob(compact);
  } catch (error) {
    console.error('GD save Base64 decode failed', error);
    throw new Error('MoonGrinder could not Base64-decode this Geometry Dash save. Make sure you selected CCGameManager.dat.');
  }

  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress Geometry Dash saves. Try a current Chrome, Edge, Firefox, or Safari build.');
  }

  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    throw new Error('MoonGrinder could not decompress this Geometry Dash save.');
  }
}

async function decodeGeometryDashSave(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  if (!raw.length) throw new Error('The selected file is empty.');

  if (looksLikeXml(raw)) return new TextDecoder('utf-8', { fatal: false }).decode(raw);

  const xored = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) xored[i] = raw[i] ^ XOR_KEY;

  const compressed = gdBase64BytesFromXoredBytes(xored);
  const xmlBytes = await gunzip(compressed);
  const xml = new TextDecoder('utf-8', { fatal: false }).decode(xmlBytes);

  if (!xml.includes('<plist') && !xml.includes('<k>GS_completed</k>') && !xml.includes('<k>GS_value</k>')) {
    throw new Error('The file decrypted, but the result does not look like CCGameManager.dat.');
  }

  return xml;
}

function findBalancedDictAfterKey(xml, key) {
  const marker = `<k>${key}</k>`;
  const keyPos = xml.indexOf(marker);
  if (keyPos < 0) throw new Error(`${key} was not found in the decoded Geometry Dash save.`);

  const open = '<d>';
  const close = '</d>';
  const start = xml.indexOf(open, keyPos + marker.length);
  if (start < 0) throw new Error(`${key} exists, but no dictionary follows it.`);

  let pos = start;
  let depth = 0;

  while (true) {
    const nextOpen = xml.indexOf(open, pos);
    const nextClose = xml.indexOf(close, pos);
    if (nextClose < 0) throw new Error(`Could not find the end of ${key}.`);

    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + open.length;
    } else {
      depth -= 1;
      if (depth === 0) return xml.slice(start + open.length, nextClose);
      pos = nextClose + close.length;
    }
  }
}

function findScalarAfterKey(fragment, key) {
  const escaped = escapeRegex(key);
  const tags = ['i', 'integer', 's', 'string', 'r', 'real'];

  for (const tag of tags) {
    const pattern = new RegExp(`<k>${escaped}<\\/k>\\s*<${tag}>([\\s\\S]*?)<\\/${tag}>`);
    const match = fragment.match(pattern);
    if (match) return decodeHtml(match[1]);
  }
  return null;
}

const COMPLETION_PREFIXES = [
  'c_', 'n_', 'd_', 'g_', 'e_',
  'star_', 'dstar_', 'gstar_',
  'demon_', 'ddemon_', 'gdemon_', 'pack_',
];

function extractCompletionMarkers(xml) {
  const section = findBalancedDictAfterKey(xml, 'GS_completed');
  const keyRegex = /<k>([\s\S]*?)<\/k>/g;
  const sets = Object.fromEntries(COMPLETION_PREFIXES.map((prefix) => [prefix, new Set()]));

  for (const match of section.matchAll(keyRegex)) {
    const key = decodeHtml(match[1]);
    for (const prefix of COMPLETION_PREFIXES) {
      if (!key.startsWith(prefix)) continue;
      const tail = key.slice(prefix.length);
      if (/^\d+$/.test(tail)) sets[prefix].add(String(Number(tail)));
      break;
    }
  }

  const byPrefix = {};
  for (const prefix of COMPLETION_PREFIXES) byPrefix[prefix] = [...sets[prefix]];
  return byPrefix;
}

function extractMoonCount(xml) {
  try {
    const section = findBalancedDictAfterKey(xml, 'GS_value');
    const raw = findScalarAfterKey(section, '28');
    if (raw == null) return null;
    const match = raw.match(/-?\d+/);
    return match ? Number(match[0]) : null;
  } catch {
    return null;
  }
}

export async function readGeometryDashSave(file) {
  if (!file) throw new Error('Choose CCGameManager.dat first.');

  if (String(file.name || '').toLowerCase().endsWith('.gmd')) {
    throw new Error('.gmd files contain Geometry Dash levels, not player completion data. Select CCGameManager.dat instead.');
  }

  const xml = await decodeGeometryDashSave(file);
  const completedByPrefix = extractCompletionMarkers(xml);
  const completedOnlineIds = completedByPrefix['c_'] || [];
  const moonCount = extractMoonCount(xml);

  if (!completedOnlineIds.length && moonCount == null) {
    throw new Error('MoonGrinder decoded the file, but could not find Geometry Dash completion data. Make sure this is CCGameManager.dat.');
  }

  return {
    completedOnlineIds,
    completedByPrefix,
    moonCount,
  };
}
