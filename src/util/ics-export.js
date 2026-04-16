/**
 * Tiny iCalendar (.ics) builder. Emits a VCALENDAR with one VEVENT per
 * input record. Each event carries an optional 5-minute VALARM so
 * calendar apps remind the user before AOS / opportunity time.
 *
 * Designed to be reused by both the pass tracker (sat passes) and the
 * imaging planner (target opportunities).
 */

function escape(text) {
  return String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function fmt(date) {
  return new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Build an .ics document.
 *
 * @param {Array<{
 *   uid?: string,
 *   start: Date|string,
 *   end?: Date|string,
 *   summary: string,
 *   description?: string,
 *   location?: string,
 *   alarmMinutes?: number,
 * }>} events
 * @param {object} [opts]
 * @param {string} [opts.calendarName]
 * @param {string} [opts.prodId]
 */
export function buildIcs(events, opts = {}) {
  const name = opts.calendarName || 'Peyker';
  const prodId = opts.prodId || '-//Peyker//Satellite Planner//TR';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escape(name)}`,
  ];
  for (const ev of events) {
    const uid = ev.uid || `${Date.now()}-${Math.random().toString(36).slice(2)}@peyker`;
    const start = fmt(ev.start);
    const end = fmt(ev.end || new Date(new Date(ev.start).getTime() + 60_000));
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escape(ev.summary)}`,
    );
    if (ev.description) lines.push(`DESCRIPTION:${escape(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${escape(ev.location)}`);
    if (ev.alarmMinutes && ev.alarmMinutes > 0) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escape(ev.summary)}`,
        `TRIGGER:-PT${Math.round(ev.alarmMinutes)}M`,
        'END:VALARM',
      );
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Trigger a browser download for an .ics blob.
 */
export function downloadIcs(filename, ics) {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
