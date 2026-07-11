// Minimal localhost WebSocket server (RFC6455 text frames) over Winsock.
//
// This is the TRANSPORT, deliberately kept out of main.cpp so the mod *logic* stays inside
// the <250-line budget (§2.7). The renderer is the client; we are the server bound to
// 127.0.0.1:PORT (§2.4) so the renderer can reconnect freely without restarting GD.
//
// Wine shares the host network stack, so this localhost socket reaches the native macOS
// renderer (§0). Untested on-device from this repo host — verify per §5.3 Phase 2.
#pragma once
#include <string>
#include <cstdint>
#include <cstring>

#ifdef _WIN32
// Defensive: if this header is ever included before anything has pulled in <windows.h>,
// make sure winsock2.h wins over the legacy winsock.h (see the note in main.cpp).
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#endif

namespace tap {

// ── SHA-1 (for the WebSocket handshake accept key) ───────────────────────────
inline void sha1(const uint8_t* data, size_t len, uint8_t out[20]) {
  uint32_t h[5] = {0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0};
  size_t ml = len * 8;
  std::string msg((const char*)data, len);
  msg += (char)0x80;
  while (msg.size() % 64 != 56) msg += (char)0x00;
  for (int i = 7; i >= 0; --i) msg += (char)((ml >> (i * 8)) & 0xff);
  auto rol = [](uint32_t v, int b) { return (v << b) | (v >> (32 - b)); };
  for (size_t c = 0; c < msg.size(); c += 64) {
    uint32_t w[80];
    for (int i = 0; i < 16; ++i)
      w[i] = (uint8_t)msg[c + i*4] << 24 | (uint8_t)msg[c + i*4+1] << 16 |
             (uint8_t)msg[c + i*4+2] << 8 | (uint8_t)msg[c + i*4+3];
    for (int i = 16; i < 80; ++i) w[i] = rol(w[i-3]^w[i-8]^w[i-14]^w[i-16], 1);
    uint32_t a=h[0],b=h[1],cc=h[2],d=h[3],e=h[4];
    for (int i = 0; i < 80; ++i) {
      uint32_t f, k;
      if (i < 20)      { f = (b & cc) | (~b & d);            k = 0x5A827999; }
      else if (i < 40) { f = b ^ cc ^ d;                     k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & cc) | (b & d) | (cc & d);  k = 0x8F1BBCDC; }
      else             { f = b ^ cc ^ d;                     k = 0xCA62C1D6; }
      uint32_t t = rol(a,5) + f + e + k + w[i];
      e=d; d=cc; cc=rol(b,30); b=a; a=t;
    }
    h[0]+=a; h[1]+=b; h[2]+=cc; h[3]+=d; h[4]+=e;
  }
  for (int i = 0; i < 5; ++i)
    for (int j = 0; j < 4; ++j) out[i*4+j] = (h[i] >> (24 - j*8)) & 0xff;
}

inline std::string base64(const uint8_t* d, size_t n) {
  static const char* T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string o;
  for (size_t i = 0; i < n; i += 3) {
    uint32_t x = d[i] << 16;
    if (i+1 < n) x |= d[i+1] << 8;
    if (i+2 < n) x |= d[i+2];
    o += T[(x >> 18) & 63];
    o += T[(x >> 12) & 63];
    o += (i+1 < n) ? T[(x >> 6) & 63] : '=';
    o += (i+2 < n) ? T[x & 63] : '=';
  }
  return o;
}

// A single-client, non-blocking WebSocket server. If no client is connected we drop
// frames silently and never block (§2.7).
class WsServer {
public:
  bool start(uint16_t port) {
#ifdef _WIN32
    WSADATA w; if (WSAStartup(MAKEWORD(2,2), &w) != 0) return false;
    listen_ = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (listen_ == INVALID_SOCKET) return false;
    u_long nb = 1; ioctlsocket(listen_, FIONBIO, &nb);
    int yes = 1; setsockopt(listen_, SOL_SOCKET, SO_REUSEADDR, (char*)&yes, sizeof(yes));
    sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(port);
    inet_pton(AF_INET, "127.0.0.1", &a.sin_addr);
    if (bind(listen_, (sockaddr*)&a, sizeof(a)) != 0) return false;
    if (::listen(listen_, 1) != 0) return false;
    return true;
#else
    (void)port; return false; // server only runs inside the Windows GD build
#endif
  }

  // Accept a pending client / complete the handshake. Call periodically; non-blocking.
  void poll() {
#ifdef _WIN32
    if (client_ == INVALID_SOCKET) {
      SOCKET c = accept(listen_, nullptr, nullptr);
      if (c != INVALID_SOCKET) { u_long nb=1; ioctlsocket(c, FIONBIO, &nb); pending_ = c; handshake_.clear(); }
    }
    if (pending_ != INVALID_SOCKET) tryHandshake();
#endif
  }

  // Send a text frame. Returns false if not connected (caller drops the message).
  bool sendText(const std::string& s) {
#ifdef _WIN32
    if (client_ == INVALID_SOCKET) return false;
    std::string f; f += (char)0x81; // FIN + text
    size_t n = s.size();
    if (n < 126) f += (char)n;
    else if (n < 65536) { f += (char)126; f += (char)(n>>8); f += (char)(n&0xff); }
    else { f += (char)127; for (int i=7;i>=0;--i) f += (char)((n>>(i*8))&0xff); }
    f += s;
    int sent = send(client_, f.data(), (int)f.size(), 0);
    if (sent == SOCKET_ERROR) { closesocket(client_); client_ = INVALID_SOCKET; return false; }
    return true;
#else
    (void)s; return false;
#endif
  }

private:
#ifdef _WIN32
  void tryHandshake() {
    char buf[1024];
    int r = recv(pending_, buf, sizeof(buf), 0);
    if (r > 0) handshake_.append(buf, r);
    if (handshake_.find("\r\n\r\n") == std::string::npos) return;
    auto p = handshake_.find("Sec-WebSocket-Key:");
    if (p == std::string::npos) { closesocket(pending_); pending_ = INVALID_SOCKET; return; }
    p += 18; while (handshake_[p] == ' ') ++p;
    auto e = handshake_.find("\r\n", p);
    std::string key = handshake_.substr(p, e - p);
    key += "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    uint8_t dig[20]; sha1((const uint8_t*)key.data(), key.size(), dig);
    std::string accept = base64(dig, 20);
    std::string resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n"
                       "Connection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n";
    send(pending_, resp.data(), (int)resp.size(), 0);
    client_ = pending_; pending_ = INVALID_SOCKET;
  }
  SOCKET listen_ = INVALID_SOCKET, client_ = INVALID_SOCKET, pending_ = INVALID_SOCKET;
  std::string handshake_;
#endif
};

} // namespace tap
