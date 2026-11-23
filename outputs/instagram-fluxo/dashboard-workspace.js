'use strict';

globalThis.instagramFluxoWorkspace = (() => {
  const workspace = document.querySelector('.main-column[data-workspace-mode]');
  const controls = [...document.querySelectorAll('[data-workspace-choice]')];
  const queue = document.getElementById('follow-queue');
  const confirmation = document.getElementById('cleaner-confirm-dialog');
  const destinations = globalThis.instagramFluxoSideLink.workspaceHashes;
  const followHashes = new Set(['#seguir', '#search-block', '#recommendation-section']);
  const unfollowHashes = new Set(['#parar-de-seguir', '#unfollow-workspace', '#profile-cleaner', '#cleaner-protection']);

  function render(mode) {
    if (mode === 'follow' && confirmation.open) confirmation.close();
    workspace.dataset.workspaceMode = mode;
    for (const control of controls) control.setAttribute('aria-pressed', String(control.dataset.workspaceChoice === mode));
    if (mode === 'follow') queue.setAttribute('aria-roledescription', 'carrossel');
    else queue.removeAttribute('aria-roledescription');
  }

  function scrollToDestination(hash, focus = false) {
    const element = hash === destinations.follow || hash === destinations.unfollow
      ? document.getElementById('profile-workspace') : document.getElementById(hash.slice(1));
    if (!element) return;
    if (hash === destinations.whitelist) element.open = true;
    if (focus) (hash === destinations.whitelist ? element.querySelector('summary') : element).focus({ preventScroll:true });
    element.scrollIntoView({ block:'start' });
  }

  function open(destination, fromSidebar = false) {
    if (!Object.hasOwn(destinations, destination)) return false;
    const hash = destinations[destination];
    const mode = destination === 'follow' ? 'follow' : 'unfollow';
    if (location.hash !== hash) history.pushState({ workspaceMode:mode }, '', hash);
    render(mode);
    if (fromSidebar || destination === 'whitelist') scrollToDestination(hash, fromSidebar);
    return true;
  }

  function fromLocation() {
    let mode = history.state?.workspaceMode ?? workspace.dataset.workspaceMode;
    if (unfollowHashes.has(location.hash)) mode = 'unfollow';
    else if (followHashes.has(location.hash) || !location.hash) mode = 'follow';
    render(mode);
    if (history.state?.workspaceMode !== mode) history.replaceState({ workspaceMode:mode }, '');
    if (location.hash === destinations.whitelist) scrollToDestination(location.hash);
  }

  for (const control of controls) control.addEventListener('click', () => open(control.dataset.workspaceChoice));
  globalThis.addEventListener('hashchange', fromLocation);
  fromLocation();
  return { open };
})();
