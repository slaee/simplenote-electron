const { contextBridge, ipcRenderer, remote } = require('electron');
const path = require('path');

// Lazy-load better-sqlite3 so tests or non-Electron environments that
// touch this file but don't actually execute the DB code won't break.
let db = null;
const getDb = () => {
  if (db) {
    return db;
  }

  // `remote.app` is already used below for dialogs, so we reuse it here
  // to locate the per-user application data directory.
  const Database = require('better-sqlite3');
  const userDataPath = remote.app.getPath('userData');
  const dbPath = path.join(userDataPath, 'notes.sqlite3');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // We keep the storage fairly generic: a single `state` table that stores
  // the serialized Redux persistence payload, and a `revisions` table that
  // stores per-note revision history.
  db.prepare(
    'CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
  ).run();
  db.prepare(
    'CREATE TABLE IF NOT EXISTS revisions (noteId TEXT PRIMARY KEY, data TEXT NOT NULL)'
  ).run();

  return db;
};

const validChannels = [
  'appCommand',
  'appStateUpdate',
  'clearCookies',
  'closeWindow',
  'editorCommand',
  'importNotes',
  'noteImportChannel',
  'reallyCloseWindow',
  'reload',
  'setAutoHideMenuBar',
  'tokenLogin',
  'wpLogin',
];

const electronAPI = {
  confirmLogout: (changes) => {
    const response = remote.dialog.showMessageBoxSync({
      type: 'warning',
      buttons: [
        'Export Unsynced Notes',
        "Don't Logout Yet",
        'Lose Changes and Logout',
      ],
      title: 'Unsynced Notes Detected',
      message:
        'Logging out will delete any unsynced notes. ' +
        'Do you want to continue or give it a little more time to finish trying to sync?\n\n' +
        changes,
    });

    switch (response) {
      case 0:
        return 'export';

      case 1:
        return 'reconsider';

      case 2:
        return 'logout';
    }
  },
  // SQLite-backed persistence helpers used by the renderer-side
  // `lib/state/persistence.ts` module when running under Electron.
  // These intentionally work with plain JSON so they can be safely
  // passed across the context bridge.
  loadPersistentState: () => {
    try {
      const database = getDb();
      const row = database
        .prepare('SELECT value FROM state WHERE key = ?')
        .get('state');
      if (!row) {
        return null;
      }
      return JSON.parse(row.value);
    } catch (e) {
      // If anything goes wrong, signal "no state"; the app will
      // simply start from an empty store.
      // eslint-disable-next-line no-console
      console.error('Failed to load persistent state from sqlite:', e);
      return null;
    }
  },
  savePersistentState: (data) => {
    try {
      const database = getDb();
      const value = JSON.stringify(data);
      database
        .prepare(
          'INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run('state', value);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save persistent state to sqlite:', e);
    }
  },
  loadAllRevisions: () => {
    try {
      const database = getDb();
      const rows = database.prepare('SELECT noteId, data FROM revisions').all();

      // Return as an array of [noteId, [ [version, note], ... ]] pairs
      return rows.map((row) => [row.noteId, JSON.parse(row.data)]);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load revisions from sqlite:', e);
      return [];
    }
  },
  saveNoteRevisions: (noteId, revisions) => {
    try {
      const database = getDb();
      const value = JSON.stringify(revisions);
      database
        .prepare(
          'INSERT INTO revisions (noteId, data) VALUES (?, ?) ON CONFLICT(noteId) DO UPDATE SET data = excluded.data'
        )
        .run(noteId, value);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save revisions to sqlite:', e);
    }
  },
  send: (channel, data) => {
    // allowed channels
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  receive: (channel, callback) => {
    if (validChannels.includes(channel)) {
      const newCallback = (_, data) => callback(data);
      ipcRenderer.on(channel, newCallback);
    }
  },
  removeListener: (channel) => {
    if (validChannels.includes(channel)) {
      ipcRenderer.removeAllListeners(channel);
    }
  },
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',
};

contextBridge.exposeInMainWorld('electron', electronAPI);

module.exports = {
  electronAPI: electronAPI,
};
