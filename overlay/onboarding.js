/* global window, document, setTimeout */
(function main() {
  'use strict';

  const status = document.getElementById('copy-status');
  let statusTimer = null;

  // The main process loads this window with the running version in its query,
  // so the label is correct before the first paint. Without it the markup's
  // plain product name stays, rather than naming a version we do not know.
  const version = new URLSearchParams(window.location.search).get('version');
  if (version) document.getElementById('app-version').textContent = `Buffy v${version}`;

  function announce(message) {
    status.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = '';
    }, 2400);
  }

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy') || '';
      await window.buffySetup.copy(value);
      const original = button.textContent;
      button.textContent = 'Copied';
      announce(`Copied “${value}”.`);
      setTimeout(() => {
        button.textContent = original;
      }, 1400);
    });
  });

  document.getElementById('setup-docs').addEventListener('click', () => {
    window.buffySetup.docs();
  });

  document.getElementById('setup-done').addEventListener('click', () => {
    window.buffySetup.complete();
  });
})();
