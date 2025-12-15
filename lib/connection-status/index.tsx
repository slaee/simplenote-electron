import React, { FunctionComponent } from 'react';
import { Tooltip } from '@mui/material';
import NoConnectionIcon from '../icons/no-connection';

import './style';

export const ConnectionStatus: FunctionComponent = () => (
  <div className="navigation-bar__footer-item">
    <Tooltip
      enterDelay={200}
      classes={{ tooltip: 'icon-button__tooltip' }}
      title="Notes are stored locally only. No server connection or sync is active."
    >
      <p>
        <NoConnectionIcon />
        <span className="server-connection__label">Local-only storage</span>
      </p>
    </Tooltip>
  </div>
);

export default ConnectionStatus;
