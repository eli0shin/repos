export type StackEntry = {
  parent: string;
  child: string;
};

export type RepoEntry = {
  name: string;
  url: string;
  path: string;
  bare?: boolean;
  stacks?: StackEntry[];
};

export type UpdateBehavior = 'auto' | 'notify' | 'off';
export type WorkspaceManagerProvider = 'herdr' | 'herdr-app';
// The app whose window the `herdr-app` provider drives. Both serve the same
// `ls | do | status` CLI.
export type HerdrFrontend = 'herdr-app' | 'herdr-frontend';

export type ReposConfigSettings = {
  updateBehavior?: UpdateBehavior;
  updateCheckIntervalHours?: number;
  workspaceManager?: WorkspaceManagerProvider;
};

export type ReposConfig = {
  repos: RepoEntry[];
  config?: ReposConfigSettings;
};

export type WorktreeSetupConfig = {
  copy?: string[];
  command?: string;
};

export type RepoWorktreeConfig = {
  setup?: WorktreeSetupConfig;
};

export type WorktreeSetupReport = {
  warnings: string[];
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
