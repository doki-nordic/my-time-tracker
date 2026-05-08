import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Alert,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import type { Task, TaskMap } from './types';
import { fetchTasks, updateTasks, fetchTaskTrack, adjustTrack, sendUpdateMessage } from './api';
import TaskRowComponent from './TaskRow';

type Filter = 'all' | 'active' | 'inactive';

interface Props {
  uid: string;
}

export default function TaskList({ uid }: Props) {
  const [tasks, setTasks] = useState<TaskMap>({});
  const [order, setOrder] = useState<string[]>([]);
  const [timeByTask, setTimeByTask] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<Filter>('active');
  const [error, setError] = useState('');
  const [newId, setNewId] = useState('');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const load = useCallback(async () => {
    try {
      const t = await fetchTasks();
      setTasks(t);
      setOrder(() => {
        const ids = Object.keys(t);
        ids.sort((a, b) => t[a].order - t[b].order);
        return ids;
      });
      setError('');
    } catch (e) {
      setError(String(e));
    }
    try {
      const data = await fetchTaskTrack(uid);
      const totals: Record<string, number> = {};
      for (const entry of data.track) {
        const seconds = entry.end_time - entry.start_time;
        totals[entry.task] = (totals[entry.task] ?? 0) + seconds;
      }
      setTimeByTask(totals);
    } catch {
      // non-critical
    }
  }, [uid]);

  useEffect(() => { load(); }, [load]);

  const notify = () => { void sendUpdateMessage(uid); };

  const save = async (id: string, changes: Partial<Task>) => {
    try {
      const result = await updateTasks(uid, { [id]: changes });
      setTasks(result);
      setError('');
      notify();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await updateTasks(uid, { [id]: { deleted: true } as never });
      setTasks(result);
      setOrder((prev) => prev.filter((x) => x !== id));
      setError('');
      notify();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAdjustTime = async (taskId: string, seconds: number) => {
    const now = new Date();
    const d = now.getHours() < 4 ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now;
    const day = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    try {
      await adjustTrack(uid, day, taskId, seconds);
      await load();
      notify();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleAdd = async () => {
    const trimmed = newId.trim();
    if (!trimmed) return;
    const spaceIdx = trimmed.search(/\s/);
    const id = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
    const name = spaceIdx === -1 ? id : trimmed.slice(spaceIdx).trim() || id;
    if (tasks[id]) {
      setError(`Task with ID "${id}" already exists.`);
      return;
    }
    try {
      const result = await updateTasks(uid, {
        [id]: { name, active: true, order: order.length },
      });
      setTasks(result);
      setOrder((prev) => [...prev, id]);
      setNewId('');
      setError('');
      notify();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const newOrder = (() => {
        const oldIndex = order.indexOf(String(active.id));
        const newIndex = order.indexOf(String(over.id));
        return arrayMove(order, oldIndex, newIndex);
      })();
      setOrder(newOrder);

      // Persist order to server
      const orderUpdate: Record<string, { order: number }> = {};
      newOrder.forEach((id, idx) => {
        orderUpdate[id] = { order: idx };
      });
      try {
        const result = await updateTasks(uid, orderUpdate);
        setTasks(result);
        setError('');
        notify();
      } catch (e) {
        setError(String(e));
      }
    }
  };

  const visibleIds = order.filter((id) => {
    const task = tasks[id];
    if (!task) return false;
    if (filter === 'active') return task.active;
    if (filter === 'inactive') return !task.active;
    return true;
  });

  return (
    <Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          label="ID  name"
          placeholder="task-id Task Name"
          value={newId}
          onChange={(e) => setNewId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleAdd} disabled={!newId.trim()}>
          Add
        </Button>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          value={filter}
          exclusive
          onChange={(_, v) => v && setFilter(v)}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="active">Active</ToggleButton>
          <ToggleButton value="inactive">Inactive</ToggleButton>
        </ToggleButtonGroup>
        <Button variant="outlined" onClick={load}>Refresh</Button>
      </Box>

      <TableContainer component={Paper}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="none" sx={{ width: 32 }} />
                  <TableCell>ID</TableCell>
                  <TableCell>Name</TableCell>
                  <TableCell padding="checkbox">Active</TableCell>
                  <TableCell>Time</TableCell>
                  <TableCell padding="none">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleIds.map((id) => (
                  <TaskRowComponent
                    key={id}
                    task={tasks[id]}
                    timeSpent={timeByTask[id] ?? 0}
                    onSave={save}
                    onDelete={handleDelete}
                    onAdjustTime={handleAdjustTime}
                  />
                ))}
              </TableBody>
            </Table>
          </SortableContext>
        </DndContext>
      </TableContainer>
    </Box>
  );
}
