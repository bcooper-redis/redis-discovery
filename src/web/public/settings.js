(function () {
  const STORAGE_KEY = 'rscan.scanDefaults';
  const form = document.getElementById('settings-form');
  const savedNote = document.getElementById('saved-note');

  function loadDefaults() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function applyToForm(defaults) {
    form.ports.value = defaults.ports || '';
    form.timeoutMs.value = defaults.timeoutMs || '';
    form.concurrency.value = defaults.concurrency || '';
    form.tls.checked = Boolean(defaults.tls);
    form.tlsSkipVerify.checked = Boolean(defaults.tlsSkipVerify);
  }

  applyToForm(loadDefaults());

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const defaults = {
      ports: form.ports.value.trim(),
      timeoutMs: Number(form.timeoutMs.value) || undefined,
      concurrency: Number(form.concurrency.value) || undefined,
      tls: form.tls.checked,
      tlsSkipVerify: form.tlsSkipVerify.checked,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
    savedNote.style.display = 'block';
    // Cleared via window, not a module-local variable: hx-boost re-executes
    // this whole script on every boosted nav swap, so a stale timer from a
    // previous execution could otherwise fire against a detached element.
    if (window.__rscanSavedNoteTimer) clearTimeout(window.__rscanSavedNoteTimer);
    window.__rscanSavedNoteTimer = setTimeout(() => {
      savedNote.style.display = 'none';
    }, 2000);
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);
    applyToForm({});
  });
})();
