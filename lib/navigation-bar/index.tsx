import React, { Component } from 'react';
import { connect } from 'react-redux';

import isEmailTag from '../utils/is-email-tag';
import NavigationBarItem from './item';
import NotebookSidebar from '../notebook-sidebar';
import NotesIcon from '../icons/notes';
import TrashIcon from '../icons/trash';
import SettingsIcon from '../icons/settings';
import UntaggedNotesIcon from '../icons/untagged-notes';
import { viewExternalUrl } from '../utils/url-utils';
import actions from '../state/actions';

import * as S from '../state';
import * as T from '../types';

type StateProps = {
  autoHideMenuBar: boolean;
  collection: T.Collection;
  isDialogOpen: boolean;
  showNavigation: boolean;
  tags: Map<T.TagHash, T.Tag>;
};

type DispatchProps = {
  onAbout: () => any;
  onFocusTrapDeactivate: () => any;
  onSettings: () => any;
  onShowAllNotes: () => any;
  onShowUntaggedNotes: () => any;
  selectTrash: () => any;
  showKeyboardShortcuts: () => any;
};

type Props = StateProps & DispatchProps;

export class NavigationBar extends Component<Props> {
  static displayName = 'NavigationBar';
  private _isMounted = false;

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  handleFocusTrapDeactivate = () => {
    const { onFocusTrapDeactivate, showNavigation } = this.props;

    // isMounted prevents reopening sidebar after navigation event
    if (showNavigation && this._isMounted) {
      onFocusTrapDeactivate();
    }
  };

  onHelpClicked = () => viewExternalUrl('http://simplenote.com/help');

  onSelectTrash = () => {
    this.props.selectTrash();
  };

  // Determine if the selected class should be applied for the 'all notes' or 'trash' rows
  isSelected = ({
    selectedRow,
  }: {
    selectedRow: 'all' | 'trash' | 'untagged';
  }) => {
    return this.props.collection.type === selectedRow;
  };

  render() {
    const {
      autoHideMenuBar,
      isDialogOpen,
      onAbout,
      onSettings,
      onShowAllNotes,
      onShowUntaggedNotes,
      tags,
    } = this.props;

    const tagCount = Array.from(tags).filter(
      ([_, { name }]) => !isEmailTag(name)
    ).length;

    return (
      <div className="navigation-bar" aria-hidden={isDialogOpen}>
        <div className="navigation-bar__folders">
          <NavigationBarItem
            icon={<NotesIcon />}
            isSelected={this.isSelected({ selectedRow: 'all' })}
            label="All Notes"
            onClick={onShowAllNotes}
          />
          <NavigationBarItem
            icon={<TrashIcon />}
            isSelected={this.isSelected({ selectedRow: 'trash' })}
            label="Trash"
            onClick={this.onSelectTrash}
          />
          <NavigationBarItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={onSettings}
          />
        </div>
        <div className="navigation-bar__tags">
          <NotebookSidebar />
          {tagCount ? (
            <div className="navigation-bar__folders navigation-bar__untagged">
              <NavigationBarItem
                icon={<UntaggedNotesIcon />}
                isSelected={this.isSelected({ selectedRow: 'untagged' })}
                label="Untagged Notes"
                onClick={onShowUntaggedNotes}
              />
            </div>
          ) : null}
        </div>
        <div className="navigation-bar__footer">
          <button
            type="button"
            className="navigation-bar__footer-item"
            onClick={this.props.showKeyboardShortcuts}
          >
            Keyboard Shortcuts
          </button>
        </div>
        <div className="navigation-bar__footer">
          <button
            type="button"
            className="navigation-bar__footer-item"
            onClick={this.onHelpClicked}
          >
            Help &amp; Support
          </button>
          <button
            type="button"
            className="navigation-bar__footer-item"
            onClick={onAbout}
          >
            About
          </button>
        </div>
      </div>
    );
  }
}

const mapStateToProps: S.MapState<StateProps> = ({
  data,
  settings,
  ui: { collection, dialogs, showNavigation },
}) => ({
  autoHideMenuBar: settings.autoHideMenuBar,
  collection,
  isDialogOpen: dialogs.length > 0,
  showNavigation,
  tags: data.tags,
});

const mapDispatchToProps: S.MapDispatch<DispatchProps> = {
  onAbout: () => actions.ui.showDialog('ABOUT'),
  onFocusTrapDeactivate: actions.ui.toggleNavigation,
  onShowAllNotes: actions.ui.showAllNotes,
  onShowUntaggedNotes: actions.ui.showUntaggedNotes,
  onSettings: () => actions.ui.showDialog('SETTINGS'),
  selectTrash: actions.ui.selectTrash,
  showKeyboardShortcuts: () => actions.ui.showDialog('KEYBINDINGS'),
};

export default connect(mapStateToProps, mapDispatchToProps)(NavigationBar);
