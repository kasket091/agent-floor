// Hides secrets in text before it is shown in the UI. Order matters: headers first.
export const MASK = '•••';

const KEYS = 'password|passwd|pwd|token|secret|api[_-]?key|apikey|key|auth';

const RULES = [
  // Authorization-style headers: mask to the closing quote or end of line.
  // Also JSON/JS forms: {"Authorization": "Bearer x"}, {Authorization: 'Bearer x'}.
  [/\b((?:Proxy-)?Authorization|X-Api-Key|Cookie)(["']?\s*:\s*["']?)[^"'\r\n]+/gi, `$1$2${MASK}`],
  // URL userinfo: scheme://user:pass@host
  // Scheme starts only at a token start and is bounded, so long runs cannot backtrack quadratically.
  [/((?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@]+):[^\s@/]+@/gi, `$1:${MASK}@`],
  // curl -u user:pass / --user user:pass
  [/((?:^|\s)(?:-u|--user)[\s=]+[^\s:]+):\S+/g, `$1:${MASK}`],
  // key/value and env assignments: password=x, "token": "x", WP_APP_PASSWORD=x
  // Quoted values are masked to the closing quote (or end of line).
  // Names start only at a token start and are bounded, so long dash/word runs cannot backtrack quadratically.
  [
    new RegExp(`(?<![\\w-])([\\w-]{0,64}?(?:${KEYS})[\\w-]{0,64})(["']?\\s*[:=]\\s*)("[^"\\r\\n]*"?|'[^'\\r\\n]*'?|[^\\s"'&,;]+)`, 'gi'),
    (_, name, sep, v) => name + sep + (v[0] === '"' || v[0] === "'" ? v[0] + MASK + v[0] : MASK),
  ],
  // Known token shapes
  [/\bgh[pousr]_[A-Za-z0-9]{36,}/g, MASK],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, MASK],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, MASK],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, MASK],
  [/\bAKIA[0-9A-Z]{16}\b/g, MASK],
  [/\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, MASK],
  // WordPress application password: six groups of four. Also hits six 4-letter words; hiding too much is the safer side.
  [/\b[A-Za-z0-9]{4}(?: [A-Za-z0-9]{4}){5}\b/g, MASK],
];

export function redact(text) {
  if (typeof text !== 'string') return text;
  return RULES.reduce((s, [re, to]) => s.replace(re, to), text);
}

export function redactDeep(value, maxString = 2000) {
  if (typeof value === 'string') return redact(value).slice(0, maxString);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, maxString));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactDeep(v, maxString)]));
  }
  return value;
}
