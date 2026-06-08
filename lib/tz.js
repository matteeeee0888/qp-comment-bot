// lib/tz.js
// Convert a wall-clock date+time in a given IANA timezone to unix seconds.
export function zonedToUnix(dateStr, timeStr, timeZone) {
  const [Y, M, D] = dateStr.split("-").map(Number);
  const [h, m] = timeStr.split(":").map(Number);
  const utcGuess = Date.UTC(Y, M - 1, D, h, m, 0);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcGuess)).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second);
  const offset = asUTC - utcGuess;
  return Math.floor((utcGuess - offset) / 1000);
}
