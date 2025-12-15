import * as A from '../action-types';
import * as T from '../../types';
import { v4 as uuid } from 'uuid';

export const addCollaborator: A.ActionCreator<A.AddCollaborator> = (
  noteId: T.EntityId,
  collaboratorAccount: T.TagName
) => ({
  type: 'ADD_COLLABORATOR',
  noteId,
  collaboratorAccount,
});

export const editNote: A.ActionCreator<A.EditNote> = (
  noteId: T.EntityId,
  changes: Partial<T.Note>
) => ({
  type: 'EDIT_NOTE',
  noteId,
  changes,
});

export const exportNotes: A.ActionCreator<A.ExportNotes> = () => ({
  type: 'EXPORT_NOTES',
});

export const importNote: A.ActionCreator<A.ImportNote> = (note: T.Note) => ({
  type: 'IMPORT_NOTE',
  note,
});

export const markdownNote: A.ActionCreator<A.MarkdownNote> = (
  noteId: T.EntityId,
  shouldEnableMarkdown: boolean
) => ({
  type: 'MARKDOWN_NOTE',
  noteId,
  shouldEnableMarkdown,
});

export const pinNote: A.ActionCreator<A.PinNote> = (
  noteId: T.EntityId,
  shouldPin: boolean
) => ({
  type: 'PIN_NOTE',
  noteId,
  shouldPin,
});

export const publishNote: A.ActionCreator<A.PublishNote> = (
  noteId: T.EntityId,
  shouldPublish: boolean
) => ({
  type: 'PUBLISH_NOTE',
  noteId,
  shouldPublish,
});

export const removeCollaborator: A.ActionCreator<A.RemoveCollaborator> = (
  noteId: T.EntityId,
  collaboratorAccount: T.TagName
) => ({
  type: 'REMOVE_COLLABORATOR',
  noteId,
  collaboratorAccount,
});

export const renameTag: A.ActionCreator<A.RenameTag> = (
  oldTagName: T.TagName,
  newTagName: T.TagName
) => ({
  type: 'RENAME_TAG',
  oldTagName,
  newTagName,
});

export const toggleAnalytics: A.ActionCreator<A.ToggleAnalytics> = () => ({
  type: 'TOGGLE_ANALYTICS',
});

export const createNotebook: A.ActionCreator<A.CreateNotebook> = (
  name: string
) => {
  const notebookId = uuid() as unknown as T.NotebookId;
  return {
    type: 'CREATE_NOTEBOOK',
    notebookId,
    notebook: { name },
  };
};

export const renameNotebook: A.ActionCreator<A.RenameNotebook> = (
  notebookId: T.NotebookId,
  name: string
) => ({
  type: 'RENAME_NOTEBOOK',
  notebookId,
  name,
});

export const deleteNotebook: A.ActionCreator<A.DeleteNotebook> = (
  notebookId: T.NotebookId
) => ({
  type: 'DELETE_NOTEBOOK',
  notebookId,
});

export const createFolder: A.ActionCreator<A.CreateFolder> = (
  notebookId: T.NotebookId,
  name: string,
  parentFolderId?: T.FolderId | null
) => {
  const folderId = uuid() as unknown as T.FolderId;
  return {
    type: 'CREATE_FOLDER',
    folderId,
    folder: { name, notebookId, parentFolderId: parentFolderId ?? null },
  };
};

export const renameFolder: A.ActionCreator<A.RenameFolder> = (
  folderId: T.FolderId,
  name: string
) => ({
  type: 'RENAME_FOLDER',
  folderId,
  name,
});

export const deleteFolder: A.ActionCreator<A.DeleteFolder> = (
  folderId: T.FolderId
) => ({
  type: 'DELETE_FOLDER',
  folderId,
});
