const SECONDS_PER_DAY = 8 * 3600; // 1 work day = 8 hours

export function formatTime(seconds: number): string {
  const neg = seconds < 0;
  const abs = Math.abs(seconds);
  const d = Math.floor(abs / SECONDS_PER_DAY);
  const h = Math.floor((abs % SECONDS_PER_DAY) / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return (neg ? '-' : '') + parts.join(' ');
}

export function parseTime(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return 0;

  const neg = trimmed.startsWith('-');
  const s = neg ? trimmed.slice(1).trim() : trimmed;

  // Support "Xd Yh Zm", any combination, or plain number as minutes
  const match = s.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?\s*(?:(\d+)\s*m?)?$/i);
  if (!match) return null;

  const days = match[1] ? parseInt(match[1], 10) : 0;
  const hours = match[2] ? parseInt(match[2], 10) : 0;
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  const total = days * SECONDS_PER_DAY + hours * 3600 + minutes * 60;
  return neg ? -total : total;
}
