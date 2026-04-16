import Swiper from 'swiper';
import 'swiper/css';
import './styles.css';

type AppMode = 'office' | 'home';
type ViewState = 'administration' | 'work' | 'private';

interface Task {
  id: string;
  name: string;
  comment?: string;
  plannedTime?: number;
  timeSpent?: number;
  timeAdjust?: number;
  active?: boolean;
  order?: number;
}

type TaskMap = Record<string, Task>;

interface LockRestoreState {
  viewState: ViewState;
  currentTaskId: string;
}

const SEP = '\n--------\nSePaRator\n--------\n';
const STATE_TASK_ID = '-status-state';
const MODE_KEY = 'status-mode';
const UID_KEY = 'status-uid';

const appEl = document.getElementById('app');
if (!appEl) throw new Error('Missing #app');

appEl.innerHTML = `
  <video id="keepawake-video" muted autoplay loop playsinline src="/keepalive.mp4"></video>

  <div class="topbar">
    <button class="mode-btn" id="mode-btn">In Office</button>
    <button class="uid-btn" id="uid-btn">UID</button>
  </div>

  <div class="swiper main-swiper" id="main-swiper">
    <div class="swiper-wrapper">
      <div class="swiper-slide state-admin">
        <div class="panel">
          <div class="center-block">Administration</div>
          <div class="bottom">
            <div class="metric" id="admin-total">Admin today: 0m</div>
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
            <div class="metric" id="task-planned">Planned: 0m</div>
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
const modeBtn = document.getElementById('mode-btn') as HTMLButtonElement;
const uidBtn = document.getElementById('uid-btn') as HTMLButtonElement;
const taskWrapper = document.getElementById('task-wrapper') as HTMLDivElement;
const adminTotalEl = document.getElementById('admin-total') as HTMLDivElement;
const workTotalAdminEl = document.getElementById('work-total-admin') as HTMLDivElement;
const workTotalWorkEl = document.getElementById('work-total-work') as HTMLDivElement;
const workTotalPrivateEl = document.getElementById('work-total-private') as HTMLDivElement;
const taskTimeEl = document.getElementById('task-time') as HTMLDivElement;
const taskPlannedEl = document.getElementById('task-planned') as HTMLDivElement;
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
let dirtyTaskIds = new Set<string>();
let metaDirty = true;
let lastTick = Date.now();
let authStale = false;

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

function todayKey(prefix: '-day-' | '-admin-'): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${prefix}${yyyy}-${mm}-${dd}`;
}

function ensureSpecialTask(id: string, name: string) {
  if (!tasks[id]) {
    tasks[id] = {
      id,
      name,
      comment: '',
      plannedTime: 0,
      timeSpent: 0,
      timeAdjust: 0,
      active: false,
    };
    dirtyTaskIds.add(id);
  }
}

function getTaskSeconds(id: string): number {
  const t = tasks[id];
  if (!t) return 0;
  return (t.timeSpent || 0) + (t.timeAdjust || 0);
}

function updateTotalsUI() {
  const dayId = todayKey('-day-');
  const adminId = todayKey('-admin-');
  const workTotal = getTaskSeconds(dayId);
  const adminTotal = getTaskSeconds(adminId);

  adminTotalEl.textContent = `Admin today: ${formatTime(adminTotal)}`;
  workTotalAdminEl.textContent = `Work today: ${formatTime(workTotal)}`;
  workTotalWorkEl.textContent = `Work today: ${formatTime(workTotal)}`;
  workTotalPrivateEl.textContent = `Work today: ${formatTime(workTotal)}`;

  const current = tasks[currentTaskId];
  const taskTime = current ? getTaskSeconds(currentTaskId) : 0;
  const planned = current?.plannedTime || 0;
  taskTimeEl.textContent = `Current task: ${formatTime(taskTime)}`;
  taskPlannedEl.textContent = `Planned: ${formatTime(planned)}`;
}

