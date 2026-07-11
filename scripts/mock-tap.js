// Mock sync tap (dev aid) — a node WebSocket server that speaks the §2.4 wire protocol,
// so you can develop the renderer's live path (Phase 3) without Wine or the C++ mod.
// Emits a levelStart then streams `tick` at ~120Hz, looping the demo level.
//
//   node scripts/mock-tap.js [port]
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { WS_PORT } from '../shared/protocol.js';

const port = Number(process.argv[2]) || WS_PORT;
const DURATION_MS = 16500;

// Encode a WebSocket text frame (server→client, unmasked).
function frame(str) {
  const payload = Buffer.from(str, 'utf-8');
  const n = payload.length;
  let header;
  if (n < 126) header = Buffer.from([0x81, n]);
  else if (n < 65536) header = Buffer.from([0x81, 126, (n >> 8) & 255, n & 255]);
  else header = Buffer.concat([Buffer.from([0x81, 127]), bigLen(n)]);
  return Buffer.concat([header, payload]);
}
function bigLen(n) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; }

const server = createServer();
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
    'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  socket.write(frame(JSON.stringify({ t: 'levelStart', id: 60978746, name: 'The Golden (mock)', songOffsetMs: 0 })));
  const t0 = Date.now();
  const timer = setInterval(() => {
    const ms = (Date.now() - t0) % DURATION_MS;
    try { socket.write(frame(JSON.stringify({ t: 'tick', ms, speed: 1.0, paused: false }))); }
    catch { clearInterval(timer); }
  }, 8);
  socket.on('close', () => clearInterval(timer));
  socket.on('error', () => clearInterval(timer));
});

server.listen(port, '127.0.0.1', () => console.log(`mock tap on ws://127.0.0.1:${port}`));
