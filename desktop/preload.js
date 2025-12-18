const {
  contextBridge,
  ipcRenderer,
  clipboard,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL, fileURLToPath } = require('url');
const sanitizeFilename = require('sanitize-filename');

const NOTES_ROOT_NAME = 'CurNotes';
const META_DIR_NAME = '.curnote';
const META_FILE_NAME = 'store.json';
const REVISIONS_FILE_NAME = 'revisions.json';

const getNotesRoot = () => {
  const documents = ipcRenderer.sendSync('curnote:getPath', 'documents');
  if (!documents) {
    throw new Error('Could not resolve documents path from main process');
  }
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

  const htmlFile = path.join(noteDir, `${noteDirName}.html`);
  return { noteDir, htmlFile, folderDir, noteDirName, folderParts };
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
    const response = ipcRenderer.sendSync('curnote:showMessageBoxSync', {
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
      const response = ipcRenderer.sendSync('curnote:showMessageBoxSync', {
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

      // Rehydrate notes content from on-disk HTML files.
      // `rawMeta` is expected to be the same shape as the old persisted payload,
      // except that note contents may be omitted or stale.
      const rootFolders = rawMeta.folders ?? [];
      const notesArray = rawMeta.notes ?? [];
      const notePaths = rawMeta.notePaths ?? {};
      const TurndownService = (() => {
        try {
          return require('turndown');
        } catch {
          return null;
        }
      })();
      const turndown = TurndownService ? new TurndownService() : null;

      const hydratedNotes = notesArray.map(([noteId, note]) => {
        try {
          // Prefer HTML, but support legacy mdRel for backward compatibility.
          const htmlRel = notePaths?.[noteId]?.htmlRel;
          const mdRel = notePaths?.[noteId]?.mdRel;
          const fileRel = htmlRel || mdRel;
          const filePath = fileRel ? path.join(root, fileRel) : null;
          if (filePath && fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            // If the stored file is HTML, convert back to markdown for the editor.
            const content = htmlRel && turndown ? turndown.turndown(raw) : raw;
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

      // Persist each note as a folder containing <Title>.html and assets/
      const foldersArray = data.folders ?? [];
      const notebooksArray = data.notebooks ?? [];
      const nextNotePaths = { ...(previousMeta.notePaths ?? {}) };
      const activeNoteIds = new Set();

      // Convert markdown -> HTML when persisting to disk.
      // (We still keep markdown in-memory for the editor.)
      const showdown = (() => {
        try {
          return require('showdown');
        } catch {
          return null;
        }
      })();
      const markdownConverter = showdown
        ? new showdown.Converter({
            // best-effort parity with renderer conversion
            tables: true,
            strikethrough: true,
            tasklists: true,
          })
        : null;

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

        const { htmlFile: desiredHtmlFile, noteDir: desiredNoteDir } =
          getOrCreateNoteDir(root, foldersArray, notebooksArray, noteId, note);
        let finalNoteDir = desiredNoteDir;
        let finalHtmlFile = desiredHtmlFile;

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
          finalHtmlFile = path.join(uniqueTarget, `${newDirName}.html`);
        }

        ensureDir(finalNoteDir);
        ensureDir(path.join(finalNoteDir, 'assets'));
        ensureDir(path.dirname(finalHtmlFile));
        const markdown = String(note.content || '');
        const html = markdownConverter
          ? markdownConverter.makeHtml(markdown)
          : markdown;
        fs.writeFileSync(finalHtmlFile, html, 'utf8');

        nextNotePaths[noteId] = {
          dirRel: path.relative(root, finalNoteDir),
          htmlRel: path.relative(root, finalHtmlFile),
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
  saveNoteAssetFromDataUrl: async ({
    noteId,
    note,
    mimeType,
    dataUrl,
    folders,
    notebooks,
  }) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      // Ensure the note's dirRel is persisted as soon as we create/resolve it so
      // subsequent asset URL resolutions don't depend on a later full persistence pass.
      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }

      const assetsDir = path.join(noteDir, 'assets');
      ensureDir(assetsDir);

      // Normalize whitespace in base64 payload (some clipboard sources insert newlines).
      const normalizedDataUrl = (() => {
        const s = String(dataUrl || '');
        if (!s.startsWith('data:image/')) return s;
        const commaIdx = s.indexOf(',');
        if (commaIdx < 0) return s;
        return (
          s.slice(0, commaIdx + 1) + s.slice(commaIdx + 1).replace(/\s+/g, '')
        );
      })();

      // Decode using Electron-native image pipeline (more robust than manual base64 parsing).
      const img = nativeImage.createFromDataURL(normalizedDataUrl);
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
        // eslint-disable-next-line no-console
        console.error('Failed to save note asset: nativeImage is empty', {
          noteId,
          mimeType,
        });
        return null;
      }

      // Choose output format: keep JPEGs as JPEG; everything else as PNG.
      const outputIsJpeg = mimeType === 'image/jpeg';
      const ext = outputIsJpeg ? 'jpg' : 'png';
      const buffer = outputIsJpeg ? img.toJPEG(90) : img.toPNG();

      const fileName = `pasted-${Date.now()}.${ext}`;
      const filePath = path.join(assetsDir, fileName);
      await fs.promises.writeFile(filePath, buffer);

      const rel = `assets/${fileName}`;
      const fileUrl = pathToFileURL(filePath).toString();
      return { rel, fileUrl };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save note asset:', e, {
        noteId,
        mimeType,
      });
      return null;
    }
  },
  saveNoteAssetFromUrl: async ({ noteId, note, url, folders, notebooks }) => {
    try {
      const root = getNotesRoot();
      ensureDir(root);
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }
      const assetsDir = path.join(noteDir, 'assets');
      ensureDir(assetsDir);

      const urlStr = String(url || '').trim();
      const isFileUrl = /^file:\/\//i.test(urlStr);
      const isAbsolutePath =
        /^\//.test(urlStr) || /^[a-zA-Z]:[\\/]/.test(urlStr);

      const extFromPath = (p) =>
        String(path.extname(p) || '')
          .replace(/^\./, '')
          .toLowerCase();
      const normalizeExt = (ext) => (ext === 'jpeg' ? 'jpg' : ext);
      const isSupportedImageExt = (ext) =>
        ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);

      // Support local file URLs/paths (common when pasting an image file path from the OS).
      if (isFileUrl || isAbsolutePath) {
        const localPath = isFileUrl ? fileURLToPath(urlStr) : urlStr;
        const extRaw = extFromPath(localPath);
        if (!isSupportedImageExt(extRaw)) return null;
        if (!fs.existsSync(localPath)) return null;

        const buffer = await fs.promises.readFile(localPath);
        const fileName = `pasted-${Date.now()}.${normalizeExt(extRaw)}`;
        const filePath = path.join(assetsDir, fileName);
        await fs.promises.writeFile(filePath, buffer);

        const rel = `assets/${fileName}`;
        const fileUrl = pathToFileURL(filePath).toString();
        return { rel, fileUrl };
      }

      const fetch = require('electron-fetch').default;
      const res = await fetch(urlStr);
      if (!res.ok) return null;

      const contentType =
        (res.headers && res.headers.get && res.headers.get('content-type')) ||
        '';
      const mimeType = String(contentType).split(';')[0].trim();

      const ext =
        mimeType === 'image/png'
          ? 'png'
          : mimeType === 'image/jpeg'
            ? 'jpg'
            : mimeType === 'image/gif'
              ? 'gif'
              : mimeType === 'image/webp'
                ? 'webp'
                : 'png';

      const fileName = `pasted-${Date.now()}.${ext}`;
      const filePath = path.join(assetsDir, fileName);

      const buffer = await res.buffer();
      await fs.promises.writeFile(filePath, buffer);

      const rel = `assets/${fileName}`;
      const fileUrl = pathToFileURL(filePath).toString();
      return { rel, fileUrl };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to save note asset from url:', e);
      return null;
    }
  },
  resolveNoteAssetFileUrl: ({ noteId, note, folders, notebooks, rel }) => {
    try {
      const root = getNotesRoot();
      const metaPath = path.join(root, META_DIR_NAME, META_FILE_NAME);
      const rawMeta = readJsonFile(metaPath) ?? {};
      const notePaths = rawMeta.notePaths ?? {};
      const existingDirRel = notePaths?.[noteId]?.dirRel;
      const notebooksArray = notebooks ?? rawMeta.notebooks ?? [];
      const noteDir = existingDirRel
        ? path.join(root, existingDirRel)
        : getOrCreateNoteDir(root, folders ?? [], notebooksArray, noteId, note)
            .noteDir;

      if (!existingDirRel) {
        try {
          const nextNotePaths = {
            ...notePaths,
            [noteId]: {
              ...(notePaths?.[noteId] ?? {}),
              dirRel: path.relative(root, noteDir),
            },
          };
          writeJsonFile(metaPath, { ...rawMeta, notePaths: nextNotePaths });
        } catch {
          // best-effort
        }
      }
      const abs = path.join(noteDir, String(rel || ''));
      return pathToFileURL(abs).toString();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to resolve asset url:', e);
      return null;
    }
  },
  readClipboardImageDataUrl: () => {
    try {
      const img = clipboard.readImage();
      if (!img || (typeof img.isEmpty === 'function' && img.isEmpty())) {
        return null;
      }
      // Electron returns PNG data by default here.
      const dataUrl = img.toDataURL();
      return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')
        ? dataUrl
        : null;
    } catch (e) {
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
