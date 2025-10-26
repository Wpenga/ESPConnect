import { SerialPort } from 'serialport';

const preferredPath = process.argv[2]?.toUpperCase() ?? 'COM6';

const ports = await SerialPort.list();
console.log('Discovered serial ports:');
for (const p of ports) {
  console.log({
    path: p.path,
    vendorId: p.vendorId,
    productId: p.productId,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
    friendlyName: p.friendlyName
  });
}

const esp32Port =
  ports.find(p => p.path?.toUpperCase() === preferredPath) ??
  ports.find(p => /ESP32/i.test(p.friendlyName ?? '') || /ESP/i.test(p.manufacturer ?? ''));

if (!esp32Port) {
  console.error(
    `Could not find a serial port matching ${preferredPath}. Pass the desired port path as the first argument if needed.`
  );
  process.exit(1);
}

const port = new SerialPort({ path: esp32Port.path, baudRate: 115200 });

port.on('open', () => {
  console.log(`\nListening on ${esp32Port.path} at 115200 baud...`);
  console.log('Press Ctrl+C to stop.\n');
});

port.on('data', buf => process.stdout.write(buf));
port.on('error', err => console.error(`Serial error: ${err.message}`));
