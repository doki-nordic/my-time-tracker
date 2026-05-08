export interface Task {
  id: string;
  name: string;
  active: boolean;
  order: number;
}

export interface TrackEntry {
  id: number;
  day: number;
  start_time: number;
  end_time: number;
  task: string;
  manual: number;
}

export type TaskMap = Record<string, Task>;

export interface StatusResponse {
  tasks: TaskMap;
}

export interface TaskTrackResponse {
  tasks: TaskMap;
  track: TrackEntry[];
}
