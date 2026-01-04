export type RepoEntry = {
  name: string;
  url: string;
  path: string;
  bare?: boolean;
};

export type UpdateBehavior = 'auto' | 'notify' | 'off';

export type ReposConfigSettings = {
  updateBehavior?: UpdateBehavior;
};

export type ReposConfig = {
  repos: RepoEntry[];
  config?: ReposConfigSettings;
};

export type OperationResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export type Platform = 'darwin' | 'linux';
export type Architecture = 'x64' | 'arm64';

export type UpdateState = {
  lastCheckedAt: number;
  pendingNotification?: string;
};
