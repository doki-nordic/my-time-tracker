import type { TaskMap, StatusResponse } from './types';

const BASE = '.';
const FETCH_MAX_ATTEMPTS = 5;
const FETCH_RETRY_DELAY_MS = 350;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 503 || attempt === FETCH_MAX_ATTEMPTS) return res;
    await delay(FETCH_RETRY_DELAY_MS * attempt);
  }

  throw new Error(`Request failed after ${FETCH_MAX_ATTEMPTS} attempts: ${url}`);
}

async function parseJson(res: Response): Promise<StatusResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

export async function fetchTasks(): Promise<TaskMap> {
  const res = await fetchWithRetry(`${BASE}/status.php`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET status failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await parseJson(res);
  return data.tasks ?? {};
}

export async function updateTasks(
  uid: string,
  tasks: Record<string, Partial<{ deleted: boolean } & Record<string, unknown>>>,
): Promise<TaskMap> {
  const res = await fetchWithRetry(`${BASE}/status.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uid, tasks }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST status failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await parseJson(res);
  return data.tasks ?? {};
}
