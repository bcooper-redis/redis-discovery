(function () {
  const form = document.getElementById('scan-form');
  const errorBanner = document.getElementById('error-banner');
  const submitBtn = document.getElementById('submit-btn');

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
  }

  function clearError() {
    errorBanner.classList.remove('visible');
    errorBanner.textContent = '';
  }

  // Pre-fill non-sensitive defaults saved on the Settings page. Credentials
  // are never read from or written to storage.
  function applyStoredDefaults() {
    let defaults;
    try {
      defaults = JSON.parse(localStorage.getItem('rscan.scanDefaults') || '{}');
    } catch {
      defaults = {};
    }
    if (defaults.ports) form.ports.value = defaults.ports;
    if (defaults.timeoutMs) form.timeoutMs.value = defaults.timeoutMs;
    if (defaults.concurrency) form.concurrency.value = defaults.concurrency;
    if (defaults.tls) form.tls.checked = true;
    if (defaults.tlsSkipVerify) form.tlsSkipVerify.checked = true;
  }

  applyStoredDefaults();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting…';

    const cidrs = form.cidrs.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const body = {
      ports: form.ports.value.trim() || undefined,
      timeoutMs: Number(form.timeoutMs.value) || undefined,
      concurrency: Number(form.concurrency.value) || undefined,
      tls: form.tls.checked,
      tlsSkipVerify: form.tlsSkipVerify.checked,
    };
    if (cidrs.length > 0) body.cidrs = cidrs;
    if (form.password.value) {
      body.password = form.password.value;
      if (form.username.value) body.username = form.username.value;
    }

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || `Scan failed to start (HTTP ${res.status}).`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Scan';
        return;
      }
      window.location.href = '/results.html';
    } catch {
      showError('Could not reach the server. Is rscan serve still running?');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Scan';
    }
  });
})();
