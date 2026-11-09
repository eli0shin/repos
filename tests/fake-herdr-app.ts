import { chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export type FakeHerdrAppSpace = {
  id: string;
  name: string;
  folder: string;
  machine: string | null;
  tabs: {
    id: string;
    name: string;
    terminals: { terminal: string; pane: string }[];
  }[];
};

export type FakeHerdrAppState = {
  window: boolean;
  nextId: number;
  spaces: FakeHerdrAppSpace[];
  selectedSpace: string | null;
  focusedPane: string | null;
  // Every pane focus moved to, in order.
  focusHistory: string[];
  // A herdr-core terminal labeled with an unknown space, which the window
  // adopts on its next listing.
  adopting: FakeHerdrAppSpace | null;
  raised: number;
  calls: string[][];
  failure?: { command: string; error: string };
};

const FAKE_HERDR_APP_SOURCE = String.raw`#!/usr/bin/env bun
const statePath = process.env.FAKE_HERDR_APP_STATE;
if (!statePath) process.exit(3);
const args = process.argv.slice(2);
const state = await Bun.file(statePath).json();
state.calls.push(args);
const save = () => Bun.write(statePath, JSON.stringify(state));
const reply = async (value, exitCode = 0) => {
  await save();
  console.log(JSON.stringify(value));
  process.exit(exitCode);
};
const focus = (pane) => {
  state.focusedPane = pane;
  if (pane) state.focusHistory.push(pane);
};
const select = (space) => {
  state.selectedSpace = space?.id ?? null;
  focus(space?.tabs[0]?.terminals[0]?.pane ?? null);
};

if (!state.window) {
  await save();
  console.error('herdr-app: no Herdr window at /fake/herdr-app.sock: No such file or directory (os error 2)');
  process.exit(2);
}
if (args.length === 0) {
  state.raised += 1;
  await save();
  process.exit(0);
}
if (args[0] === 'ls') {
  const listed = state.spaces.slice();
  if (state.adopting) {
    state.spaces.push(state.adopting);
    state.adopting = null;
  }
  await reply({ spaces: listed });
}
if (args[0] === 'status') {
  await reply({ space: state.selectedSpace, focused_pane: state.focusedPane });
}
if (args[0] !== 'do') await reply({ error: 'unsupported: ' + args.join(' ') }, 1);

const command = args[1];
const input = JSON.parse(args[2] ?? '{}');
if (state.failure?.command === command) await reply({ error: state.failure.error }, 1);
const space = state.spaces.find((candidate) => candidate.id === input.id);
if (command === 'space.new') {
  const n = state.nextId++;
  const created = {
    id: 'sp' + n,
    name: input.name,
    folder: input.folder,
    machine: null,
    tabs: [{ id: 'tb' + n, name: '1', terminals: [{ terminal: 't' + n, pane: 'pa' + n }] }],
  };
  state.spaces.push(created);
  select(created);
  await reply({ space: created.id, tab: 'tb' + n, terminal: 't' + n });
}
if (command === 'space.select') {
  if (!space) await reply({ error: 'no space ' + input.id }, 1);
  select(space);
  await reply({ ok: true });
}
if (command === 'space.rename') {
  if (!space) await reply({ error: 'no space ' + input.id }, 1);
  space.name = input.name;
  await reply({ ok: true });
}
if (command === 'space.close') {
  if (!space || input.confirmed !== true) await reply({ error: 'not closed' }, 1);
  state.spaces = state.spaces.filter((candidate) => candidate !== space);
  if (state.selectedSpace === space.id) select(state.spaces[0]);
  await reply({ ok: true });
}
if (command === 'pane.focus') {
  const owner = state.spaces.find((candidate) =>
    candidate.tabs.some((tab) => tab.terminals.some((t) => t.pane === input.pane))
  );
  if (!owner) await reply({ error: 'no pane ' + input.pane }, 1);
  state.selectedSpace = owner.id;
  focus(input.pane);
  await reply({ ok: true });
}
await reply({ error: 'unsupported: ' + command }, 1);
`;

// herdr-core's `hc run`: a terminal labeled with a space and tab joins the
// window, which adopts an unknown space id as a new space without focus.
const FAKE_HC_SOURCE = String.raw`#!/usr/bin/env bun
const statePath = process.env.FAKE_HERDR_APP_STATE;
if (!statePath) process.exit(3);
const args = process.argv.slice(2);
const state = await Bun.file(statePath).json();
state.calls.push(['hc', ...args]);
const save = () => Bun.write(statePath, JSON.stringify(state));
const command = 'hc ' + args[0];
if (state.failure?.command === command) {
  await save();
  console.error(state.failure.error);
  process.exit(1);
}
if (args[0] === 'run') {
  const value = (flag) => args[args.indexOf(flag) + 1];
  const labels = Object.fromEntries(
    args.flatMap((arg, i) => (args[i - 1] === '--label' ? [arg.split('=')] : []))
  );
  const n = state.nextId++;
  const cwd = value('--cwd');
  if (state.window && labels['herdr.space']) {
    state.adopting = {
      id: labels['herdr.space'],
      name: cwd.split('/').at(-1),
      folder: cwd,
      machine: null,
      tabs: [{ id: labels['herdr.tab'], name: '1', terminals: [{ terminal: 't' + n, pane: 'pa' + n }] }],
    };
  }
  await save();
  console.log(JSON.stringify({ address: 't' + n, state: 'live' }));
  process.exit(0);
}
await save();
process.exit(0);
`;

export async function createFakeHerdrApp(
  directory: string,
  initial: Partial<FakeHerdrAppState> = {}
): Promise<{ binary: string; statePath: string }> {
  await mkdir(directory, { recursive: true });
  const binary = join(directory, 'herdr-app');
  const statePath = join(directory, 'herdr-app-state.json');
  const state = {
    window: initial.window ?? true,
    nextId: initial.nextId ?? 1,
    spaces: initial.spaces ?? [],
    selectedSpace: initial.selectedSpace ?? null,
    focusedPane: initial.focusedPane ?? null,
    focusHistory: initial.focusHistory ?? [],
    adopting: initial.adopting ?? null,
    raised: initial.raised ?? 0,
    calls: initial.calls ?? [],
    ...(initial.failure ? { failure: initial.failure } : {}),
  } satisfies FakeHerdrAppState;
  await Bun.write(
    binary,
    FAKE_HERDR_APP_SOURCE.replace('#!/usr/bin/env bun', `#!${process.execPath}`)
  );
  await chmod(binary, 0o755);
  const core = join(directory, 'hc');
  await Bun.write(
    core,
    FAKE_HC_SOURCE.replace('#!/usr/bin/env bun', `#!${process.execPath}`)
  );
  await chmod(core, 0o755);
  await Bun.write(statePath, JSON.stringify(state));
  return { binary, statePath };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFakeHerdrAppState(value: unknown): value is FakeHerdrAppState {
  return (
    isRecord(value) &&
    typeof value.window === 'boolean' &&
    typeof value.nextId === 'number' &&
    Array.isArray(value.spaces) &&
    Array.isArray(value.focusHistory) &&
    typeof value.raised === 'number' &&
    Array.isArray(value.calls)
  );
}

export async function readFakeHerdrAppState(
  statePath: string
): Promise<FakeHerdrAppState> {
  const state: unknown = await Bun.file(statePath).json();
  if (!isFakeHerdrAppState(state)) {
    throw new Error('Invalid fake Herdr app state');
  }
  return state;
}

export function fakeSpace(
  id: string,
  name: string,
  folder: string,
  terminal = `t-${id}`
): FakeHerdrAppSpace {
  return {
    id,
    name,
    folder,
    machine: null,
    tabs: [
      {
        id: `tb-${id}`,
        name: '1',
        terminals: [{ terminal, pane: `pa-${id}` }],
      },
    ],
  };
}
