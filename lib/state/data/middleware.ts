import { v4 as uuid } from 'uuid';

import { tagHashOf } from '../../utils/tag-hash';
import exportZipArchive from '../../utils/export';
import { withTag } from '../../utils/tag-hash';

import type * as A from '../action-types';
import type * as S from '../';
import type * as T from '../../types';
import { numberOfNonEmailTags, openedFolder, openedTag } from '../selectors';

export const middleware: S.Middleware =
  (store) =>
  (next: (action: A.ActionType) => A.ActionType) =>
  (action: A.ActionType) => {
    const state = store.getState();

    switch (action.type) {
      case 'DELETE_FOLDER': {
        const typed: any = action as any;
        if (typed.meta?.skipCascade) {
          return next(action);
        }

        const folderId = (action as any).folderId as T.FolderId;
        const toDelete: T.FolderId[] = [];
        const queue: T.FolderId[] = [folderId];
        const folders = state.data.folders;

        while (queue.length) {
          const cur = queue.pop()!;
          toDelete.push(cur);
          folders.forEach((folder, id) => {
            if (folder.parentFolderId === cur) {
              queue.push(id);
            }
          });
        }

        // Trash notes inside the folder tree and reset UI state if needed.
        // This prevents the editor from holding onto an "open" note whose container was deleted.
        const notesToTrash: T.EntityId[] = [];
        const foldersSet = new Set(toDelete.map(String));
        state.data.notes.forEach((note, noteId) => {
          const fid = note.folderId;
          if (fid && foldersSet.has(String(fid))) {
            if (!note.deleted) {
              notesToTrash.push(noteId);
            }
          }
        });

        // If the currently opened note is going away, close it (and any dependent UI panels).
        if (state.ui.openedNote) {
          const opened = state.data.notes.get(state.ui.openedNote);
          const openedFolderId = opened?.folderId;
          if (openedFolderId && foldersSet.has(String(openedFolderId))) {
            store.dispatch({ type: 'CLOSE_NOTE' } as any);
          }
        }

        // If the user is currently viewing a folder that is being deleted, reset to All Notes.
        if (
          state.ui.collection.type === 'folder' &&
          foldersSet.has(String(state.ui.collection.folderId))
        ) {
          store.dispatch({ type: 'SHOW_ALL_NOTES' } as any);
        }

        notesToTrash.forEach((noteId) =>
          store.dispatch({ type: 'TRASH_NOTE', noteId } as any)
        );

        // Dispatch child folder deletes first so notes get reassigned correctly for every folder.
        toDelete
          .filter((id) => id !== folderId)
          .forEach((id) =>
            store.dispatch({
              type: 'DELETE_FOLDER',
              folderId: id,
              meta: { skipCascade: true },
            } as any)
          );

        return next({ ...(action as any), meta: { skipCascade: true } } as any);
      }

      case 'DELETE_NOTEBOOK': {
        const notebookId = (action as any).notebookId as T.NotebookId;
        const folders = state.data.folders;
        // Only delete root folders; the DELETE_FOLDER middleware will cascade through descendants.
        folders.forEach((folder, folderId) => {
          const isInNotebook = folder.notebookId === notebookId;
          const isRoot = !folder.parentFolderId;
          if (isInNotebook && isRoot) {
            store.dispatch({ type: 'DELETE_FOLDER', folderId } as any);
          }
        });
        return next(action);
      }

      case 'CREATE_NOTE': {
        const noteId = uuid() as T.EntityId;

        // Always enable Markdown for new notes (file-based, Markdown-first workflow)
        const systemTags = Array.from(
          new Set([...(action.note?.systemTags?.slice() ?? []), 'markdown'])
        );

        // apply selected tag by default
        const selectedTag = openedTag(state);
        const givenTags = action.note?.tags ?? [];
        const tags = selectedTag ? withTag(givenTags, selectedTag) : givenTags;

        // apply selected folder by default (offline notebooks)
        const selectedFolderId = openedFolder(state);
        const folderId =
          typeof selectedFolderId !== 'undefined' ? selectedFolderId : null;

        return next({
          type: 'CREATE_NOTE_WITH_ID',
          noteId,
          note: { ...action.note, systemTags, tags, folderId },
          meta: {
            nextNoteToOpen: noteId,
          },
        });
      }

      case 'DELETE_OPEN_NOTE_FOREVER':
        if (!state.ui.openedNote) {
          return;
        }

        return next({
          type: 'DELETE_NOTE_FOREVER',
          noteId: state.ui.openedNote,
        });

      case 'EMPTY_TRASH': {
        const result = next(action);
        state.data.notes.forEach((note, noteId) => {
          if (note.deleted) {
            store.dispatch({ type: 'DELETE_NOTE_FOREVER', noteId: noteId });
          }
        });
        return result;
      }

      case 'EXPORT_NOTES':
        exportZipArchive(state.data.notes);
        return next(action);

      case 'IMPORT_NOTE':
        return next({
          type: 'IMPORT_NOTE_WITH_ID',
          noteId: uuid() as T.EntityId,
          note: action.note,
        });

      case 'RESTORE_OPEN_NOTE':
        if (!state.ui.openedNote) {
          return;
        }

        return next({
          type: 'RESTORE_NOTE',
          noteId: state.ui.openedNote,
        });

      case 'TOGGLE_ANALYTICS':
        return next({
          type: 'SET_ANALYTICS',
          allowAnalytics: !state.data.analyticsAllowed,
        });

      case 'TRASH_OPEN_NOTE':
        if (!state.ui.openedNote) {
          return;
        }

        return next({
          type: 'TRASH_NOTE',
          noteId: state.ui.openedNote,
        });

      case 'TRASH_TAG':
        return state.data.tags.has(tagHashOf(action.tagName))
          ? next({
              ...action,
              remainingTags: numberOfNonEmailTags(state) - 1,
            })
          : null;

      default:
        return next(action);
    }
  };

export default middleware;
