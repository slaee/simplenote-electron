import React, { Component, CSSProperties } from 'react';
import { connect } from 'react-redux';
import classNames from 'classnames';

import PublishIcon from '../icons/published-small';
import SmallPinnedIcon from '../icons/pinned-small';
import SmallSyncIcon from '../icons/sync-small';
import FileSmallIcon from '../icons/file-small';
import { decorateWith, makeFilterDecorator } from './decorators';
import { getTerms } from '../utils/filter-notes';
import { noteTitleAndPreview } from '../utils/note-utils';
import { withCheckboxCharacters } from '../utils/task-transform';

import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

type OwnProps = {
  invalidateHeight: () => any;
  noteId: T.EntityId;
  style: CSSProperties;
};

type StateProps = {
  displayMode: T.ListDisplayMode;
  hasPendingChanges: boolean;
  isOffline: boolean;
  isOpened: boolean;
  lastUpdated: number;
  folders: any[];
  notebooks: any[];
  note?: T.Note;
  searchQuery: string;
};

type DispatchProps = {
  openNote: (noteId: T.EntityId) => any;
  pinNote: (noteId: T.EntityId, shouldPin: boolean) => any;
};

type Props = OwnProps & StateProps & DispatchProps;

export class NoteCell extends Component<Props> {
  createdAt: number;
  updateScheduled: ReturnType<typeof setTimeout> | undefined;

  constructor(props: Props) {
    super(props);

    // prevent bouncing note updates on app boot
    this.createdAt = Date.now();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.note?.content !== this.props.note?.content) {
      this.props.invalidateHeight();
    }

