import './style.css';
import { ESPLoader, Transport } from 'esptool-js';

const SUPPORTED_VENDORS = [
  { usbVendorId: 0x303a }, // Espressif
  { usbVendorId: 0x1a86 }, // WCH CH34x bridges
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x
  { usbVendorId: 0x0403 }, // FTDI FT232
];

const DEFAULT_ROM_BAUD = 115200;
const DEFAULT_TARGET_BAUD = 921600;

const app = document.querySelector('#app');

if (!app) {
  throw new Error('Unable to locate #app root element.');
}

app.innerHTML = `
  <main>
    <h1>ESP32 Web Flasher</h1>
    <div class="status-line">
      <div class="status-indicator" id="status-indicator"></div>
      <span id="status-text">Disconnected</span>
    </div>

    <section class="controls">
      <div>
        <button id="connect-btn">Connect</button>
        <button id="disconnect-btn" disabled>Disconnect</button>
      </div>
      <label>
        Target baud rate
        <select id="baud-select">
          <option value="115200">115200</option>
          <option value="460800">460800</option>
          <option value="921600" selected>921600</option>
        </select>
      </label>
    </section>

    <section class="flash">
      <label>
        Firmware binary (.bin)
        <input type="file" id="firmware-input" accept=".bin" />
      </label>
      <label>
        Flash offset (hex)
        <input type="text" id="offset-input" value="0x0" />
      </label>
      <label class="checkbox-row">
        <input type="checkbox" id="erase-checkbox" />
        <span>Erase entire flash before writing</span>
      </label>
      <button id="flash-btn" disabled>Flash Firmware</button>
      <div>
        <progress id="flash-progress" value="0" max="100"></progress>
        <div id="progress-label" aria-live="polite">0%</div>
      </div>
    </section>

    <pre id="log" role="log" aria-live="polite"></pre>
  </main>
`;

const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const flashBtn = document.getElementById('flash-btn');
const firmwareInput = document.getElementById('firmware-input');
const offsetInput = document.getElementById('offset-input');
const eraseCheckbox = document.getElementById('erase-checkbox');
const baudSelect = document.getElementById('baud-select');
const progressEl = document.getElementById('flash-progress');
const progressLabel = document.getElementById('progress-label');
const logEl = document.getElementById('log');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

const terminal = {
  clean() {
    logEl.textContent = '';
  },
  write(data) {
    logEl.textContent += data;
    logEl.scrollTop = logEl.scrollHeight;
  },
  writeLine(data) {
    logEl.textContent += `${data}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  },
};

let currentPort = null;
let transport = null;
let loader = null;
let firmwareBuffer = null;
let firmwareName = '';
let connected = false;

function logLine(message) {
  terminal.writeLine(`[ui] ${message}`);
}

function setStatus(isConnected, details = '') {
  connected = isConnected;
  statusIndicator.classList.toggle('connected', isConnected);
  statusText.textContent = isConnected ? `Connected ${details}` : 'Disconnected';
  disconnectBtn.disabled = !isConnected;
  connectBtn.disabled = isConnected;
  updateFlashButtonState();
}

function updateFlashButtonState() {
  flashBtn.disabled = !(connected && firmwareBuffer);
}

function parseOffset(value) {
  if (!value) {
    throw new Error('Flash offset is required.');
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('0x')) {
    const parsed = Number.parseInt(trimmed, 16);
    if (Number.isNaN(parsed)) {
      throw new Error('Invalid hexadecimal offset.');
    }
    return parsed;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed)) {
    throw new Error('Invalid offset.');
  }
  return parsed;
}

function ensureSerialSupport() {
  if (!('serial' in navigator)) {
    throw new Error('This browser does not support the Web Serial API. Use Chrome or Edge 89+.');
  }
}

async function disconnectTransport() {
  try {
    if (transport) {
      await transport.disconnect();
    } else if (currentPort) {
      await currentPort.close();
    }
  } catch (error) {
    console.warn('Error while disconnecting transport:', error);
  } finally {
    currentPort = null;
    transport = null;
    loader = null;
    setStatus(false);
  }
}

connectBtn.addEventListener('click', async () => {
  try {
    ensureSerialSupport();
  } catch (error) {
    logLine(error.message);
    return;
  }
  connectBtn.disabled = true;
  terminal.clean();
  logLine('Requesting serial port access...');
  try {
    currentPort = await navigator.serial.requestPort({
      filters: SUPPORTED_VENDORS,
    });
    const baudrate = Number.parseInt(baudSelect.value, 10) || DEFAULT_TARGET_BAUD;
    transport = new Transport(currentPort);
    loader = new ESPLoader({
      transport,
      baudrate,
      romBaudrate: DEFAULT_ROM_BAUD,
      terminal,
      enableTracing: false,
    });

    const chipName = await loader.main('default_reset');
    await loader.flashId();
    setStatus(true, `(${chipName})`);
    logLine(`Ready to flash. Selected baud rate: ${baudrate}.`);
  } catch (error) {
    if (error && (error.name === 'AbortError' || error.name === 'NotFoundError')) {
      logLine('Port selection was cancelled.');
    } else {
      logLine(`Connection failed: ${error.message || error}`);
    }
    await disconnectTransport();
  }
});

disconnectBtn.addEventListener('click', async () => {
  disconnectBtn.disabled = true;
  await disconnectTransport();
  logLine('Serial port released.');
});

firmwareInput.addEventListener('change', async event => {
  const input = event.target;
  if (!input.files || input.files.length === 0) {
    firmwareBuffer = null;
    firmwareName = '';
    updateFlashButtonState();
    return;
  }

  const file = input.files[0];
  firmwareBuffer = await file.arrayBuffer();
  firmwareName = file.name;
  logLine(`Firmware loaded: ${firmwareName} (${file.size} bytes).`);
  updateFlashButtonState();
});

flashBtn.addEventListener('click', async () => {
  if (!loader || !firmwareBuffer) {
    logLine('Connect to a device and select a firmware image first.');
    return;
  }

  let offset;
  try {
    offset = parseOffset(offsetInput.value);
  } catch (error) {
    logLine(error.message);
    return;
  }

  flashBtn.disabled = true;
  progressEl.value = 0;
  progressLabel.textContent = '0%';

  const firmwareBytes = new Uint8Array(firmwareBuffer);
  const dataString = loader.ui8ToBstr(firmwareBytes);

  try {
    logLine(`Flashing ${firmwareName} at 0x${offset.toString(16)}...`);
    const started = performance.now();
    await loader.writeFlash({
      fileArray: [{ data: dataString, address: offset }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: eraseCheckbox.checked,
      compress: true,
      reportProgress: (_fileIndex, written, total) => {
        const percent = total ? Math.floor((written / total) * 100) : 0;
        progressEl.value = percent;
        progressLabel.textContent = `${percent}%`;
      },
    });
    await loader.after('hard_reset');
    const elapsed = ((performance.now() - started) / 1000).toFixed(1);
    logLine(`Flashing complete in ${elapsed}s. Device rebooted.`);
  } catch (error) {
    logLine(`Flashing failed: ${error.message || error}`);
  } finally {
    flashBtn.disabled = false;
    progressLabel.textContent = '0%';
    progressEl.value = 0;
  }
});

window.addEventListener('beforeunload', () => {
  if (connected && transport) {
    // Fire and forget; browser will close soon after.
    transport.disconnect();
  }
});
