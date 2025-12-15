const { contextBridge, ipcRenderer, remote } = require('electron');
const path = require('path');
const fs = require('fs');
const sanitizeFilename = require('sanitize-filename');

const NOTES_ROOT_NAME = 'SimpleNotes';
const META_DIR_NAME = '.simplenote';
const META_FILE_NAME = 'store.json';
const REVISIONS_FILE_NAME = 'revisions.json';

const getNotesRoot = () => {
  const documents = remote.app.getPath('documents');
  return path.join(documents, NOTES_ROOT_NAME);
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const readJsonFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to read JSON file:', filePath, e);
    return null;
  }
};

const writeJsonFile = (filePath, data) => {
  try {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to write JSON file:', filePath, e);
  }
};

const safeRmDir = (root, dirRel) => {
  try {
    if (!dirRel) return;
    const full = path.join(root, dirRel);
    // safety: only allow deleting within our root
    if (!full.startsWith(root)) {
      return;
    }
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Failed to delete directory:', dirRel, e);
  }
};

const ensureUniqueDirPath = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return dirPath;
  }
  const parent = path.dirname(dirPath);
  const base = path.basename(dirPath);
  for (let i = 2; i < 500; i++) {
    const candidate = path.join(parent, `${base} (${i})`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return dirPath;
};

const cleanupEmptyDirs = (startDir, stopDir) => {
  try {
    let cur = startDir;
    while (cur && cur.startsWith(stopDir) && cur !== stopDir) {
      if (!fs.existsSync(cur)) {
        cur = path.dirname(cur);
        continue;
      }
      const entries = fs.readdirSync(cur);
      if (entries.length > 0) {
        break;
      }
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    }
  } catch {
    // best-effort cleanup
  }
};

const safeName = (name, fallback) => {
  const cleaned = sanitizeFilename(String(name || '').trim()) || fallback;
  return cleaned.length > 0 ? cleaned : fallback;
};

const noteTitleFromContent = (content) => {
  const s = String(content || '');
  const match = /^\s*([^\n\r]{1,64})/m.exec(s);
  let title = match?.[1]?.trim() || 'New Note';
  // If the first line is a Markdown heading, strip the leading hashes.
  title = title.replace(/^\s*#{1,6}\s+/, '').trim();
  return title || 'New Note';
};

const buildFolderPath = (foldersArray, notebooksArray, folderId) => {
  const folders = new Map(foldersArray || []);
  const notebooks = new Map(notebooksArray || []);
  const parts = [];
  let cur = folderId;
  const seen = new Set();
  while (cur && folders.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    const folder = folders.get(cur);
    parts.unshift(safeName(folder.name, 'Folder'));
    cur = folder.parentFolderId || null;
  }

  // Include notebook name as the first path segment (keeps notebooks separate on disk)
  const topFolder =
    folderId && folders.has(folderId) ? folders.get(folderId) : null;
  const notebookId = topFolder?.notebookId;
  const notebook =
    notebookId && notebooks.has(notebookId) ? notebooks.get(notebookId) : null;
  const notebookName = safeName(notebook?.name ?? 'Notebook', 'Notebook');
  return [notebookName, ...parts];
};

const getOrCreateNoteDir = (
  root,
  foldersArray,
  notebooksArray,
  noteId,
  note
) => {
  const folderParts = buildFolderPath(
    foldersArray,
    notebooksArray,
    note.folderId || null
  );
  const folderDir = path.join(root, ...folderParts);
  ensureDir(folderDir);

  const title = noteTitleFromContent(note.content);
  const noteDirName = safeName(title, 'New Note');
  const noteDir = path.join(folderDir, noteDirName);
  ensureDir(noteDir);
  ensureDir(path.join(noteDir, 'assets'));

  const mdFile = path.join(noteDir, `${noteDirName}.md`);
  return { noteDir, mdFile, folderDir, noteDirName, folderParts };
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
  confirm: ({ title, message, detail } = {}) => {
    try {
      const response = remote.dialog.showMessageBoxSync({
        type: 'warning',
        buttons: ['Cancel', 'Delete'],
        defaultId: 0,
        cancelId: 0,
        title: title || 'Confirm',
        message: message || 'Are you sure?',
        detail: detail || undefined,
      });
      return response === 1;
    } catch (e) {
      return false;
    }
  },
  // Filesystem-backed persistence helpers used by the renderer-side
  // `lib/state/persistence.ts` module when running under Electron.
  loadPersistentState: () => {
    try {
      const root = getNotesRoot();
      const metaDir = path.join(root, META_DIR_NAME);
      const metaPath = path.join(metaDir, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath);
      if (!rawMeta) {
        return null;
      }

      // Rehydrate notes content from on-disk markdown files.
      // `rawMeta` is expected to be the same shape as the old persisted payload,
      // except that note contents may be omitted or stale.
      const rootFolders = rawMeta.folders ?? [];
      const notesArray = rawMeta.notes ?? [];
      const notePaths = rawMeta.notePaths ?? {};
      const hydratedNotes = notesArray.map(([noteId, note]) => {
        try {
          const mdRel = notePaths?.[noteId]?.mdRel;
          const mdFile = mdRel ? path.join(root, mdRel) : null;
          if (mdFile && fs.existsSync(mdFile)) {
            const content = fs.readFileSync(mdFile, 'utf8');
            return [noteId, { ...note, content }];
          }
        } catch (e) {
          // ignore per-note read errors
        }
        return [noteId, note];
      });

      return { ...rawMeta, notes: hydratedNotes };
    } catch (e) {
      // If anything goes wrong, signal "no state"; the app will
      // simply start from an empty store.
      // eslint-disable-next-line no-console
      console.error('Failed to load persistent state from filesystem:', e);
      return null;
    }
  },
  savePersistentState: (data) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);

      // Persist metadata
      const metaDir = path.join(root, META_DIR_NAME);
      const metaPath = path.join(metaDir, META_FILE_NAME);
      const previousMeta = readJsonFile(metaPath) ?? {};
      const prevNotePaths = previousMeta.notePaths ?? {};

      // Store metadata without duplicating full note contents; the markdown files are the source of truth.
      const notesArray = data.notes ?? [];
      const metaNotes = notesArray.map(([noteId, note]) => {
        if (!note) {
          return [noteId, note];
        }
        // Keep everything except content.
        const { content, ...rest } = note;
        return [noteId, rest];
      });

      // Persist each note as a folder containing <Title>.md and assets/
      const foldersArray = data.folders ?? [];
      const notebooksArray = data.notebooks ?? [];
      const nextNotePaths = { ...(previousMeta.notePaths ?? {}) };
      const activeNoteIds = new Set();
      notesArray.forEach(([noteId, note]) => {
        if (!note) {
          return;
        }
        if (note.deleted) {
          // Remove deleted notes from disk if we have a previous path.
          safeRmDir(root, prevNotePaths?.[noteId]?.dirRel);
          delete nextNotePaths[noteId];
          return;
        }
        activeNoteIds.add(noteId);
        const prevDirRel = prevNotePaths?.[noteId]?.dirRel;
        const prevDir = prevDirRel ? path.join(root, prevDirRel) : null;

        const { mdFile: desiredMdFile, noteDir: desiredNoteDir } =
          getOrCreateNoteDir(root, foldersArray, notebooksArray, noteId, note);
        let finalNoteDir = desiredNoteDir;
        let finalMdFile = desiredMdFile;

        if (
          prevDir &&
          fs.existsSync(prevDir) &&
          path.resolve(prevDir) !== path.resolve(desiredNoteDir)
        ) {
          ensureDir(path.dirname(desiredNoteDir));
          const uniqueTarget = ensureUniqueDirPath(desiredNoteDir);
          fs.renameSync(prevDir, uniqueTarget);
          cleanupEmptyDirs(path.dirname(prevDir), root);
          finalNoteDir = uniqueTarget;
          const newDirName = path.basename(uniqueTarget);
          finalMdFile = path.join(uniqueTarget, `${newDirName}.md`);
        }

        ensureDir(finalNoteDir);
        ensureDir(path.join(finalNoteDir, 'assets'));
        ensureDir(path.dirname(finalMdFile));
        fs.writeFileSync(finalMdFile, String(note.content || ''), 'utf8');

        nextNotePaths[noteId] = {
          dirRel: path.relative(root, finalNoteDir),
          mdRel: path.relative(root, finalMdFile),
        };
      });

      // Cleanup notes that disappeared entirely (e.g. deleted forever).
      Object.keys(prevNotePaths).forEach((noteId) => {
        if (!activeNoteIds.has(noteId) && !nextNotePaths[noteId]) {
          safeRmDir(root, prevNotePaths?.[noteId]?.dirRel);
          delete nextNotePaths[noteId];
        }
      });

      writeJsonFile(metaPath, {
        ...data,
        notes: metaNotes,
        notePaths: nextNotePaths,
      });

      // Cleanup empty directories that may remain after moves/deletes.
      cleanupEmptyDirs(path.join(root, META_DIR_NAME), root);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save persistent state to filesystem:', e);
    }
  },
  loadAllRevisions: () => {
    try {
      const root = getNotesRoot();
      const revisionsPath = path.join(root, META_DIR_NAME, REVISIONS_FILE_NAME);
      const data = readJsonFile(revisionsPath);
      return Array.isArray(data) ? data : [];
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load revisions from filesystem:', e);
      return [];
    }
  },
  saveNoteRevisions: (noteId, revisions) => {
    try {
      const root = getNotesRoot();
      const revisionsPath = path.join(root, META_DIR_NAME, REVISIONS_FILE_NAME);
      const existing = readJsonFile(revisionsPath) ?? [];
      const map = new Map(existing);
      map.set(noteId, revisions);
      writeJsonFile(revisionsPath, Array.from(map.entries()));
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save revisions to filesystem:', e);
    }
  },
  saveNoteAssetFromDataUrl: ({ noteId, note, mimeType, dataUrl, folders }) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;
      const assetsDir = path.join(noteDir, 'assets');
      ensureDir(assetsDir);

      const ext =
        mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/jpeg'
            ? 'jpg'
            : mimeType === 'image/webp'
              ? 'webp'
              : 'png';

      const fileName = `pasted-${Date.now()}.${ext}`;
      const filePath = path.join(assetsDir, fileName);
      const base64 = String(dataUrl).split(',')[1] || '';
      fs.writeFileSync(filePath, Buffer.from(base64, 'base64'));

      // Return a markdown-relative path from the note md file
      return `assets/${fileName}`;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save note asset:', e);
      return null;
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
