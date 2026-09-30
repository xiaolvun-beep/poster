function pad(n) { return String(n).padStart(2, '0') }
function dateTime(ms) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function day(ms) { return dateTime(ms).slice(0, 10) }
function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds % 3600 / 60))}:${pad(seconds % 60)}`
}
function money(cents) { return (Math.max(0, cents || 0) / 100).toFixed(2) }
function distance(meters) { return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters || 0)} m` }
module.exports = { dateTime, day, duration, money, distance }
