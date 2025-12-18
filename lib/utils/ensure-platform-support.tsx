import React from 'react';
import { render } from 'react-dom';

import BootWarning from '../components/boot-warning';

const hasLocalStorage = (): boolean => {
  try {
    localStorage.setItem('__localStorageSentinel__', 'present');
    localStorage.removeItem('__localStorageSentinel__');
    return true;
  } catch (e) {
    return false;
  }
};

const deps = [['localStorage', hasLocalStorage()]] as const;

const missingDeps = deps.filter(([, hasIt]) => !hasIt).map(([name]) => name);

if (missingDeps.length) {
  render(
    <BootWarning>
      <p>
        Curnote depends on a few web technologies to operate. Please make sure
        that you have all of the following enabled in your browser.
      </p>
      <ul>
        {deps.map(([name, hasIt]) => (
          <li key={name}>
            {hasIt ? '✅' : '⚠️'} {name} - {hasIt ? 'working' : 'missing'}
          </li>
        ))}
      </ul>
      <p>
        Many browsers disable some of these features in Private Mode. Curnote
        does not currently support running in Private Mode.
      </p>
    </BootWarning>,
    document.getElementById('root')
  );
  throw new Error(
    `Curnote is missing required dependencies: ${missingDeps.join(', ')}`
  );
}
