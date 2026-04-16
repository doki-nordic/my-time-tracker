import { useState } from 'react';
import {
  Container,
  Tabs,
  Tab,
  Box,
  TextField,
  Button,
  Typography,
} from '@mui/material';
import TaskList from './TaskList';
import HistoryView from './HistoryView';

export default function App() {
  const [tab, setTab] = useState(0);
  const [uid, setUid] = useState(() => localStorage.getItem('control-uid') ?? '');
  const [uidInput, setUidInput] = useState(uid);

  const saveUid = () => {
    setUid(uidInput.trim());
    localStorage.setItem('control-uid', uidInput.trim());
  };

  if (!uid) {
    return (
      <Container maxWidth="sm" sx={{ mt: 4 }}>
        <Typography variant="h5" gutterBottom>Control Panel</Typography>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Enter UID. Control panel authenticates directly via UID in status.php.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            fullWidth
            size="small"
            label="UID"
            value={uidInput}
            onChange={(e) => setUidInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveUid()}
          />
          <Button variant="contained" onClick={saveUid} disabled={!uidInput.trim()}>
            Connect
          </Button>
        </Box>
      </Container>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="h5" sx={{ flex: 1 }}>Control Panel</Typography>
        <Button
          size="small"
          onClick={() => { setUid(''); localStorage.removeItem('control-uid'); }}
        >
          Disconnect
        </Button>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Tasks" />
        <Tab label="History" />
      </Tabs>
      {tab === 0 && <TaskList uid={uid} />}
      {tab === 1 && <HistoryView />}
    </Container>
  );
}
