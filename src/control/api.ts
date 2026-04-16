import type { TaskMap, StatusResponse } from './types';

const BASE = '';

async function parseJson(res: Response): Promise<StatusResponse> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

export async function fetchTasks(): Promise<TaskMap> {
  const res = await fetch(`${BASE}/status.php`);
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
  const res = await fetch(`${BASE}/status.php`, {
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
