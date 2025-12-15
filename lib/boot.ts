import './utils/ensure-platform-support';
// this adds a shim that makes this function available under webpack
// TODO: there should be some way to add this to webpack config instead of here
import 'setimmediate';

import React from 'react';
import { render } from 'react-dom';
import { Provider } from 'react-redux';
import Modal from 'react-modal';

import App from './app';
import { ErrorBoundaryWithAnalytics } from './error-boundary';
import { makeStore } from './state';
import isDevConfig from './utils/is-dev-config';

import '../scss/style.scss';

const ensureNormalization = () =>
  !('normalize' in String.prototype)
    ? import(/* webpackChunkName: 'unorm' */ 'unorm')
    : Promise.resolve();

// @TODO: Move this into some framework spot
// still no IE support
// https://tc39.github.io/ecma262/#sec-array.prototype.findindex
/* eslint-disable */
if (!Array.prototype.findIndex) {
  Object.defineProperty(Array.prototype, 'findIndex', {
    value: function (predicate: Function) {
      // 1. Let O be ? ToObject(this value).
      if (this == null) {
        throw new TypeError('"this" is null or not defined');
      }

      var o = Object(this);

      // 2. Let len be ? ToLength(? Get(O, "length")).
      var len = o.length >>> 0;

      // 3. If IsCallable(predicate) is false, throw a TypeError exception.
      if (typeof predicate !== 'function') {
        throw new TypeError('predicate must be a function');
      }

      // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
      var thisArg = arguments[1];

      // 5. Let k be 0.
      var k = 0;

      // 6. Repeat, while k < len
      while (k < len) {
        // a. Let Pk be ! ToString(k).
        // b. Let kValue be ? Get(O, Pk).
        // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
        // d. If testResult is true, return k.
        var kValue = o[k];
        if (predicate.call(thisArg, kValue, k, o)) {
          return k;
        }
        // e. Increase k by 1.
        k++;
      }

      // 7. Return -1.
      return -1;
    },
    configurable: true,
    writable: true,
  });
}
/* eslint-enable */

// Loosen types for React.createElement so we don't fight complex generics
// coming from react-redux and our own components.
const ReduxProvider: React.ComponentType<any> =
  Provider as unknown as React.ComponentType<any>;
const ErrorBoundaryComponent: React.ComponentType<any> =
  ErrorBoundaryWithAnalytics as unknown as React.ComponentType<any>;
const AppComponent: React.ComponentType<any> =
  App as unknown as React.ComponentType<any>;

const bootOffline = () => {
  Modal.setAppElement('#root');

  ensureNormalization().then(() => {
    makeStore(null).then((store) => {
      Object.defineProperties(window, {
        dispatch: {
          get() {
            return store.dispatch;
          },
        },
        state: {
          get() {
            return store.getState();
          },
        },
      });

      window.electron?.send('appStateUpdate', {
        settings: store.getState().settings,
        editMode: store.getState().ui.editMode,
      });

      // Default into the first available folder (local notebooks) so the note
      // list becomes the "notes of this folder" view.
      try {
        const { folders } = store.getState().data as any;
        const firstFolderId = folders?.keys?.().next?.().value;
        if (firstFolderId) {
          store.dispatch({ type: 'OPEN_FOLDER', folderId: firstFolderId });
        }
      } catch {
        // ignore
      }

      const rootElement = document.getElementById('root');

      if (rootElement) {
        render(
          React.createElement(ReduxProvider, { store }, [
            React.createElement(
              ErrorBoundaryComponent,
              { isDevConfig: isDevConfig(config?.development) },
              React.createElement(AppComponent, {
                isDevConfig: isDevConfig(config?.development),
              })
            ),
          ]),
          rootElement
        );
      }
    });
  });
};

bootOffline();
