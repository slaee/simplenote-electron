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

const IMAGE_LINE_ONLY_RE = /^\s*!\[([^\]]*)\]\(\s*([^)]+?)\s*\)\s*$/;
const MAX_TITLE_THUMBNAIL_LINES = 4;

const extractMarkdownImageSrc = (raw: string): string => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  // Support the <url> form and optional title: ![alt](<url> "title")
  if (trimmed.startsWith('<')) {
    const closeIdx = trimmed.indexOf('>');
    if (closeIdx > 1) {
      return trimmed.slice(1, closeIdx).trim();
    }
  }
  // Otherwise, treat the first whitespace-delimited token as the URL.
  return trimmed.split(/\s+/)[0] ?? '';
};

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

    const pinnerClasses = classNames('note-list-item-pinner', {
      'note-list-item-pinned': isPinned,
    });
    const pinnerLabel = isPinned ? `Unpin note ${title}` : `Pin note ${title}`;

    const decorators = getTerms(searchQuery).map(makeFilterDecorator);

    // If an image appears in the first 4 non-empty editor lines, show a thumbnail in the title row.
    // Skip this when searching so contextual text previews remain clear.
    const shouldShowTitleThumbnail = !(searchQuery ?? '').trim();
    const titleThumbnail = (() => {
      if (!shouldShowTitleThumbnail) return null;

      const content = String(note.content ?? '');
      const candidateLines: string[] = [];
      for (const line of content.split(/\r?\n/)) {
        const trimmed = String(line).trim();
        if (!trimmed) continue;
        candidateLines.push(trimmed);
        if (candidateLines.length >= MAX_TITLE_THUMBNAIL_LINES) break;
      }

      const imageMatch = candidateLines
        .map((l) => IMAGE_LINE_ONLY_RE.exec(String(l)))
        .find(Boolean) as RegExpExecArray | undefined;

      if (!imageMatch) return null;

      const alt = (imageMatch[1] ?? '').trim() || 'Image';
      const rawSrc = extractMarkdownImageSrc(imageMatch[2] ?? '').replace(
        /^<|>$/g,
        ''
      );
      const normalizedSrc = rawSrc.replace(/^(\.\/|\/)/, '');

      const resolveFn = window.electron?.resolveNoteAssetFileUrl;
      const resolvedSrc =
        normalizedSrc.startsWith('assets/') && typeof resolveFn === 'function'
          ? resolveFn({
              noteId,
              note,
              folders,
              notebooks,
              rel: normalizedSrc,
            }) || rawSrc
          : rawSrc;

      // Avoid rendering very large data: thumbnails in the list (can be huge and cause jank).
      const isHttp = /^https?:\/\//i.test(resolvedSrc);
      const isFile = /^file:\/\//i.test(resolvedSrc);
      const isSmallDataImage =
        /^data:image\//i.test(resolvedSrc) && resolvedSrc.length <= 8_192;
      const showThumb = isFile || isHttp || isSmallDataImage;

      return (
        <span className="note-list-item-title-thumbnail">
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
        </span>
      );
    })();

    const hasTitleThumbnail = !!titleThumbnail;
    const classes = classNames('note-list-item', {
      'note-list-item-selected': isOpened,
      'note-list-item-pinned': isPinned,
      'note-recently-updated': recentlyUpdated,
      'published-note': isPublished,
      'note-list-item-has-title-thumbnail': hasTitleThumbnail,
    });

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
              <span className="note-list-item-title-text">
                {decorateWith(decorators, withCheckboxCharacters(title))}
              </span>
              {titleThumbnail}
            </div>
            {'expanded' === displayMode && preview.length > 0 && (
              <div className="note-list-item-excerpt">
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
            {'comfy' === displayMode && preview.length > 0 && (
              <div className="note-list-item-excerpt">
                {decorateWith(
                  decorators,
                  withCheckboxCharacters(preview).slice(0, 200)
                )}
              </div>
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
