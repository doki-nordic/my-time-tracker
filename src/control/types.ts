export interface Task {
  id: string;
  name: string;
  comment: string;
  plannedTime: number;
  timeSpent: number;
  timeAdjust: number;
  active: boolean;
  order?: number;
}

export type TaskMap = Record<string, Task>;

export interface StatusResponse {
  tasks: TaskMap;
}
