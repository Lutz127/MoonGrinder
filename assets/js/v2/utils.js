import { DIFFICULTY_SLUGS } from './constants.js';

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}


export function gdBrowserLevelUrl(levelId) {
  return `https://gdbrowser.com/${encodeURIComponent(String(levelId ?? '').trim())}`;
}

export function gdBrowserUserUrl(creator) {
  return `https://gdbrowser.com/u/${encodeURIComponent(String(creator ?? '').trim())}`;
}

export function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Number(value) || 0);
}

export function formatDuration(seconds, options = {}) {
  const { compact = false, milliseconds = false } = options;
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return 'Unknown';
  const raw = Math.max(0, Number(seconds));
  const whole = Math.floor(raw);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  if (milliseconds) {
    const ms = Math.round((raw - whole) * 1000);
    if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    return `${minutes}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
  }

  if (compact) {
    if (hours) return `${hours}h ${minutes}m`;
    if (minutes) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }
  if (hours) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

export function formatDate(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function parseWholeNumber(value, fallback = 0, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

const RATING_ICON_SUFFIXES = {
  Rated: '',
  Featured: '_featured',
  Epic: '_epic',
  Legendary: '_legendary',
  Mythic: '_mythic',
};

export function difficultyBaseAsset(difficulty) {
  const slug = DIFFICULTY_SLUGS[difficulty] || 'na';
  return `./assets/images/difficulty/${slug}.png`;
}

export function difficultyAsset(difficulty, rating = 'Rated') {
  const slug = DIFFICULTY_SLUGS[difficulty] || 'na';
  if (slug === 'na') return difficultyBaseAsset(difficulty);
  const suffix = RATING_ICON_SUFFIXES[rating] ?? '';
  return `./assets/images/difficulty/${slug}${suffix}.png`;
}


export function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(String(text));
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = String(text);
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function debounce(fn, delay = 150) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function unique(values) {
  return [...new Set(values)];
}

export function parseTimeInput(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.max(0, Number(text));
  const parts = text.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}