function sortedActiveTasks(map: TaskMap): Task[] {
  return Object.values(map)
    .filter((t) => typeof t.id === 'string' && t.id !== '' && !t.id.startsWith('-') && !!t.active)
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

function renderTaskSlides() {
  const activeTasks = sortedActiveTasks(tasks);
  activeTaskIds = activeTasks.map((t) => t.id);

  if (activeTasks.length === 0) {
    taskWrapper.innerHTML = `
      <div class="swiper-slide">
        <div class="task-card">
          <h2 class="task-name">No active tasks</h2>
          <p class="task-comment">Activate tasks in control panel.</p>
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
          <p class="task-comment">${escapeHtml(t.comment || '')}</p>
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
    metaDirty = true;
  }

  updateTotalsUI();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setMode(m: AppMode) {
  mode = m;
  localStorage.setItem(MODE_KEY, mode);
  modeBtn.textContent = mode === 'office' ? 'In Office' : 'At Home';
  modeBtn.classList.toggle('is-office', mode === 'office');
  modeBtn.classList.toggle('is-home', mode === 'home');
  metaDirty = true;
}

function setViewState(next: ViewState, source = 'internal') {
  viewState = next;
  if (source !== 'swiper') {
    mainSwiper.slideTo(next === 'administration' ? 0 : next === 'work' ? 1 : 2);
  }
  metaDirty = true;
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
    if (mode === 'office') {
      setViewState('administration');
    } else {
      setViewState('private');
    }
    return;
  }

  lockState = false;
  const restore = restoreStateBeforeLock;
  restoreStateBeforeLock = null;
  if (!restore) return;

  if (restore.viewState === 'work') {
    currentTaskId = restore.currentTaskId;
    setViewState('work');
    renderTaskSlides();
    return;
  }

  setViewState(restore.viewState);
}

function collectStatePatch(): Record<string, Partial<Task>> {
  const patch: Record<string, Partial<Task>> = {};
  for (const id of dirtyTaskIds) {
    const t = tasks[id];
    if (!t) continue;
    patch[id] = {
      id: t.id,
      name: t.name,
      comment: t.comment || '',
      plannedTime: t.plannedTime || 0,
      timeSpent: t.timeSpent || 0,
      timeAdjust: t.timeAdjust || 0,
      active: !!t.active,
      order: t.order,
    };
  }

  if (metaDirty) {
    patch[STATE_TASK_ID] = {
      id: STATE_TASK_ID,
      name: 'Status App State',
      comment: JSON.stringify({ mode, viewState, currentTaskId, lockState, ts: Date.now() }),
      active: false,
      plannedTime: 0,
      timeSpent: 0,
      timeAdjust: 0,
    };
  }

  return patch;
}

function normalizeTaskMap(raw: unknown): TaskMap {
  if (!raw || typeof raw !== 'object') return {};

  const out: TaskMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;

    const row = value as Record<string, unknown>;
    const rawId = row.id;
    const id =
      typeof rawId === 'string'
        ? rawId
        : typeof rawId === 'number'
          ? String(rawId)
          : key;
    if (!id) continue;

    const toNum = (v: unknown, fallback: number) => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
      return fallback;
    };

    out[id] = {
      id,
      name: typeof row.name === 'string' ? row.name : id,
      comment: typeof row.comment === 'string' ? row.comment : '',
      plannedTime: toNum(row.plannedTime, 0),
      timeSpent: toNum(row.timeSpent, 0),
      timeAdjust: toNum(row.timeAdjust, 0),
      active: !!row.active,
      order: row.order === undefined ? undefined : toNum(row.order, Number.MAX_SAFE_INTEGER),
    };
  }

  return out;
}

async function apiLogin(uidParam: string): Promise<string> {
  const url = `/login.php?uid=${encodeURIComponent(uidParam)}`;
  console.log(`[API] GET ${url}`);
  const res = await fetch(url);
  const txt = await res.text();
  console.log(`[API] Response status: ${res.status}, body: ${txt.slice(0, 200)}`);
  if (!res.ok) {
    throw new Error(`Login failed (${res.status}): ${txt.slice(0, 120)}`);
  }
  return txt.trim();
}

async function apiReadStatus(): Promise<TaskMap> {
  const url = '/status.php';
  console.log(`[API] GET ${url}`);
  const res = await fetch(url);
  const txt = await res.text();
  console.log(`[API] Response status: ${res.status}, body length: ${txt.length}`);
  if (!res.ok) throw new Error(`GET status failed (${res.status})`);
  const data = JSON.parse(txt) as { tasks?: TaskMap };
  return normalizeTaskMap(data.tasks || {});
}

async function apiPostStatus(patch: Record<string, Partial<Task>>) {
  const url = '/status.php';
  const body = JSON.stringify({ token, tasks: patch });
  console.log(`[API] POST ${url}`);
  console.log(`[API] Body: ${body.slice(0, 300)}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body,
  });
  const txt = await res.text();
  console.log(`[API] Response status: ${res.status}, body length: ${txt.length}`);
  if (res.status === 403) {
    throw new Error('AUTH_STALE: status.php returned 403.');
  }
  if (!res.ok) {
    throw new Error(`POST status failed (${res.status}): ${txt.slice(0, 160)}`);
  }
  const data = JSON.parse(txt) as { tasks?: TaskMap };
  return normalizeTaskMap(data.tasks || {});
}

async function apiReadMessages(): Promise<string[]> {
  const url = '/msg_read.php';
  const body = `token=${encodeURIComponent(token)}`;
  console.log(`[API] POST ${url}`);
  console.log(`[API] Body: ${body}`);
  console.log(`[API] Token value: "${token}" (length: ${token.length})`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  });
  const txt = await res.text();
  console.log(`[API] Response status: ${res.status}, body length: ${txt.length}`);
  if (res.status === 403) {
    throw new Error('AUTH_STALE: msg_read.php returned 403.');
  }
  if (!res.ok) {
    throw new Error(`msg_read failed (${res.status}): ${txt.slice(0, 160)}`);
  }
  if (!txt.trim()) return [];
  return txt
    .split(SEP)
    .map((x) => x.trim())
    .filter(Boolean);
}

