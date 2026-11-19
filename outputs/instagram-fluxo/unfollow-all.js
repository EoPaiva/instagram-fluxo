(() => {
  'use strict';
  globalThis.instagramFlowUnfollowAll = {
    run: (tabId, owner, options) => globalThis.instagramFlow.unfollowAll(tabId, owner, options),
  };
})();
