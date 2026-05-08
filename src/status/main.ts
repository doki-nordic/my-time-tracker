import Swiper from 'swiper';
import 'swiper/css';
import './styles.css';

type AppMode = 'office' | 'home';
type ViewState = 'administration' | 'work' | 'private';

interface Task {
  id: string;
  name: string;
  active: boolean;
  order: number;
}

type TaskMap = Record<string, Task>;

interface TrackEntry {
  day: number;
  time: number;
  task: string;
}

interface TrackRow {
  id: number;
  day: number;
  start_time: number;
  end_time: number;
  task: string;
  manual: number;
}

interface LockRestoreState {
  viewState: ViewState;
  currentTaskId: string;
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
}

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
};

const SEP = '\n--------\nSePaRator\n--------\n';
const MODE_KEY = 'status-mode';
const UID_KEY = 'status-uid';
const TRACK_TASK_PRIVATE = 'prv';
const TRACK_TASK_ADMIN = 'admin';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('Missing #app');

appEl.innerHTML = `
  <video id="keepawake-video" muted autoplay loop playsinline src="./keepalive.mp4"></video>

  <div class="topbar">
    <div class="topbar-left">
      <button class="mode-btn" id="mode-btn">In Office</button>
      <button class="uid-btn" id="uid-btn">UID</button>
    </div>
    <button class="fullscreen-btn" id="fullscreen-btn">Full Screen</button>
  </div>

  <div class="swiper main-swiper" id="main-swiper">
    <div class="swiper-wrapper">
      <div class="swiper-slide state-admin">
        <div class="panel">
          <div class="center-block">Coffee, Meetings, e.t.c.</div>
          <div class="bottom">
            <div class="metric" id="admin-total">Meetings today: 0m</div>
            <div class="metric" id="work-total-admin">Work today: 0m</div>
          </div>
        </div>
      </div>

      <div class="swiper-slide state-work">
        <div class="panel">
          <div class="swiper task-swiper" id="task-swiper">
            <div class="swiper-wrapper" id="task-wrapper"></div>
          </div>
          <div class="bottom">
            <div class="metric" id="task-time">Current task: 0m</div>
            <div class="metric" id="work-total-work">Work today: 0m</div>
          </div>
        </div>
      </div>

      <div class="swiper-slide state-private">
        <div class="panel">
          <div class="center-block">Private</div>
          <div class="bottom">
            <div class="metric" id="work-total-private">Work today: 0m</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="error-box" id="error-box"></div>

  <div class="auth-overlay" id="auth-overlay">
    <div class="auth-card">
      <h2>Connection Lost</h2>
      <p id="auth-overlay-message">Session expired (403). Reconnect to refresh token.</p>
      <button id="reconnect-btn">Reconnect</button>
    </div>
  </div>
`;

const errorBox = document.getElementById('error-box') as HTMLDivElement;
const keepAwakeVideo = document.getElementById('keepawake-video') as HTMLVideoElement;
const modeBtn = document.getElementById('mode-btn') as HTMLButtonElement;
const uidBtn = document.getElementById('uid-btn') as HTMLButtonElement;
const fullscreenBtn = document.getElementById('fullscreen-btn') as HTMLButtonElement;
const taskWrapper = document.getElementById('task-wrapper') as HTMLDivElement;
const adminTotalEl = document.getElementById('admin-total') as HTMLDivElement;
const workTotalAdminEl = document.getElementById('work-total-admin') as HTMLDivElement;
const workTotalWorkEl = document.getElementById('work-total-work') as HTMLDivElement;
const workTotalPrivateEl = document.getElementById('work-total-private') as HTMLDivElement;
const taskTimeEl = document.getElementById('task-time') as HTMLDivElement;
const authOverlay = document.getElementById('auth-overlay') as HTMLDivElement;
const authOverlayMessage = document.getElementById('auth-overlay-message') as HTMLParagraphElement;
const reconnectBtn = document.getElementById('reconnect-btn') as HTMLButtonElement;

