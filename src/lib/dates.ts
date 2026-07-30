/**
 * One date format for the whole dashboard. Timestamps were being built two
 * different ways — one on the server, one in the browser — so the same kind
 * of value rendered differently depending on where it was computed.
 *
 * House style: "Jul 30 · 12:12 AM". No seconds, no year (the year appears
 * only when it isn't the current one, so old records can't quietly lie).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-16" → "Sep 16" — parsed by hand so timezones can't shift the day. */
export function monthDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!m || !d || m < 1 || m > 12) return iso;
  const now = new Date().getFullYear();
  return `${MONTHS[m - 1]} ${d}${y && y !== now ? ` ${y}` : ""}`;
}

/** Date + time stamp: "Jul 30 · 12:12 AM". `utc` renders server-side-stable. */
export function stamp(iso: string, utc = false): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  const month = utc ? dt.getUTCMonth() : dt.getMonth();
  const day = utc ? dt.getUTCDate() : dt.getDate();
  const year = utc ? dt.getUTCFullYear() : dt.getFullYear();
  let hours = utc ? dt.getUTCHours() : dt.getHours();
  const mins = utc ? dt.getUTCMinutes() : dt.getMinutes();
  const meridiem = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  const nowYear = new Date().getFullYear();
  const yearPart = year !== nowYear ? ` ${year}` : "";
  return `${MONTHS[month]} ${day}${yearPart} · ${hours}:${String(mins).padStart(2, "0")} ${meridiem}`;
}
