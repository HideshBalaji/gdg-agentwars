/**
 * Browser-side PII redaction for Demo mode, mirroring the backend's RegexDetector
 * (ghost_dispatcher/guardrails/pii.py): same patterns, checksums, type names and
 * [REDACTED:<TYPE>] markers. Live mode relies on the backend, which redacts the same way.
 */
import { uid } from './format';
import { addGuardrail, nowIso, toast } from './store';

// Word-ish boundaries keep identifiers such as TN-07, SHP-001 or hex IDs from matching.
const B = '(?<![\\w+@])';
const E = '(?![\\w@])';

const PATTERNS: Record<string, RegExp> = {
  EMAIL_ADDRESS: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  PHONE_NUMBER: new RegExp(
    B +
      '(?:' +
      '(?:\\+91[\\s-]?|0)?[6-9]\\d{4}[\\s-]?\\d{5}' + // Indian mobile
      '|\\+\\d{1,3}[\\s-]?(?:\\d[\\s-]?){6,12}\\d' + // international with country code
      '|\\(?0\\d{2,4}\\)?[\\s-]\\d{6,8}' + // landline with trunk prefix
      '|\\(?\\d{3}\\)?[\\s.-]\\d{3}[\\s.-]\\d{4}' + // North American
      ')' +
      E,
    'g',
  ),
  AADHAAR_NUMBER: new RegExp(B + '[2-9]\\d{3}[\\s-]?\\d{4}[\\s-]?\\d{4}' + E, 'g'),
  PAN_NUMBER: new RegExp(B + '[A-Z]{3}[ABCFGHLJPT][A-Z]\\d{4}[A-Z]' + E, 'g'),
  CREDIT_CARD_NUMBER: new RegExp(B + '(?:\\d[ -]?){12,18}\\d' + E, 'g'),
  VEHICLE_REGISTRATION: new RegExp(B + '[A-Z]{2}[\\s-]?\\d{1,2}[\\s-]?[A-Z]{1,3}[\\s-]?\\d{4}' + E, 'g'),
  STREET_ADDRESS: /\b(?:(?:house|flat|door|plot|apartment)\s*(?:no\.?|number|#)\s*[\w/-]+|(?:pin\s?code|pincode|postal code|zip code)\s*[:-]?\s*\d{5,6})\b/gi,
  DATE_OF_BIRTH: /\b(?:dob|date of birth|born on)\s*[:-]?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/gi,
};

// "my name is Ravi Kumar": case-insensitive cue followed by capitalised words.
const NAME_CUE = /\b(?:my name is|name is|i am|i'm|call me|contact person is|(?:driver|customer|receiver|contact)(?:'s)? name(?: is|:)?|mr\.?|mrs\.?|ms\.?|dr\.?|shri|smt\.?)\s+/gi;
const NAME = /^[A-Z][a-z]{2,}/;

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

const verhoeff = (digits: string) =>
  [...digits].reverse().reduce((c, d, i) => VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(d)]], 0) === 0;

const luhn = (digits: string) =>
  [...digits].reverse().reduce((sum, d, i) => {
    let v = Number(d);
    if (i % 2) v = v > 4 ? v * 2 - 9 : v * 2;
    return sum + v;
  }, 0) % 10 === 0;

function valid(kind: string, value: string) {
  const digits = value.replace(/\D/g, '');
  if (kind === 'AADHAAR_NUMBER') return digits.length === 12 && verhoeff(digits);
  if (kind === 'CREDIT_CARD_NUMBER') return digits.length >= 13 && digits.length <= 19 && luhn(digits);
  return true;
}

interface Finding {
  type: string;
  start: number;
  end: number;
}

/** Merged spans of personal data in `text`. */
function findPii(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const [kind, pattern] of Object.entries(PATTERNS)) {
    for (const m of text.matchAll(pattern)) {
      if (m.index !== undefined && valid(kind, m[0])) findings.push({ type: kind, start: m.index, end: m.index + m[0].length });
    }
  }
  for (const m of text.matchAll(NAME_CUE)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    const name = after.match(NAME);
    if (name) findings.push({ type: 'PERSON_NAME', start: m.index ?? 0, end: (m.index ?? 0) + m[0].length + name[0].length });
  }
  // Overlapping spans count once, attributed to the earliest/longest match (as the backend does).
  const merged: Finding[] = [];
  for (const f of findings.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged[merged.length - 1];
    if (last && f.start < last.end) {
      if (f.end > last.end) last.end = f.end;
      continue;
    }
    merged.push({ ...f });
  }
  return merged;
}

/** Types of personal data found in `text` (values are never returned). */
export function detectPii(text: string): string[] {
  return [...new Set(findPii(text).map((f) => f.type))].sort();
}

/** `text` with each finding replaced by [REDACTED:<TYPE>], plus the types found. */
export function redactPii(text: string): { text: string; types: string[] } {
  const findings = findPii(text);
  let redacted = text;
  for (const f of [...findings].reverse()) redacted = `${redacted.slice(0, f.start)}[REDACTED:${f.type}]${redacted.slice(f.end)}`;
  return { text: redacted, types: findings.map((f) => f.type) };
}

/**
 * Demo mode: redact personal data like the backend does, and record a guardrail event.
 * Returns the text to show and use from here on.
 */
export function redactIfPii(text: string, surface: 'chat' | 'feedback'): string {
  const { text: redacted, types } = redactPii(text);
  if (types.length) {
    addGuardrail({ id: uid('guard'), surface, action: 'redacted', types: [...new Set(types)].sort(), count: types.length, engine: 'regex (browser, demo mode)', at: nowIso() });
    toast({ tone: 'info', title: 'Personal information redacted', body: 'Refer to people by ID, e.g. DRV-007' });
  }
  return redacted;
}
