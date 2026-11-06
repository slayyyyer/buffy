/* global window, document, setTimeout */
(function main() {
  'use strict';

  const status = document.getElementById('copy-status');
  let statusTimer = null;

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
