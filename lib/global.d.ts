import { TKQItem, TracksAPI } from './analytics/types';
import { compose } from 'redux';

import * as S from './state';

declare module '*.css';
declare module '*.scss';
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.webp';
declare module '*.svg';
declare module '*.ttf';
declare module '*.woff';
declare module '*.woff2';
declare module '*.eot';

type ElectronBridge = {
  isMac: boolean;
  isLinux: boolean;
  loadPersistentState: () => any;
  savePersistentState: (data: any) => void;
  loadAllRevisions: () => any;
  saveNoteRevisions: (noteId: any, revisions: any) => void;
  saveNoteAssetFromDataUrl: (
    args: any
  ) => Promise<{ rel: string; fileUrl: string } | null>;
  saveNoteAssetFromUrl: (
    args: any
  ) => Promise<{ rel: string; fileUrl: string } | null>;
  resolveNoteAssetFileUrl: (args: any) => string | null;
  readClipboardImageDataUrl: () => string | null;
};

declare global {
  const __TEST__: boolean;
  const config: {
    app_engine_url: string;
    app_id: string;
    app_key: string;
    development: boolean;
    is_app_engine: string;
    version: string;
    wpcc_client_id: string;
    wpcc_redirect_url: string;
  };

  interface Window {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__?: typeof compose;
    analyticsEnabled: boolean;
    electron: ElectronBridge;
    location: Location;
    testEvents: (string | [string, ...any[]])[];
    _tkq: TKQItem[] & { a: unknown };
    webConfig?: {
      signout?: (callback: () => void) => void;
    };
    wpcom: {
      tracks: TracksAPI;
    };
  }
}
