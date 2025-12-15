import React, { useMemo, useState } from 'react';
import { connect } from 'react-redux';

import actions from '../state/actions';
import FolderIcon from '../icons/folder';
import TrashIcon from '../icons/trash';
import * as S from '../state';
import * as T from '../types';

type StateProps = {
  notebooks: Map<T.NotebookId, T.Notebook>;
  folders: Map<T.FolderId, T.Folder>;
  selectedFolderId: T.FolderId | null;
};

type DispatchProps = {
  openFolder: (folderId: T.FolderId) => any;
  createNotebook: (name: string) => any;
  createFolder: (
    notebookId: T.NotebookId,
    name: string,
    parentFolderId?: T.FolderId | null
  ) => any;
  renameNotebook: (notebookId: T.NotebookId, name: string) => any;
  renameFolder: (folderId: T.FolderId, name: string) => any;
  deleteNotebook: (notebookId: T.NotebookId) => any;
  deleteFolder: (folderId: T.FolderId) => any;
};

type Props = StateProps & DispatchProps;

const sortByIndexThenName = <TItem extends { index?: number; name: string }>(
  a: TItem,
  b: TItem
) => {
  const ai = a.index ?? 1e9;
  const bi = b.index ?? 1e9;
  if (ai !== bi) {
    return ai - bi;
  }
  return a.name.localeCompare(b.name);
};

