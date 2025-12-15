'use strict';

/**
 * Auto-update is disabled in this build.
 *
 * We export a minimal stub object so callers can still safely invoke
 * `ping` and `pingAndShowProgress`, but no network requests or
 * update flows will be triggered.
 */

const updater = {
  ping() {
    // no-op: automatic background update checks disabled
  },
  pingAndShowProgress() {
    // no-op: user-initiated update checks disabled
  },
};

module.exports = updater;
