// Test setup - runs before all tests
const herdrEnvironmentKeys = [
  'HERDR_ENV',
  'HERDR_SOCKET_PATH',
  'HERDR_CLIENT_SOCKET_PATH',
  'HERDR_SESSION',
  'HERDR_WORKSPACE_ID',
  'HERDR_TAB_ID',
  'HERDR_PANE_ID',
  'HERDR_BIN_PATH',
];

for (const key of herdrEnvironmentKeys) {
  Reflect.deleteProperty(process.env, key);
}
