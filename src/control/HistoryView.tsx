import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Alert,
  IconButton,
  Tooltip,
  Popover,
  TextField,
  Button,
  Typography,
} from '@mui/material';
import { AccessTime as TimeIcon } from '@mui/icons-material';
import { fetchTaskTrack, adjustTrack, sendUpdateMessage } from './api';
import { parseAdjustTime, formatDuration } from './timeUtils';
import type { TrackEntry } from './types';

interface DayRow {
  day: number;
  label: string;
  workSeconds: number;
  adminSeconds: number;
}

function dayToLabel(day: number): string {
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  const d = day % 100;
  const names = ['Ni', 'Pn', 'Wt', 'Śr', 'Cz', 'Pi', 'So'];
  const dow = new Date(y, m - 1, d).getDay();
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')} ${names[dow]}`;
}

interface Props {
  uid: string;
}

export default function HistoryView({ uid }: Props) {
  const [days, setDays] = useState<DayRow[]>([]);
  const [error, setError] = useState('');
  const [adjustAnchor, setAdjustAnchor] = useState<HTMLElement | null>(null);
  const [adjustDay, setAdjustDay] = useState(0);
  const [adjustInput, setAdjustInput] = useState('');
  const [adjustError, setAdjustError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchTaskTrack(uid);
      const dayMap = new Map<number, number>();
      const adminMap = new Map<number, number>();
      for (const entry of data.track) {
        if (entry.task === 'prv') continue;
        const seconds = entry.end_time - entry.start_time;
        dayMap.set(entry.day, (dayMap.get(entry.day) ?? 0) + seconds);
        if (entry.task === 'admin') {
          adminMap.set(entry.day, (adminMap.get(entry.day) ?? 0) + seconds);
        }
      }
      const rows: DayRow[] = [];
      for (const [day, workSeconds] of dayMap) {
        rows.push({ day, label: dayToLabel(day), workSeconds, adminSeconds: adminMap.get(day) ?? 0 });
      }
      rows.sort((a, b) => b.day - a.day);
      setDays(rows);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const openAdjust = (el: HTMLElement, day: number) => {
    setAdjustDay(day);
    setAdjustInput('');
    setAdjustError('');
    setAdjustAnchor(el);
  };

  const submitAdjust = async () => {
    const seconds = parseAdjustTime(adjustInput);
    if (seconds === null) {
      setAdjustError('Format: [+/-]H:MM or minutes. Range: -3:59 to +3:59');
      return;
    }
    setAdjustAnchor(null);
    try {
      await adjustTrack(uid, adjustDay, 'admin', seconds);
      void sendUpdateMessage(uid);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="outlined" onClick={load}>Refresh</Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Work Time</TableCell>
              <TableCell>Admin Time</TableCell>
              <TableCell padding="none">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {days.map((row) => (
              <TableRow key={row.day} hover>
                <TableCell>{row.label}</TableCell>
                <TableCell>{formatDuration(row.workSeconds)}</TableCell>
                <TableCell>{formatDuration(row.adminSeconds)}</TableCell>
                <TableCell padding="none">
                  <Tooltip title="Adjust time">
                    <IconButton size="small" onClick={(e) => openAdjust(e.currentTarget, row.day)}>
                      <TimeIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
            {days.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center">No history yet</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Popover
        open={Boolean(adjustAnchor)}
        anchorEl={adjustAnchor}
        onClose={() => setAdjustAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        disableRestoreFocus
      >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 220 }}>
          <Typography variant="subtitle2">Adjust admin time for {dayToLabel(adjustDay)}</Typography>
          <TextField
            size="small"
            label="Time"
            placeholder="+1:30, -45, 2h 30m"
            value={adjustInput}
            onChange={(e) => { setAdjustInput(e.target.value); setAdjustError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && submitAdjust()}
            error={Boolean(adjustError)}
            helperText={adjustError || 'H:MM, minutes, or Xh Ym'}
            autoFocus
          />
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => setAdjustAnchor(null)}>Cancel</Button>
            <Button size="small" variant="contained" onClick={submitAdjust}>Apply</Button>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
}