const mainSwiper = new Swiper('#main-swiper', {
  direction: 'horizontal',
  speed: 300,
  initialSlide: 1,
});

const taskSwiper = new Swiper('#task-swiper', {
  direction: 'vertical',
  speed: 250,
  nested: true,
  resistanceRatio: 0.2,
  touchRatio: 1,
});

let mode: AppMode = (localStorage.getItem(MODE_KEY) as AppMode) || 'office';
let viewState: ViewState = 'work';
let token = '';
let uid = '';
let tasks: TaskMap = {};
let activeTaskIds: string[] = [];
let currentTaskId = '';
let lockState = false;
let restoreStateBeforeLock: LockRestoreState | null = null;
let authStale = false;
let wakeLockSentinel: WakeLockSentinelLike | null = null;

/** Pending track entries to send (accumulated on error). */
let pendingTrackEntries: TrackEntry[] = [];
/** Track rows for the current day, returned by the last successful track request. */
let todayTrackRows: TrackRow[] = [];
/** Calculated time per task from track rows (seconds). */
let trackTimeByTask: Record<string, number> = {};
/** Total work time today from track rows (seconds). */
let trackWorkTotal = 0;
/** ID of the 30s track interval. */
let trackIntervalId: ReturnType<typeof setInterval> | null = null;
/** ID of the debounce timer for user-initiated state/task changes. */
let trackDebounceTimerId: ReturnType<typeof setTimeout> | null = null;
/** The track task ID from the last successful sendTrackNow call. */
let lastSentTrackTask = '';
/** Total (all-time) tracked time for the current work task (seconds). */
let totalTaskTime = 0;
/** Task ID for which totalTaskTime was last fetched. */
let totalTaskTimeFetchedFor = '';

class TrackPartialError extends Error {
  processed: number;
  constructor(message: string, processed: number) {
    super(message);
    this.processed = processed;
  }
}

const FETCH_MAX_ATTEMPTS = 5;
const FETCH_RETRY_DELAY_MS = 350;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Time helpers ---

/** Get current local time as seconds since midnight (0:00). */
function nowTimeSec(): number {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

/**
 * Get "tracking day" in BCD format. Day boundary is 4:00 AM:
 * from 0:00 to 3:59 belongs to the previous calendar day.
 */
function trackingDay(): number {
  const d = new Date();
  if (d.getHours() < 4) {
    d.setDate(d.getDate() - 1);
  }
  const yyyy = d.getFullYear();
  const mm = d.getMonth() + 1;
  const dd = d.getDate();
  return yyyy * 10000 + mm * 100 + dd;
}

// --- Wake lock ---

async function requestScreenWakeLock() {
  const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock;
  if (!wakeLockApi) return;
  if (document.visibilityState !== 'visible') return;
  if (wakeLockSentinel && !wakeLockSentinel.released) return;

  try {
    wakeLockSentinel = await wakeLockApi.request('screen');
  } catch {
    // No-op when wake lock is unavailable or denied.
  }
}

function wireWakeLock() {
  void keepAwakeVideo.play().catch(() => {});
  void requestScreenWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void requestScreenWakeLock();
    }
  });
}

// --- Fetch helpers ---

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 503 || attempt === FETCH_MAX_ATTEMPTS) return res;
    console.warn(`[API] ${url} returned 503, retrying (${attempt}/${FETCH_MAX_ATTEMPTS})...`);
    await delay(FETCH_RETRY_DELAY_MS * attempt);
  }
  throw new Error(`Request failed after ${FETCH_MAX_ATTEMPTS} attempts: ${url}`);
}

// --- UI helpers ---