function tickCounters() {
  const now = Date.now();
  const delta = Math.floor((now - lastTick) / 1000);
  if (delta <= 0) return;
  lastTick += delta * 1000;

  const dayId = todayKey('-day-');
  const adminId = todayKey('-admin-');
  ensureSpecialTask(dayId, `Day ${dayId.slice(5)}`);
  ensureSpecialTask(adminId, `Admin ${adminId.slice(7)}`);

  if (viewState === 'work' && currentTaskId && tasks[currentTaskId]) {
    tasks[currentTaskId].timeSpent = (tasks[currentTaskId].timeSpent || 0) + delta;
    tasks[dayId].timeSpent = (tasks[dayId].timeSpent || 0) + delta;
    dirtyTaskIds.add(currentTaskId);
    dirtyTaskIds.add(dayId);
  } else if (viewState === 'administration') {
    tasks[adminId].timeSpent = (tasks[adminId].timeSpent || 0) + delta;
    tasks[dayId].timeSpent = (tasks[dayId].timeSpent || 0) + delta;
    dirtyTaskIds.add(adminId);
    dirtyTaskIds.add(dayId);
  }

  updateTotalsUI();
}

async function syncState() {
  const patch = collectStatePatch();
  if (Object.keys(patch).length === 0) return;
  const serverTasks = await apiPostStatus(patch);
  tasks = { ...tasks, ...serverTasks };
  dirtyTaskIds.clear();
  metaDirty = false;
  renderTaskSlides();
}

function restoreFromMeta() {
  const meta = tasks[STATE_TASK_ID];
  if (!meta?.comment) return;
  try {
    const st = JSON.parse(meta.comment) as {
      mode?: AppMode;
      viewState?: ViewState;
      currentTaskId?: string;
    };
    if (st.mode === 'office' || st.mode === 'home') setMode(st.mode);
    if (st.currentTaskId) currentTaskId = st.currentTaskId;
    if (st.viewState === 'administration' || st.viewState === 'work' || st.viewState === 'private') {
      setViewState(st.viewState);
    }
  } catch {
    // Ignore malformed state
  }
}

async function pollMessagesLoop() {
  while (!authStale) {
    try {
      const messages = await apiReadMessages();
      for (const msg of messages) {
        if (msg === 'locked') applyLock(true);
        if (msg === 'unlocked') applyLock(false);
      }
      setError('');
    } catch (e) {
      if (String(e).includes('AUTH_STALE:')) {
        setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
        break;
      }
      setError(String(e));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function refreshTasks() {
  const incoming = await apiReadStatus();
  const keepDirty = new Set(dirtyTaskIds);
  const merged: TaskMap = { ...incoming };

  for (const id of keepDirty) {
    if (tasks[id]) merged[id] = tasks[id];
  }

  tasks = merged;
  restoreFromMeta();
  renderTaskSlides();
}

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

function wireEvents() {
  reconnectBtn.addEventListener('click', () => {
    window.location.reload();
  });

  modeBtn.addEventListener('click', () => {
    markUserInteraction();
    setMode(mode === 'office' ? 'home' : 'office');
  });

  uidBtn.addEventListener('click', async () => {
    const entered = (window.prompt('Set UID', uid) || '').trim();
    if (!entered) return;
    uid = entered;
    localStorage.setItem(UID_KEY, uid);
    token = await apiLogin(uid);
    metaDirty = true;
    setError('');
  });

  mainSwiper.on('slideChange', () => {
    const i = mainSwiper.activeIndex;
    const st: ViewState = i === 0 ? 'administration' : i === 1 ? 'work' : 'private';
    setViewState(st, 'swiper');
  });

  mainSwiper.on('touchStart', () => {
    markUserInteraction();
  });

  taskSwiper.on('slideChange', () => {
    const id = activeTaskIds[taskSwiper.activeIndex];
    if (id) {
      currentTaskId = id;
      metaDirty = true;
      updateTotalsUI();
    }
  });

  taskSwiper.on('touchStart', () => {
    markUserInteraction();
  });
}

async function bootstrap() {
  try {
    setMode(mode);
    wireEvents();
    await ensureUidAndToken();
    tasks = await apiReadStatus();
    restoreFromMeta();
    ensureSpecialTask(todayKey('-day-'), 'Day Counter');
    ensureSpecialTask(todayKey('-admin-'), 'Administration Counter');
    renderTaskSlides();

    setInterval(() => {
      tickCounters();
    }, 1000);

    setInterval(async () => {
      try {
        if (authStale) return;
        await syncState();
        setError('');
      } catch (e) {
        if (String(e).includes('AUTH_STALE:')) {
          setAuthStale('Session expired (403). Tap Reconnect to refresh token.');
          return;
        }
        setError(String(e));
      }
    }, 10000);

    setInterval(async () => {
      try {
        if (authStale) return;
        await refreshTasks();
        setError('');
      } catch (e) {
        setError(String(e));
      }
    }, 60000);

    void pollMessagesLoop();
  } catch (e) {
    setError(String(e));
  }
}

void bootstrap();