export const NotebookSidebar = ({
  notebooks,
  folders,
  selectedFolderId,
  openFolder,
  createNotebook,
  createFolder,
  renameNotebook,
  renameFolder,
  deleteNotebook,
  deleteFolder,
}: Props) => {
  const [expandedNotebooks, setExpandedNotebooks] = useState<Set<T.NotebookId>>(
    () => new Set(Array.from(notebooks.keys()))
  );
  const [editingNotebookId, setEditingNotebookId] =
    useState<T.NotebookId | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<T.FolderId | null>(
    null
  );
  const [draftName, setDraftName] = useState<string>('');

  const confirmDelete = (title: string, message: string) => {
    const electronConfirm = (window as any).electron?.confirm;
    if (typeof electronConfirm === 'function') {
      return electronConfirm({ title, message });
    }
    return window.confirm(message);
  };

  const nextUniqueName = (base: string, existingNames: string[]) => {
    const set = new Set(existingNames.map((n) => n.toLowerCase()));
    if (!set.has(base.toLowerCase())) return base;
    for (let i = 2; i < 500; i++) {
      const candidate = `${base} (${i})`;
      if (!set.has(candidate.toLowerCase())) return candidate;
    }
    return `${base} (${Date.now()})`;
  };

  const foldersByNotebook = useMemo(() => {
    const map = new Map<T.NotebookId, Array<[T.FolderId, T.Folder]>>();
    folders.forEach((folder, folderId) => {
      const list = map.get(folder.notebookId) ?? [];
      list.push([folderId, folder]);
      map.set(folder.notebookId, list);
    });
    return map;
  }, [folders]);

  const folderChildren = useMemo(() => {
    const map = new Map<string, Array<[T.FolderId, T.Folder]>>();
    folders.forEach((folder, folderId) => {
      const parentKey = String(folder.parentFolderId ?? 'root');
      const list = map.get(parentKey) ?? [];
      list.push([folderId, folder]);
      map.set(parentKey, list);
    });
    // Sort children lists
    map.forEach((list, key) => {
      list.sort((a, b) => sortByIndexThenName(a[1], b[1]));
      map.set(key, list);
    });
    return map;
  }, [folders]);

  const notebookList = useMemo(() => {
    const list = Array.from(notebooks.entries());
    list.sort((a, b) => sortByIndexThenName(a[1], b[1]));
    return list;
  }, [notebooks]);

  const toggleNotebookExpanded = (notebookId: T.NotebookId) => {
    setExpandedNotebooks((prev) => {
      const next = new Set(prev);
      if (next.has(notebookId)) {
        next.delete(notebookId);
      } else {
        next.add(notebookId);
      }
      return next;
    });
  };

  const onNewNotebook = () => {
    const existing = Array.from(notebooks.values()).map((n) => n.name);
    const name = nextUniqueName('New Notebook', existing);
    const action = createNotebook(name) as any;
    const notebookId = action?.notebookId as T.NotebookId | undefined;
    if (notebookId) {
      setExpandedNotebooks((prev) => {
        const next = new Set(prev);
        next.add(notebookId);
        return next;
      });
      setEditingNotebookId(notebookId);
      setEditingFolderId(null);
      setDraftName(name);
    }
  };

  const onNewFolder = (
    notebookId: T.NotebookId,
    parentFolderId?: T.FolderId
  ) => {
    const allFolders = foldersByNotebook.get(notebookId) ?? [];
    const existing = allFolders.map(([, f]) => f.name);
    const name = nextUniqueName('New Folder', existing);
    const action = createFolder(
      notebookId,
      name,
      parentFolderId ?? null
    ) as any;
    const folderId = action?.folderId as T.FolderId | undefined;
    // ensure the notebook is expanded so the new folder is visible immediately
    setExpandedNotebooks((prev) => {
      const next = new Set(prev);
      next.add(notebookId);
      return next;
    });
    if (folderId) {
      openFolder(folderId);
      setEditingFolderId(folderId);
      setEditingNotebookId(null);
      setDraftName(name);
    }
  };

  const onDeleteNotebook = (notebookId: T.NotebookId, name: string) => {
    const ok = confirmDelete(
      'Delete notebook',
      `Delete notebook "${name}"? This will delete all folders inside it.`
    );
    if (!ok) return;
    deleteNotebook(notebookId);
  };

  const onDeleteFolder = (folderId: T.FolderId, name: string) => {
    const ok = confirmDelete(
      'Delete folder',
      `Delete folder "${name}" and all subfolders?`
    );
    if (!ok) return;
    deleteFolder(folderId);
  };

  const commitNotebookRename = (
    notebookId: T.NotebookId,
    currentName: string
  ) => {
    const next = draftName.trim();
    if (next && next !== currentName) {
      renameNotebook(notebookId, next);
    }
    setEditingNotebookId(null);
    setDraftName('');
  };

  const commitFolderRename = (folderId: T.FolderId, currentName: string) => {
    const next = draftName.trim();
    if (next && next !== currentName) {
      renameFolder(folderId, next);
    }
    setEditingFolderId(null);
    setDraftName('');
  };

  const renderFolderNode = (
    notebookId: T.NotebookId,
    folderId: T.FolderId,
    folder: T.Folder,
    depth: number
  ) => {
    const children = folderChildren.get(String(folderId)) ?? [];
    const isSelected = selectedFolderId === folderId;

    return (
      <div key={String(folderId)}>
        <div
          className={`navigation-bar__folder-row${
            isSelected ? ' is-selected' : ''
          }`}
          style={{ paddingLeft: 12 + depth * 12 }}
        >
          <button
            type="button"
            className="navigation-bar__folder-item"
            onClick={() => openFolder(folderId)}
            onDoubleClick={() => {
              setEditingFolderId(folderId);
              setEditingNotebookId(null);
              setDraftName(folder.name);
            }}
          >
            <span className="navigation-bar__folder-icon">
              <FolderIcon />
            </span>
            {editingFolderId === folderId ? (
              <input
                className="navigation-bar__rename-input"
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitFolderRename(folderId, folder.name);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingFolderId(null);
                    setDraftName('');
                  }
                }}
                onBlur={() => commitFolderRename(folderId, folder.name)}
              />
            ) : (
              <span className="navigation-bar__folder-label">
                {folder.name}
              </span>
            )}
          </button>
          <button
            type="button"
            className="navigation-bar__folder-delete"
            title="Delete folder"
            onClick={() => onDeleteFolder(folderId, folder.name)}
          >
            <TrashIcon />
          </button>
        </div>
        {children.map(([childId, child]) =>
          renderFolderNode(notebookId, childId, child, depth + 1)
        )}
      </div>
    );
  };

  return (
    <div className="navigation-bar__notebooks">
      <div className="navigation-bar__folders">
        <div className="navigation-bar__section-title">Notebooks</div>
        {notebookList.map(([notebookId, notebook]) => {
          const isExpanded = expandedNotebooks.has(notebookId);
          const allFolders = foldersByNotebook.get(notebookId) ?? [];

          // root folders for this notebook
          const rootFolders = allFolders
            .filter(([_, f]) => !f.parentFolderId)
            .sort((a, b) => sortByIndexThenName(a[1], b[1]));

          return (
            <div key={String(notebookId)} className="navigation-bar__notebook">
              <div className="navigation-bar__notebook-header">
                <button
                  type="button"
                  className="navigation-bar__notebook-toggle"
                  onClick={() => toggleNotebookExpanded(notebookId)}
                  onDoubleClick={() => {
                    setEditingNotebookId(notebookId);
                    setEditingFolderId(null);
                    setDraftName(notebook.name);
                  }}
                >
                  {isExpanded ? '▾' : '▸'}{' '}
                  {editingNotebookId === notebookId ? (
                    <input
                      className="navigation-bar__rename-input"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitNotebookRename(notebookId, notebook.name);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingNotebookId(null);
                          setDraftName('');
                        }
                      }}
                      onBlur={() =>
                        commitNotebookRename(notebookId, notebook.name)
                      }
                    />
                  ) : (
                    notebook.name
                  )}
                </button>
                <button
                  type="button"
                  className="navigation-bar__notebook-delete"
                  onClick={() => onDeleteNotebook(notebookId, notebook.name)}
                  title="Delete notebook"
                >
                  <TrashIcon />
                </button>
                <button
                  type="button"
                  className="navigation-bar__notebook-add"
                  onClick={() => onNewFolder(notebookId)}
                  title="New folder"
                >
                  +
                </button>
              </div>
              {isExpanded && (
                <div className="navigation-bar__folder-list">
                  {rootFolders.map(([folderId, folder]) =>
                    renderFolderNode(notebookId, folderId, folder, 0)
                  )}
                  {rootFolders.length === 0 && (
                    <button
                      type="button"
                      className="navigation-bar__folder-item"
                      onClick={() => onNewFolder(notebookId)}
                    >
                      Create first folder…
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <div className="navigation-bar__notebooks-footer">
          <button
            type="button"
            className="navigation-bar__footer-item"
            onClick={onNewNotebook}
          >
            New notebook…
          </button>
        </div>
      </div>
    </div>
  );
};

const mapStateToProps: S.MapState<StateProps> = (state) => ({
  notebooks: state.data.notebooks,
  folders: state.data.folders,
  selectedFolderId:
    state.ui.collection.type === 'folder' ? state.ui.collection.folderId : null,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  openFolder: actions.ui.openFolder,
  createNotebook: (name: string) => actions.data.createNotebook(name),
  createFolder: (
    notebookId: T.NotebookId,
    name: string,
    parentFolderId?: T.FolderId | null
  ) => actions.data.createFolder(notebookId, name, parentFolderId),
  renameNotebook: actions.data.renameNotebook,
  renameFolder: actions.data.renameFolder,
  deleteNotebook: actions.data.deleteNotebook,
  deleteFolder: actions.data.deleteFolder,
};

export default connect(mapStateToProps, mapDispatchToProps)(NotebookSidebar);