function setError(message: string) {
  if (authStale) return;
  if (!message) {
    errorBox.textContent = '';
    errorBox.classList.remove('visible');
    return;
  }
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

function setAuthStale(message: string) {
  authStale = true;
  authOverlayMessage.textContent = message;
  authOverlay.classList.add('visible');
}

function formatTime(sec: number): string {
  const neg = sec < 0;
  const abs = Math.abs(sec);
  const d = Math.floor(abs / (8 * 3600));
  const h = Math.floor((abs % (8 * 3600)) / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const out: string[] = [];
  if (d > 0) out.push(`${d}d`);
  if (h > 0) out.push(`${h}h`);
  out.push(`${m}m`);
  return `${neg ? '-' : ''}${out.join(' ')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Track time calculation from server rows ---

function recalcTrackTimes() {
  trackTimeByTask = {};
  trackWorkTotal = 0;
  for (const row of todayTrackRows) {
    const duration = row.end_time - row.start_time;
    trackTimeByTask[row.task] = (trackTimeByTask[row.task] || 0) + duration;
    if (row.task !== TRACK_TASK_PRIVATE) {
      trackWorkTotal += duration;
    }
  }
}

function updateTotalsUI() {
  const adminTotal = trackTimeByTask[TRACK_TASK_ADMIN] || 0;
  const workTotal = trackWorkTotal;

  adminTotalEl.textContent = `Admin today: ${formatTime(adminTotal)}`;
  workTotalAdminEl.textContent = `Work today: ${formatTime(workTotal)}`;
  workTotalWorkEl.textContent = `Work today: ${formatTime(workTotal)}`;
  workTotalPrivateEl.textContent = `Work today: ${formatTime(workTotal)}`;

  taskTimeEl.textContent = `Current task: ${formatTime(totalTaskTime)}`;
}

async function fetchTotalTaskTime(): Promise<void> {
  const taskId = currentTaskId;
  if (!taskId || taskId === TRACK_TASK_PRIVATE || taskId === TRACK_TASK_ADMIN) {
    totalTaskTime = 0;
    totalTaskTimeFetchedFor = '';
    updateTotalsUI();
    return;
  }
  if (taskId === totalTaskTimeFetchedFor) return;
  try {
    const seconds = await apiTaskTrackTime(taskId);
    if (currentTaskId === taskId) {
      totalTaskTime = seconds;
      totalTaskTimeFetchedFor = taskId;
      updateTotalsUI();
    }
  } catch (e) {
    if (String(e).includes('AUTH_STALE:')) {
      setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
    }
  }
}

// --- Task rendering ---

function sortedActiveTasks(map: TaskMap): Task[] {
  return Object.values(map)
    .filter((t) => t.active)
    .sort((a, b) => a.order - b.order);
}

function renderTaskSlides() {
  const activeTasks = sortedActiveTasks(tasks);
  activeTaskIds = activeTasks.map((t) => t.id);

  if (activeTasks.length === 0) {
    taskWrapper.innerHTML = `
      <div class="swiper-slide">
        <div class="task-card">
          <h2 class="task-name">No active tasks</h2>
        </div>
      </div>
    `;
    currentTaskId = '';
    taskSwiper.update();
    updateTotalsUI();
    return;
  }

  taskWrapper.innerHTML = activeTasks
    .map(
      (t) => `
      <div class="swiper-slide" data-task-id="${t.id}">
        <div class="task-card">
          <div class="task-id">${escapeHtml(t.id)}</div>
          <h2 class="task-name">${escapeHtml(t.name || t.id)}</h2>
        </div>
      </div>
    `,
    )
    .join('');

  taskSwiper.update();

  const idx = currentTaskId ? activeTaskIds.indexOf(currentTaskId) : -1;
  if (idx >= 0) {
    taskSwiper.slideTo(idx, 0);
  } else {
    currentTaskId = activeTaskIds[0];
    taskSwiper.slideTo(0, 0);
  }

  updateTotalsUI();
}

// --- Mode / view state ---

function setMode(m: AppMode) {
  mode = m;
  localStorage.setItem(MODE_KEY, mode);
  modeBtn.textContent = mode === 'office' ? 'In Office' : 'At Home';
  modeBtn.classList.toggle('is-office', mode === 'office');
  modeBtn.classList.toggle('is-home', mode === 'home');
}

function setViewState(next: ViewState, source = 'internal') {
  viewState = next;
  if (source !== 'swiper') {
    mainSwiper.slideTo(next === 'administration' ? 0 : next === 'work' ? 1 : 2);
  }
}

function markUserInteraction() {
  if (!lockState) return;
  restoreStateBeforeLock = null;
}

function applyLock(locked: boolean) {
  if (locked === lockState) return;

  if (locked) {
    restoreStateBeforeLock = { viewState, currentTaskId };
    lockState = true;
    const oldTask = currentTrackTask();
    if (mode === 'office') {
      setViewState('administration');
    } else {
      setViewState('private');
    }
    void sendTrackNow(oldTask);
    return;
  }

  lockState = false;
  const restore = restoreStateBeforeLock;
  restoreStateBeforeLock = null;
  if (!restore) return;

  const oldTask = currentTrackTask();
  if (restore.viewState === 'work') {
    currentTaskId = restore.currentTaskId;
    setViewState('work');
    renderTaskSlides();
  } else {
    setViewState(restore.viewState);
  }
  void sendTrackNow(oldTask);
}

// --- API calls ---

async function apiLogin(uidParam: string): Promise<string> {
  const url = `./login.php?uid=${encodeURIComponent(uidParam)}`;
  const res = await fetchWithRetry(url);
  const txt = await res.text();
  if (!res.ok) throw new Error(`Login failed (${res.status}): ${txt.slice(0, 120)}`);
  return txt.trim();
}

async function apiReadStatus(): Promise<TaskMap> {
  const res = await fetchWithRetry('./status.php?active=1');
  const txt = await res.text();
  if (!res.ok) throw new Error(`GET status failed (${res.status})`);
  const data = JSON.parse(txt) as { tasks?: Record<string, Task> };
  return data.tasks || {};
}

async function apiTrack(entries: TrackEntry[]): Promise<TrackRow[]> {
  const res = await fetchWithRetry('./track.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, entries }),
  });
  const txt = await res.text();
  if (res.status === 403) {
    throw new Error('AUTH_STALE: track.php returned 403.');
  }
  if (!res.ok) {
    try {
      const errData = JSON.parse(txt) as { processed?: number };
      if (typeof errData.processed === 'number') {
        throw new TrackPartialError(`track.php failed (${res.status}): ${txt.slice(0, 160)}`, errData.processed);
      }
    } catch (parseErr) {
      if (parseErr instanceof TrackPartialError) throw parseErr;
    }
    throw new Error(`track.php failed (${res.status}): ${txt.slice(0, 160)}`);
  }
  const data = JSON.parse(txt) as { track: TrackRow[] };
  return data.track;
}

async function apiConfWrite(write: Record<string, unknown>): Promise<void> {
  const res = await fetchWithRetry('./conf.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, write }),
  });
  if (res.status === 403) throw new Error('AUTH_STALE: conf.php returned 403.');
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`conf.php write failed (${res.status}): ${txt.slice(0, 160)}`);
  }
}

async function apiConfRead(keys: string[]): Promise<Record<string, unknown>> {
  const res = await fetchWithRetry('./conf.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, read: keys }),
  });
  if (res.status === 403) throw new Error('AUTH_STALE: conf.php returned 403.');
  const txt = await res.text();
  if (!res.ok) throw new Error(`conf.php read failed (${res.status}): ${txt.slice(0, 160)}`);
  const data = JSON.parse(txt) as { conf: Record<string, unknown> };
  return data.conf;
}

async function apiTaskTrackTime(taskId: string): Promise<number> {
  const res = await fetchWithRetry(`./task_track.php?task=${encodeURIComponent(taskId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (res.status === 403) throw new Error('AUTH_STALE: task_track.php returned 403.');
  const txt = await res.text();
  if (!res.ok) throw new Error(`task_track.php failed (${res.status}): ${txt.slice(0, 160)}`);
  const data = JSON.parse(txt) as { track: TrackRow[] };
  let total = 0;
  for (const row of data.track) {
    total += row.end_time - row.start_time;
  }
  return total;
}

async function apiReadMessages(): Promise<string[]> {
  const res = await fetchWithRetry('./msg_read.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `token=${encodeURIComponent(token)}`,
  });
  const txt = await res.text();
  if (res.status === 403) throw new Error('AUTH_STALE: msg_read.php returned 403.');
  if (!res.ok) throw new Error(`msg_read failed (${res.status}): ${txt.slice(0, 160)}`);
  if (!txt.trim()) return [];
  return txt
    .split(SEP)
    .map((x) => x.trim())
    .filter(Boolean);
}

// --- Tracking logic ---

/** Returns the track task ID for the current view/task state. */
function currentTrackTask(): string {
  if (viewState === 'private') return TRACK_TASK_PRIVATE;
  if (viewState === 'administration') return TRACK_TASK_ADMIN;
  return currentTaskId;
}

/**
 * Send accumulated + current track entries. On error, accumulate for next time.
 * If oldTask is provided, two entries are sent with the same timestamp:
 * one closing the old task, one opening the new task.
 */
async function sendTrackNow(oldTask?: string): Promise<void> {
  const day = trackingDay();
  const time = nowTimeSec();
  if (oldTask) {
    pendingTrackEntries.push({ day, time, task: oldTask });
  }
  const task = currentTrackTask();
  if (task) {
    pendingTrackEntries.push({ day, time, task });
  }
  if (pendingTrackEntries.length === 0) return;

  const toSend = [...pendingTrackEntries];
  try {
    const rows = await apiTrack(toSend);
    pendingTrackEntries = [];
    todayTrackRows = rows;
    lastSentTrackTask = currentTrackTask();
    totalTaskTimeFetchedFor = '';
    recalcTrackTimes();
    updateTotalsUI();
    void fetchTotalTaskTime();
    setError('');
  } catch (e) {
    if (String(e).includes('AUTH_STALE:')) {
      setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
      return;
    }
    if (e instanceof TrackPartialError && e.processed > 0) {
      pendingTrackEntries.splice(0, e.processed);
      setError(`Partial track error, retrying... (${e.processed} processed)`);
      await delay(1000);
      void sendTrackNow();
      return;
    }
    // Keep entries pending for next attempt
    setError(String(e));
  }
}

/** Reschedule the periodic 30s track interval to fire 40s from now. */
function rescheduleTrackInterval() {
  if (trackIntervalId) clearInterval(trackIntervalId);
  trackIntervalId = setInterval(() => {
    if (authStale) {
      if (trackIntervalId) clearInterval(trackIntervalId);
      return;
    }
    void sendTrackNow();
  }, 30_000);
}

/**
 * Debounced track send for user-initiated changes.
 * Waits 10s after the last call; resets on each new call.
 * When it fires, reschedules the periodic interval to 40s from now
 * (10s debounce already elapsed + 30s normal period).
 */
function debouncedSendTrack() {
  if (trackDebounceTimerId) clearTimeout(trackDebounceTimerId);
  trackDebounceTimerId = setTimeout(() => {
    trackDebounceTimerId = null;
    const oldTask = lastSentTrackTask && lastSentTrackTask !== currentTrackTask() ? lastSentTrackTask : undefined;
    void sendTrackNow(oldTask);
    rescheduleTrackInterval();
  }, 10_000);
}

// --- Conf-based state persistence ---

async function saveAppState(): Promise<void> {
  try {
    await apiConfWrite({
      'status.mode': mode,
      'status.viewState': viewState,
      'status.currentTaskId': currentTaskId,
      'status.lockState': lockState ? 1 : 0,
      'status.ts': Date.now(),
    });
  } catch (e) {
    if (String(e).includes('AUTH_STALE:')) {
      setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
      return;
    }
    console.warn('[conf] save state failed:', e);
  }
}

async function restoreAppState(): Promise<void> {
  try {
    const conf = await apiConfRead([
      'status.mode',
      'status.viewState',
      'status.currentTaskId',
    ]);
    const m = conf['status.mode'];
    if (m === 'office' || m === 'home') setMode(m as AppMode);
    const ct = conf['status.currentTaskId'];
    if (typeof ct === 'string' && ct) currentTaskId = ct;
    const vs = conf['status.viewState'];
    if (vs === 'administration' || vs === 'work' || vs === 'private') {
      setViewState(vs as ViewState);
    }
  } catch (e) {
    if (String(e).includes('AUTH_STALE:')) {
      setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
      return;
    }
    console.warn('[conf] restore state failed:', e);
  }
}

// --- Message polling ---

async function pollMessagesLoop() {
  while (!authStale) {
    try {
      const messages = await apiReadMessages();
      for (const msg of messages) {
        if (msg === 'locked') applyLock(true);
        if (msg === 'unlocked') applyLock(false);
        if (msg === 'update') void handleRemoteUpdate();
      }
      setError('');
    } catch (e) {
      if (String(e).includes('AUTH_STALE:')) {
        setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
        break;
      }
      setError(String(e));
      await delay(3000);
    }
  }
}

async function handleRemoteUpdate(): Promise<void> {
  try {
    await refreshTasks();
    totalTaskTimeFetchedFor = '';
    void fetchTotalTaskTime();
    void sendTrackNow();
  } catch (e) {
    setError(String(e));
  }
}

// --- Task refresh ---

async function refreshTasks() {
  const incoming = await apiReadStatus();
  tasks = incoming;
  renderTaskSlides();
}

// --- UID / token ---

async function ensureUidAndToken() {
  const queryUid = new URLSearchParams(window.location.search).get('uid') || '';
  uid = queryUid || localStorage.getItem(UID_KEY) || '';

  if (!uid) {
    const entered = window.prompt('Enter UID for login.php') || '';
    uid = entered.trim();
  }
  if (!uid) throw new Error('UID is required. Use ?uid=... or set it via button.');

  localStorage.setItem(UID_KEY, uid);
  token = await apiLogin(uid);
}

// --- Events ---

function wireEvents() {
  reconnectBtn.addEventListener('click', () => {
    window.location.reload();
  });

  fullscreenBtn.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // No-op if fullscreen API is unavailable or denied.
    }
  });

  modeBtn.addEventListener('click', () => {
    markUserInteraction();
    setMode(mode === 'office' ? 'home' : 'office');
    void saveAppState();
  });

  uidBtn.addEventListener('click', async () => {
    const entered = (window.prompt('Set UID', uid) || '').trim();
    if (!entered) return;
    uid = entered;
    localStorage.setItem(UID_KEY, uid);
    token = await apiLogin(uid);
    setError('');
  });

  mainSwiper.on('slideChange', () => {
    const i = mainSwiper.activeIndex;
    const st: ViewState = i === 0 ? 'administration' : i === 1 ? 'work' : 'private';
    if (lockState && st !== viewState) {
      markUserInteraction();
    }
    setViewState(st, 'swiper');
    debouncedSendTrack();
    void saveAppState();
  });

  taskSwiper.on('slideChange', () => {
    const id = activeTaskIds[taskSwiper.activeIndex];
    if (id && id !== currentTaskId) {
      if (lockState) {
        markUserInteraction();
      }
      currentTaskId = id;
      void fetchTotalTaskTime();
      updateTotalsUI();
      debouncedSendTrack();
      void saveAppState();
    }
  });
}

// --- Bootstrap ---

async function bootstrap() {
  try {
    setMode(mode);
    wireWakeLock();
    wireEvents();
    await ensureUidAndToken();

    // Load tasks and restore state
    tasks = await apiReadStatus();
    await restoreAppState();
    renderTaskSlides();

    // Initial track to get today's data
    await sendTrackNow();
    void fetchTotalTaskTime();

    // Track every 30 seconds
    rescheduleTrackInterval();

    // Refresh task list every 60 seconds
    setInterval(async () => {
      if (authStale) return;
      try {
        await refreshTasks();
        setError('');
      } catch (e) {
        setError(String(e));
      }
    }, 60_000);

    // Save app state every 60 seconds
    setInterval(() => {
      if (authStale) return;
      void saveAppState();
    }, 60_000);

    void pollMessagesLoop();
  } catch (e) {
    setError(String(e));
  }
}

void bootstrap();
