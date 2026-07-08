(function () {
  const form = document.getElementById('credential-scan-form');
  const errorBanner = document.getElementById('error-banner');
  const submitBtn = document.getElementById('submit-btn');
  const csvUpload = document.getElementById('csv-upload');
  const csvUploadStatus = document.getElementById('csv-upload-status');

  const SESSION_KEY = 'rscan.credentialScanState';
  let parsedTargets = [];

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
  }

  function clearError() {
    errorBanner.classList.remove('visible');
    errorBanner.textContent = '';
  }

  // Pre-fill non-sensitive defaults saved on the Settings page — the same
  // ones Dashboard uses, minus Ports (there's no shared-port field here,
  // since every target's port comes from its own CSV row).
  function applyStoredDefaults() {
    let defaults;
    try {
      defaults = JSON.parse(localStorage.getItem('rscan.scanDefaults') || '{}');
    } catch {
      defaults = {};
    }
    if (defaults.timeoutMs) form.timeoutMs.value = defaults.timeoutMs;
    if (defaults.concurrency) form.concurrency.value = defaults.concurrency;
    if (defaults.tls) form.tls.checked = true;
    if (defaults.tlsSkipVerify) form.tlsSkipVerify.checked = true;
  }

  // Remembers non-file fields for the lifetime of this browser tab. The CSV
  // itself can't be (and shouldn't be) persisted this way — sessionStorage
  // holds parsed target data only in memory for this page load, never
  // written to storage, so re-uploading after navigating away is expected.
  function saveSessionState() {
    const state = {
      timeoutMs: form.timeoutMs.value,
      concurrency: form.concurrency.value,
      tls: form.tls.checked,
      tlsSkipVerify: form.tlsSkipVerify.checked,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  }

  function restoreSessionState() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (!saved) return;
    if (typeof saved.timeoutMs === 'string') form.timeoutMs.value = saved.timeoutMs;
    if (typeof saved.concurrency === 'string') form.concurrency.value = saved.concurrency;
    form.tls.checked = Boolean(saved.tls);
    form.tlsSkipVerify.checked = Boolean(saved.tlsSkipVerify);
  }

  applyStoredDefaults();
  restoreSessionState();

  form.addEventListener('input', saveSessionState);
  form.addEventListener('change', saveSessionState);

  // Mirrors src/scanner/credentialCsv.ts's parseCsvLine — needed because a
  // password can contain literally any character, including a comma, unlike
  // the plain host/port CSV on the Dashboard.
  function parseCsvLine(line) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        fields.push(field);
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field);
    return fields;
  }

  // Mirrors src/scanner/credentialCsv.ts's parseCredentialCsv. Error
  // messages only ever reference host/port — never username/password.
  function parseCredentialCsv(text) {
    const lines = text
      .split(/\r\n|\r|\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const rows = [];
    const errors = [];

    let startIdx = 0;
    if (lines.length > 0) {
      const firstCell = (parseCsvLine(lines[0])[0] || '').trim();
      if (/^(host|hostname|ip|ip ?address|target)s?$/i.test(firstCell)) {
        startIdx = 1;
      }
    }

    for (let i = startIdx; i < lines.length; i++) {
      const lineNum = i + 1;
      const fields = parseCsvLine(lines[i]).map((f) => f.trim());
      const host = fields[0];
      const portRaw = fields[1];
      const username = fields[2];
      const password = fields[3];

      if (!host) {
        errors.push(`line ${lineNum}: missing host`);
        continue;
      }

      const port = Number(portRaw);
      if (!portRaw || !Number.isInteger(port) || port < 1 || port > 65535) {
        errors.push(`line ${lineNum} (${host}): invalid port "${portRaw || ''}"`);
        continue;
      }

      rows.push({
        host,
        port,
        username: username || undefined,
        password: password || undefined,
      });
    }

    return { rows, errors };
  }

  csvUpload.addEventListener('change', () => {
    const file = csvUpload.files[0];
    csvUploadStatus.textContent = '';
    csvUploadStatus.classList.remove('error');
    parsedTargets = [];
    submitBtn.disabled = true;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const { rows, errors } = parseCredentialCsv(String(reader.result || ''));
      csvUpload.value = ''; // lets re-uploading the same filename fire 'change' again

      if (rows.length === 0) {
        csvUploadStatus.textContent = `No valid targets found in ${file.name}.`;
        csvUploadStatus.classList.add('error');
        return;
      }

      parsedTargets = rows;
      submitBtn.disabled = false;
      const withCreds = rows.filter((r) => r.password).length;
      let status = `Loaded ${rows.length} target${rows.length === 1 ? '' : 's'} from ${file.name} (${withCreds} with credentials)`;
      if (errors.length > 0) {
        status += ` — ${errors.length} row${errors.length === 1 ? '' : 's'} skipped: ${errors.join('; ')}`;
        csvUploadStatus.classList.add('error');
      }
      csvUploadStatus.textContent = status;
    };
    reader.onerror = () => {
      csvUpload.value = '';
      parsedTargets = [];
      csvUploadStatus.textContent = `Could not read ${file.name}.`;
      csvUploadStatus.classList.add('error');
    };
    reader.readAsText(file);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    if (parsedTargets.length === 0) {
      showError('Upload a CSV file with at least one valid target first.');
      return;
    }
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting…';

    const body = {
      targets: parsedTargets,
      timeoutMs: Number(form.timeoutMs.value) || undefined,
      concurrency: Number(form.concurrency.value) || undefined,
      tls: form.tls.checked,
      tlsSkipVerify: form.tlsSkipVerify.checked,
    };

    try {
      const res = await fetch('/api/credential-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || `Scan failed to start (HTTP ${res.status}).`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Credential Scan';
        return;
      }
      window.location.href = '/results.html';
    } catch {
      showError('Could not reach the server. Is rscan serve still running?');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Credential Scan';
    }
  });
})();
