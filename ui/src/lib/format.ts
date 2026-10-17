const TZ = 'Asia/Kolkata';

const hm = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ });
const hms = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: TZ,
});

const valid = (iso: string | number | undefined) => iso !== undefined && iso !== '' && !Number.isNaN(new Date(iso).getTime());
export const fmtTime = (iso?: string | number) => (valid(iso) ? hm.format(new Date(iso!)) : '—');
export const fmtClock = (iso?: string | number) => (valid(iso) ? hms.format(new Date(iso!)) : '--:--:--');

export function fmtDur(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

export function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export const fmtInr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

let seq = 0;
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;
