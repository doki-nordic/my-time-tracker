import { useState } from 'react';
import {
  TextField,
  IconButton,
  Checkbox,
  TableRow,
  TableCell,
  Tooltip,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  DragIndicator as DragIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from './types';
import { formatTime, parseTime } from './timeUtils';

interface Props {
  task: Task;
  onSave: (id: string, changes: Partial<Task>) => void;
  onDelete: (id: string) => void;
}

export default function TaskRow({ task, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [comment, setComment] = useState(task.comment);
  const [plannedTime, setPlannedTime] = useState(formatTime(task.plannedTime));
  const [timeAdjust, setTimeAdjust] = useState(formatTime(task.timeAdjust));
  const [timeError, setTimeError] = useState<'planned' | 'adjust' | ''>('');

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const startEdit = () => {
    setName(task.name);
    setComment(task.comment);
    setPlannedTime(formatTime(task.plannedTime));
    setTimeAdjust(formatTime(task.timeAdjust));
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); setTimeError(''); };

  const saveEdit = () => {
    const pt = parseTime(plannedTime);
    const ta = parseTime(timeAdjust);
    if (pt === null) { setTimeError('planned'); return; }
    if (ta === null) { setTimeError('adjust'); return; }
    setTimeError('');
    onSave(task.id, { name, comment, plannedTime: pt, timeAdjust: ta });
    setEditing(false);
  };

  const totalTime = task.timeSpent + task.timeAdjust;

  return (
    <TableRow ref={setNodeRef} style={style} hover>
      <TableCell padding="none" sx={{ width: 32, cursor: 'grab' }}>
          <DragIcon fontSize="small"  {...attributes} {...listeners}/>
      </TableCell>
      <TableCell sx={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {task.id}
      </TableCell>
      <TableCell>
        {editing ? (
          <TextField size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
        ) : (
          task.name
        )}
      </TableCell>
      <TableCell padding="checkbox">
        <Checkbox
          checked={task.active}
          onChange={(_, checked) => onSave(task.id, { active: checked })}
        />
      </TableCell>
      <TableCell>
        {editing ? (
          <TextField size="small" fullWidth value={comment} onChange={(e) => setComment(e.target.value)} />
        ) : (
          task.comment
        )}
      </TableCell>
      <TableCell>
        {editing ? (
          <TextField
            size="small"
            value={plannedTime}
            onChange={(e) => { setPlannedTime(e.target.value); setTimeError(''); }}
            error={timeError === 'planned'}
            helperText={timeError === 'planned' ? 'e.g. 1d 2h 30m' : ''}
            sx={{ width: 120 }}
          />
        ) : (
          formatTime(task.plannedTime)
        )}
      </TableCell>
      <TableCell>{formatTime(totalTime)}</TableCell>
      <TableCell>
        {editing ? (
          <TextField
            size="small"
            value={timeAdjust}
            onChange={(e) => { setTimeAdjust(e.target.value); setTimeError(''); }}
            error={timeError === 'adjust'}
            helperText={timeError === 'adjust' ? 'e.g. 1d 2h 30m' : ''}
            sx={{ width: 120 }}
          />
        ) : (
          formatTime(task.timeAdjust)
        )}
      </TableCell>
      <TableCell padding="none">
        {editing ? (
          <>
            <Tooltip title="Save">
              <IconButton size="small" onClick={saveEdit} color="primary">
                <CheckIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Cancel">
              <IconButton size="small" onClick={cancelEdit}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={startEdit}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => onDelete(task.id)} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}
