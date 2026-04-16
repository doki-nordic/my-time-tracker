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
} from '@mui/material';
import type { Task, TaskMap } from './types';
import { fetchTasks } from './api';
import { formatTime } from './timeUtils';

interface DayEntry {
  date: string;
  workTime: number;
  adminTime: number;
}

export default function HistoryView() {
  const [days, setDays] = useState<DayEntry[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const tasks: TaskMap = await fetchTasks();
      const dayMap = new Map<string, DayEntry>();

      for (const [id, task] of Object.entries(tasks)) {
        let match: RegExpMatchArray | null;

        if ((match = id.match(/^-day-(\d{4}-\d{2}-\d{2})$/))) {
          const date = match[1];
          const entry = dayMap.get(date) ?? { date, workTime: 0, adminTime: 0 };
          entry.workTime = task.timeSpent + (task.timeAdjust ?? 0);
          dayMap.set(date, entry);
        } else if ((match = id.match(/^-admin-(\d{4}-\d{2}-\d{2})$/))) {
          const date = match[1];
          const entry = dayMap.get(date) ?? { date, workTime: 0, adminTime: 0 };
          entry.adminTime = task.timeSpent + (task.timeAdjust ?? 0);
          dayMap.set(date, entry);
        }
      }

      const sorted = [...dayMap.values()].sort((a, b) => b.date.localeCompare(a.date));
      setDays(sorted);
      setError('');
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              <TableCell>Work Time</TableCell>
              <TableCell>Admin Time</TableCell>
              <TableCell>Total</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.date} hover>
                <TableCell>{day.date}</TableCell>
                <TableCell>{formatTime(day.workTime)}</TableCell>
                <TableCell>{formatTime(day.adminTime)}</TableCell>
                <TableCell>{formatTime(day.workTime + day.adminTime)}</TableCell>
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
    </Box>
  );
}
