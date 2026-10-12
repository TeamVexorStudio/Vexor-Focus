const $ = (s) => document.querySelector(s);

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj)  => chrome.storage.local.set(obj);

function fmtTime(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

async function refresh() {
  const { blocklist = [], focusState, bridge } = await get(['blocklist', 'focusState', 'bridge']);

  const paired = !!(bridge?.port && bridge?.token);
  const connected = !!focusState;

  $('#dot').classList.toggle('on', connected);

  if (focusState) {
    $('#time').textContent = fmtTime(focusState.remainingMs);
    $('#label').textContent = focusState.label;
    $('#toggle').textContent = focusState.running ? 'Pause' : 'Start';
  } else {
    $('#time').textContent = '--:--';
    $('#label').textContent = paired ? 'Connecting…' : 'Not paired';
    $('#toggle').textContent = 'Start';
  }

  for (const id of ['toggle', 'reset', 'skip']) {
    $('#' + id).disabled = !connected;
    $('#' + id).style.opacity = connected ? '' : '.5';
  }

  const list = $('#blocked');
  list.innerHTML = '';
  if (!blocklist.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:11px;color:var(--muted);padding:4px 0';
    empty.textContent = 'No sites blocked yet.';
    list.appendChild(empty);
  }
  blocklist.forEach((d, i) => {
    const el = document.createElement('div');
    el.className = 'blocked-item';
    el.innerHTML = `<span>${escapeHtml(d)}</span><button data-i="${i}">×</button>`;
    list.appendChild(el);
  });
}

async function initPairInputs() {
  const { bridge } = await get('bridge');
  if (bridge) {
    $('#port').value = bridge.port || '';
    $('#token').value = bridge.token || '';
  }
}

$('#pair').addEventListener('click', async () => {
  const port = Number($('#port').value);
  const token = $('#token').value.trim();
  if (!port || !token) return;
  await set({ bridge: { port, token } });
  chrome.runtime.sendMessage({ type: 'reconnect' });
  setTimeout(refresh, 400);
  setTimeout(refresh, 1200);
});

$('#unpair').addEventListener('click', async () => {
  chrome.runtime.sendMessage({ type: 'disconnect' });
  setTimeout(refresh, 300);
});

$('#addBlock').addEventListener('click', async () => {
  const v = $('#newBlock').value.trim()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!v) return;
  const { blocklist = [] } = await get('blocklist');
  if (!blocklist.includes(v)) blocklist.push(v);
  await set({ blocklist });
  $('#newBlock').value = '';
  refresh();
});

$('#blocked').addEventListener('click', async (e) => {
  if (e.target.tagName !== 'BUTTON') return;
  const { blocklist = [] } = await get('blocklist');
  blocklist.splice(Number(e.target.dataset.i), 1);
  await set({ blocklist });
  refresh();
});

for (const id of ['toggle', 'reset', 'skip']) {
  $('#' + id).addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'focus-command', command: id });
    setTimeout(refresh, 200);
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'focus-update') refresh();
});

initPairInputs();
refresh();
setInterval(refresh, 1000);