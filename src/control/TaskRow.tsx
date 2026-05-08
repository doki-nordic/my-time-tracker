import { useState } from 'react';
import {
  TextField,
  IconButton,
  Checkbox,
  TableRow,
  TableCell,
  Tooltip,
  Popover,
  Box,
  Button,
  Typography,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  DragIndicator as DragIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Edit as EditIcon,
  AccessTime as TimeIcon,
} from '@mui/icons-material';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Task } from './types';
import { parseAdjustTime, formatDuration } from './timeUtils';

interface Props {
  task: Task;
  timeSpent: number;
  onSave: (id: string, changes: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onAdjustTime: (id: string, seconds: number) => void;
}

export default function TaskRow({ task, timeSpent, onSave, onDelete, onAdjustTime }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(task.name);
  const [adjustAnchor, setAdjustAnchor] = useState<HTMLElement | null>(null);
  const [adjustInput, setAdjustInput] = useState('');
  const [adjustError, setAdjustError] = useState('');

  const openAdjust = (el: HTMLElement) => {
    setAdjustInput('');
    setAdjustError('');
    setAdjustAnchor(el);
  };

  const submitAdjust = () => {
    const seconds = parseAdjustTime(adjustInput);
    if (seconds === null) {
      setAdjustError('Format: [+/-]H:MM or minutes. Range: -3:59 to +3:59');
      return;
    }
    onAdjustTime(task.id, seconds);
    setAdjustAnchor(null);
    setAdjustInput('');
    setAdjustError('');
  };

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
    setEditing(true);
  };

  const cancelEdit = () => { setEditing(false); };

  const saveEdit = () => {
    onSave(task.id, { name });
    setEditing(false);
  };

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
          <TextField
            size="small"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
          />
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
      <TableCell>{formatDuration(timeSpent)}</TableCell>
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
            <Tooltip title="Adjust time">
              <IconButton size="small" onClick={(e) => openAdjust(e.currentTarget)}>
                <TimeIcon fontSize="small" />
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
      <Popover
        open={Boolean(adjustAnchor)}
        anchorEl={adjustAnchor}
        onClose={() => setAdjustAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        disableRestoreFocus
      >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 220 }}>
          <Typography variant="subtitle2">Adjust time for {task.id}</Typography>
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
    </TableRow>
  );
}
