(function () {
  const statusPill = document.getElementById('status-pill');
  const statusDetail = document.getElementById('status-detail');
  const errorBanner = document.getElementById('error-banner');
  const tbody = document.getElementById('results-body');
  const table = document.getElementById('results-table');
  const emptyState = document.getElementById('empty-state');

  const authDialog = document.getElementById('auth-dialog');
  const authForm = document.getElementById('auth-form');
  const authTarget = document.getElementById('auth-target');
  const authUsername = document.getElementById('auth-username');
  const authPassword = document.getElementById('auth-password');
  const authDialogError = document.getElementById('auth-dialog-error');
  const authSubmitBtn = authForm.querySelector('button[type="submit"]');
  let currentAuthTarget = null;

  // Stored on window, not a module-local variable: hx-boost re-executes this
  // whole script on every boosted nav swap (results.js -> Dashboard -> back
  // to Results), which would otherwise create a new, unreachable pollTimer
  // closure each time while the previous execution's setTimeout chain keeps
  // firing forever in the background. Keying off window lets each new
  // execution find and cancel the prior one's pending timer.
  function clearPollTimer() {
    if (window.__rscanPollTimer) {
      clearTimeout(window.__rscanPollTimer);
      window.__rscanPollTimer = null;
    }
  }
  clearPollTimer();

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
  }

  function clearError() {
    errorBanner.classList.remove('visible');
    errorBanner.textContent = '';
  }

  // Mirrors src/cli/format.ts's authDisplay so the web UI and CLI agree.
  function authDisplay(r) {
    if (r.anonymousStatus === 'open') {
      return r.authenticatedStatus === 'authenticated' ? 'authed' : 'open';
    }
    if (r.anonymousStatus === 'auth_required') {
      if (r.authenticatedStatus === 'authenticated') return 'authed';
      if (r.authenticatedStatus === 'auth_failed') return 'wrong pw';
      return 'required';
    }
    return 'error';
  }

  function authBadgeClass(r) {
    if (r.anonymousStatus === 'error') return 'error';
    if (r.authenticatedStatus === 'authenticated') return 'authenticated';
    if (r.authenticatedStatus === 'auth_failed') return 'auth_failed';
    if (r.anonymousStatus === 'auth_required') return 'auth_required';
    return 'open';
  }

  function formatUptime(seconds) {
    if (seconds == null) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
  }

  // Built with createElement/textContent (never innerHTML) so INFO fields
  // like version/os — which come verbatim from the scanned host and are not
  // trustworthy — can never be interpreted as markup.
  function renderRow(r) {
    const tr = document.createElement('tr');

    function cell(text) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }

    cell(r.host);
    cell(String(r.port));
    cell(r.tls ? 'yes' : 'no');
    cell(r.product);
    cell(r.version ?? '—');

    const authTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${authBadgeClass(r)}`;
    badge.textContent = authDisplay(r);
    authTd.appendChild(badge);
    tr.appendChild(authTd);

    const inv = r.inventory;
    cell(inv ? inv.role : '—');
    cell(inv ? inv.mode : '—');
    cell(inv ? inv.os : '—');
    cell(inv ? formatUptime(inv.uptimeSeconds) : '—');
    cell(`${r.latency}ms`);

    const actionTd = document.createElement('td');
    const authBtn = document.createElement('button');
    authBtn.type = 'button';
    authBtn.className = 'secondary';
    authBtn.textContent = 'Authenticate';
    authBtn.addEventListener('click', () => openAuthDialog(r.host, r.port));
    actionTd.appendChild(authBtn);
    tr.appendChild(actionTd);

    return tr;
  }

  function render(state) {
    statusPill.textContent = state.status;
    statusPill.className = `status-pill ${state.status}`;

    if (state.status === 'scanning') {
      statusDetail.textContent =
        `Scanning ${state.progress.scanDone}/${state.progress.scanTotal} targets · ` +
        `probing ${state.progress.probeDone}/${state.progress.probeTotal} open ports`;
    } else if (state.status === 'done') {
      statusDetail.textContent = `${state.results.length} instance${state.results.length === 1 ? '' : 's'} found`;
    } else {
      statusDetail.textContent = '';
    }

    if (state.status === 'error') {
      showError(state.error || 'The scan failed.');
    } else {
      clearError();
    }

    tbody.innerHTML = '';

    if (state.status === 'idle') {
      table.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.innerHTML = '';
      const link = document.createElement('a');
      link.href = '/index.html';
      link.textContent = 'Go to Dashboard to start a scan';
      emptyState.appendChild(link);
      return;
    }

    if (state.results.length === 0) {
      table.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.textContent =
        state.status === 'scanning' ? 'Scanning…' : 'No Redis instances found.';
      return;
    }

    table.style.display = '';
    emptyState.style.display = 'none';
    for (const r of state.results) {
      tbody.appendChild(renderRow(r));
    }
  }

  async function fetchResults() {
    clearPollTimer();
    try {
      const res = await fetch('/api/results');
      const state = await res.json();
      render(state);
      if (state.status === 'scanning') {
        window.__rscanPollTimer = setTimeout(fetchResults, 1000);
      }
    } catch {
      showError('Could not reach the server. Is rscan serve still running?');
    }
  }

  function openAuthDialog(host, port) {
    currentAuthTarget = { host, port };
    authTarget.textContent = `${host}:${port}`;
    authUsername.value = '';
    authPassword.value = '';
    authDialogError.classList.remove('visible');
    authDialogError.textContent = '';
    authSubmitBtn.disabled = false;
    authDialog.showModal();
    authPassword.focus();
  }

  document.getElementById('auth-cancel-btn').addEventListener('click', () => {
    authDialog.close();
  });

  // Fires on every close path — Cancel, Escape, or the programmatic close()
  // after a successful submit — so a typed password never lingers in the
  // closed dialog's DOM.
  authDialog.addEventListener('close', () => {
    authPassword.value = '';
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentAuthTarget) return;
    authSubmitBtn.disabled = true;
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: currentAuthTarget.host,
          port: currentAuthTarget.port,
          username: authUsername.value || undefined,
          password: authPassword.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        authDialogError.textContent = data.error || `Authentication failed (HTTP ${res.status}).`;
        authDialogError.classList.add('visible');
        authSubmitBtn.disabled = false;
        return;
      }
      authDialog.close();
      await fetchResults();
    } catch {
      authDialogError.textContent = 'Could not reach the server.';
      authDialogError.classList.add('visible');
      authSubmitBtn.disabled = false;
    }
  });

  document.getElementById('refresh-btn').addEventListener('click', () => fetchResults());

  fetchResults();
})();