    // make sure we reset our update indicator
    // otherwise it won't re-animate on the next update
    if (this.props.lastUpdated < 1000 && !this.updateScheduled) {
      this.updateScheduled = setTimeout(() => this.forceUpdate(), 1000);
    }
  }

  componentWillUnmount() {
    clearTimeout(this.updateScheduled);
  }

  render() {
    const {
      displayMode,
      hasPendingChanges,
      isOffline,
      isOpened,
      lastUpdated,
      folders,
      notebooks,
      noteId,
      note,
      openNote,
      pinNote,
      searchQuery,
      style,
    } = this.props;

    if (!note) {
      return <div>{"Couldn't find note"}</div>;
    }

    const { title, preview } = noteTitleAndPreview(note, searchQuery);
    const isPinned = note.systemTags.includes('pinned');
    const isPublished = !!note.publishURL;
    const recentlyUpdated =
      lastUpdated - this.createdAt > 1000 && Date.now() - lastUpdated < 1200;
    const classes = classNames('note-list-item', {
      'note-list-item-selected': isOpened,
      'note-list-item-pinned': isPinned,
      'note-recently-updated': recentlyUpdated,
      'published-note': isPublished,
    });

    const pinnerClasses = classNames('note-list-item-pinner', {
      'note-list-item-pinned': isPinned,
    });
    const pinnerLabel = isPinned ? `Unpin note ${title}` : `Pin note ${title}`;

    const decorators = getTerms(searchQuery).map(makeFilterDecorator);

    // If the 2nd or 3rd editor line is an image, show a thumbnail indicator in the excerpt.
    // Skip this when searching so contextual text previews remain clear.
    const shouldShowImageIndicator = !(searchQuery ?? '').trim();
    const imageIndicator = (() => {
      if (!shouldShowImageIndicator) return null;

      const content = String(note.content ?? '');
      const lines = content.split(/\r?\n/);
      const candidateLines = [lines[1] ?? '', lines[2] ?? ''];
      const imageMatch = candidateLines
        .map((l) => /^\s*!\[([^\]]*)\]\(\s*([^)]+?)\s*\)\s*$/.exec(String(l)))
        .find(Boolean) as RegExpExecArray | undefined;

      if (!imageMatch) return null;

      const alt = (imageMatch[1] ?? '').trim() || 'Image';
      const rawSrc = (imageMatch[2] ?? '').trim().replace(/^<|>$/g, '');

      const resolveFn = window.electron?.resolveNoteAssetFileUrl;
      const resolvedSrc =
        rawSrc.startsWith('assets/') && typeof resolveFn === 'function'
          ? resolveFn({
              noteId,
              note,
              folders,
              notebooks,
              rel: rawSrc,
            }) || rawSrc
          : rawSrc;

      // Avoid rendering data: thumbnails in the list (can be huge and cause jank).
      const showThumb = resolvedSrc.startsWith('file://');

      return (
        <span className="note-list-item-image-indicator">
          {showThumb ? (
            <img
              className="note-list-item-image-thumb"
              src={resolvedSrc}
              alt={alt}
              loading="lazy"
            />
          ) : (
            <span className="note-list-item-image-fallback" aria-hidden="true">
              <FileSmallIcon />
            </span>
          )}
          <span className="note-list-item-image-sep" aria-hidden="true" />
          <span className="note-list-item-image-ellipsis" aria-hidden="true">
            …
          </span>
        </span>
      );
    })();

    return (
      <div style={style} className={classes} role="row">
        <div className="note-list-item-content" role="cell">
          <div className="note-list-item-status">
            <button
              aria-label={pinnerLabel}
              className={pinnerClasses}
              onClick={() => pinNote(noteId, !isPinned)}
            >
              <SmallPinnedIcon />
            </button>
          </div>

          <button
            aria-label={`Edit note ${title}`}
            className="note-list-item-text"
            onClick={() => openNote(noteId)}
          >
            <div className="note-list-item-title">
              <span>
                {decorateWith(decorators, withCheckboxCharacters(title))}
              </span>
            </div>
            {'expanded' === displayMode && preview.length > 0 && (
              <div className="note-list-item-excerpt">
                {imageIndicator && (
                  <React.Fragment>
                    {imageIndicator}
                    <br />
                  </React.Fragment>
                )}
                {withCheckboxCharacters(preview)
                  .split('\n')
                  .map((line, index) => (
                    <React.Fragment key={index}>
                      {index > 0 && <br />}
                      {decorateWith(decorators, line.slice(0, 200))}
                    </React.Fragment>
                  ))}
              </div>
            )}
            {'expanded' === displayMode &&
              preview.length === 0 &&
              imageIndicator && (
                <div className="note-list-item-excerpt">{imageIndicator}</div>
              )}
            {'comfy' === displayMode && preview.length > 0 && (
              <div className="note-list-item-excerpt">
                {imageIndicator && (
                  <React.Fragment>{imageIndicator} </React.Fragment>
                )}
                {decorateWith(
                  decorators,
                  withCheckboxCharacters(preview).slice(0, 200)
                )}
              </div>
            )}
            {'comfy' === displayMode &&
              preview.length === 0 &&
              imageIndicator && (
                <div className="note-list-item-excerpt">{imageIndicator}</div>
              )}
          </button>
          <div className="note-list-item-status-right">
            {hasPendingChanges && (
              <span
                className={classNames('note-list-item-pending-changes', {
                  'is-offline': isOffline,
                })}
              >
                <SmallSyncIcon />
              </span>
            )}
            {isPublished && (
              <span className="note-list-item-published-icon">
                <PublishIcon />
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps, OwnProps> = (
  state,
  { noteId }
) => ({
  displayMode: state.settings.noteDisplay,
  // In offline mode we consider notes always locally saved; no pending sync.
  hasPendingChanges: false,
  isOffline: false,
  isOpened: state.ui.openedNote === noteId,
  lastUpdated: -Infinity,
  folders: Array.from(state.data.folders),
  notebooks: Array.from(state.data.notebooks),
  note: state.data.notes.get(noteId),
  searchQuery: state.ui.searchQuery,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  openNote: actions.ui.openNote,
  pinNote: actions.data.pinNote,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteCell);
