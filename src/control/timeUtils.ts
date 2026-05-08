/**
 * Parse adjustment time input. Accepts:
 *   [+|-]H:MM          — e.g. 1:30, -0:45
 *   [+|-]<number>      — plain minutes, e.g. 30, -15
 *   [+|-]Xh [Ym]       — suffix format, e.g. 1h, 2h 44m, 10m, -1h 30m
 * Returns seconds (signed), or null on invalid input.
 * Range: -3:59 to +3:59 (±14340 seconds).
 */
export function parseAdjustTime(input: string): number | null {
  const s = input.trim();
  if (!s) return null;

  const signMatch = s.match(/^([+-]?)\s*(.+)$/);
  if (!signMatch) return null;
  const sign = signMatch[1] === '-' ? -1 : 1;
  const body = signMatch[2];

  let totalSeconds: number | null = null;

  // Try suffix format: Xh [Ym] or Ym
  const suffixMatch = body.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);
  if (suffixMatch && (suffixMatch[1] !== undefined || suffixMatch[2] !== undefined)) {
    const hours = suffixMatch[1] ? parseInt(suffixMatch[1], 10) : 0;
    const minutes = suffixMatch[2] ? parseInt(suffixMatch[2], 10) : 0;
    if (minutes < 60) {
      totalSeconds = (hours * 60 + minutes) * 60;
    }
  }

  // Try H:MM format
  if (totalSeconds === null) {
    const colonMatch = body.match(/^(\d{1,2}):(\d{2})$/);
    if (colonMatch) {
      const hours = parseInt(colonMatch[1], 10);
      const minutes = parseInt(colonMatch[2], 10);
      if (minutes < 60) {
        totalSeconds = (hours * 60 + minutes) * 60;
      }
    }
  }

  // Try plain number (minutes)
  if (totalSeconds === null) {
    const plainMatch = body.match(/^(\d+)$/);
    if (plainMatch) {
      totalSeconds = parseInt(plainMatch[1], 10) * 60;
    }
  }

  if (totalSeconds === null || totalSeconds === 0) return null;
  if (totalSeconds > 14340) return null; // > 3:59

  return sign * totalSeconds;
}

export function formatDuration(seconds: number): string {
  if (seconds === 0) return '—';
  const neg = seconds < 0;
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const str = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return neg ? `-${str}` : str;
}
