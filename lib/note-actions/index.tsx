import React, { Component } from 'react';
import { connect } from 'react-redux';
import FocusTrap from 'focus-trap-react';

import CheckboxControl from '../controls/checkbox';

import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  hasRevisions: boolean;
  isMarkdown: boolean;
  isPinned: boolean;
  noteId: T.EntityId;
  note: T.Note;
};

type DispatchProps = {
  markdownNote: (noteId: T.EntityId, shouldEnableMarkdown: boolean) => any;
  onFocusTrapDeactivate: () => any;
  pinNote: (noteId: T.EntityId, shouldPin: boolean) => any;
  toggleRevisions: () => any;
  trashNote: () => any;
};

type Props = StateProps & DispatchProps;

export class NoteActions extends Component<Props> {
  static displayName = 'NoteActions';
  // Note: Cannot use 'isMounted' as it conflicts with React's deprecated getter-only property
  private _isMounted = false;
  containerRef = React.createRef<HTMLDivElement>();

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  handleFocusTrapDeactivate = () => {
    const { onFocusTrapDeactivate } = this.props;

    if (this._isMounted) {
      // Bit of a delay so that clicking the note actios toolbar will toggle the view properly.
      setTimeout(() => onFocusTrapDeactivate(), 200);
    }
  };

  render() {
    const { hasRevisions, isMarkdown, isPinned } = this.props;

    return (
      <FocusTrap
        focusTrapOptions={{
          clickOutsideDeactivates: true,
          onDeactivate: this.handleFocusTrapDeactivate,
        }}
      >
        <div className="note-actions" ref={this.containerRef}>
          <div className="note-actions-panel">
            <label
              className="note-actions-item"
              htmlFor="note-actions-pin-checkbox"
            >
              <span className="note-actions-item-text">
                <span className="note-actions-name">Pin to top</span>
              </span>
              <span className="note-actions-item-control">
                <CheckboxControl
                  id="note-actions-pin-checkbox"
                  checked={isPinned}
                  isStandard
                  onChange={() => {
                    this.pinNote(!isPinned);
                  }}
                />
              </span>
            </label>

            <label
              className="note-actions-item"
              htmlFor="note-actions-markdown-checkbox"
            >
              <span className="note-actions-item-text">
                <span className="note-actions-name">Markdown</span>
              </span>
              <span className="note-actions-item-control">
                <CheckboxControl
                  id="note-actions-markdown-checkbox"
                  checked={isMarkdown}
                  isStandard
                  onChange={() => {
                    this.markdownNote(!isMarkdown);
                  }}
                />
              </span>
            </label>

            {hasRevisions && (
              <div className="note-actions-item">
                <button
                  className="button button-borderless"
                  onClick={this.props.toggleRevisions}
                >
                  History…
                </button>
              </div>
            )}
            {hasRevisions || (
              <div className="note-actions-item note-actions-item-disabled">
                <span className="note-actions-disabled">
                  History (unavailable)
                </span>
              </div>
            )}
          </div>
          <div className="note-actions-panel">
            <div className="note-actions-item note-actions-trash">
              <button
                className="button button-borderless"
                onClick={this.props.trashNote}
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      </FocusTrap>
    );
  }

  pinNote = (shouldPin: boolean) =>
    this.props.pinNote(this.props.noteId, shouldPin);

  markdownNote = (shouldEnableMarkdown: boolean) =>
    this.props.markdownNote(this.props.noteId, shouldEnableMarkdown);
}

const mapStateToProps: S.MapState<StateProps> = ({
  data,
  ui: { openedNote },
}) => {
  const note = data.notes.get(openedNote);

  return {
    noteId: openedNote,
    note: note,
    hasRevisions: !!data.noteRevisions.get(openedNote)?.size,
    isMarkdown: note?.systemTags.includes('markdown'),
    isPinned: note?.systemTags.includes('pinned'),
  };
};

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  markdownNote: actions.data.markdownNote,
  onFocusTrapDeactivate: actions.ui.closeNoteActions,
  pinNote: actions.data.pinNote,
  toggleRevisions: actions.ui.toggleRevisions,
  trashNote: actions.ui.trashOpenNote,
};

export default connect(mapStateToProps, mapDispatchToProps)(NoteActions);
