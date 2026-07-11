// Component A — the Sync Tap (§2). One Geode mod, two mutually-exclusive modes.
//
//   LIVE    (default): stream the tiny `tick` playhead over a localhost WebSocket. Hot path.
//   CAPTURE (offline) : while xdBot replays a macro, dump per-tick physics to a JSONL file.
//
// Draws nothing, edits nothing (§8: this tool reads, never writes). Clock = the level's
// internal time accumulator (§2.2 default) — no FMOD hook; ±30ms drift is invisible when
// reading rather than playing (§0.5).
//
// NOTE: Geode member names below (m_time, m_player1, m_isShip, …) target the current
// Windows Geode headers; confirm against the SDK version you build with. This file is not
// compiled in the JS repo host — build it via the CI workflow (.github/workflows) or a
// Windows box, per §5.1.
// Must come before Geode.hpp: Geode pulls in <windows.h>, which by default drags in the
// legacy <winsock.h> unless <winsock2.h> has already been included first. If that happens,
// net.hpp's own <winsock2.h> include collides with it (duplicate sockaddr/fd_set/timeval
// definitions). Including winsock2.h here first sets the _WINSOCKAPI_ guard that makes
// windows.h skip winsock.h later in this translation unit.
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <winsock2.h>
#include <ws2tcpip.h>
#endif

#include <Geode/Geode.hpp>
#include <Geode/modify/PlayLayer.hpp>
#include <Geode/modify/GJBaseGameLayer.hpp>
#include <Geode/modify/PlayerObject.hpp>
#include <fstream>
#include <memory>
#include "net.hpp"
#include "ring.hpp"

using namespace geode::prelude;

namespace {

enum class Mode { Live, Capture };

struct Tap {
  Mode mode = Mode::Live;
  tap::WsServer ws;
  std::unique_ptr<tap::Drain> wire;   // live: WS sender thread
  std::unique_ptr<tap::Drain> disk;   // capture: file writer thread
  std::ofstream file;
  uint64_t frame = 0;
  bool held = false;                  // current button state (from PlayerObject hook)
  bool active = false;                // inside a PlayLayer

  static Tap& get() { static Tap t; return t; }
};

// Read mode + port from mod settings once.
void configure() {
  auto& t = Tap::get();
  auto m = Mod::get()->getSettingValue<std::string>("mode");
  t.mode = (m == "capture") ? Mode::Capture : Mode::Live;
  if (t.mode == Mode::Live) {
    uint16_t port = (uint16_t)Mod::get()->getSettingValue<int64_t>("port");
    if (t.ws.start(port))
      t.wire = std::make_unique<tap::Drain>([&t](const std::string& s) { t.ws.sendText(s); });
    else
      log::warn("[tap] WS server failed to bind — live mode disabled");
  }
}

// ── JSON emit helpers (match §2.4 wire protocol / §2.6 telemetry) ─────────────
std::string jstr(const std::string& s) { return "\"" + s + "\""; } // inputs are trusted (level names)

void emitTick(double ms, double speed, bool paused) {
  auto& t = Tap::get();
  if (!t.wire) return;
  // Keep this tiny — it fires up to 240×/sec (§2.4). No casual field additions.
  char buf[96];
  snprintf(buf, sizeof(buf), "{\"t\":\"tick\",\"ms\":%.1f,\"speed\":%.3f,\"paused\":%s}",
           ms, speed, paused ? "true" : "false");
  t.wire->push(buf);
}

void emitEvent(const std::string& json) {
  auto& t = Tap::get();
  if (t.wire) t.wire->push(json);
}

// ── physics snapshot (capture mode, §2.6) ────────────────────────────────────
const char* modeName(PlayerObject* p) {
  if (p->m_isShip)   return "ship";
  if (p->m_isBird)   return "ufo";
  if (p->m_isBall)   return "ball";
  if (p->m_isDart)   return "wave";
  if (p->m_isRobot)  return "robot";
  if (p->m_isSpider) return "spider";
  if (p->m_isSwing)  return "swing";
  return "cube";
}

void writeTelemetry(PlayLayer* pl) {
  auto& t = Tap::get();
  if (!t.disk) return;
  auto* p = pl->m_player1;
  char buf[256];
  snprintf(buf, sizeof(buf),
    "{\"f\":%llu,\"ms\":%.1f,\"x\":%.1f,\"y\":%.1f,\"vy\":%.3f,\"rot\":%.1f,"
    "\"mode\":\"%s\",\"grav\":%d,\"held\":%s,\"dead\":%s}\n",
    (unsigned long long)t.frame, pl->m_time * 1000.0,
    p->getPositionX(), p->getPositionY(), p->m_yVelocity, p->getRotation(),
    modeName(p), p->m_isUpsideDown ? -1 : 1,
    t.held ? "true" : "false", p->m_isDead ? "true" : "false");
  t.disk->push(buf);
}

std::string captureName(PlayLayer* pl) {
  auto dir = Mod::get()->getSettingValue<std::string>("capture-dir");
  std::string base = dir.empty() ? (Mod::get()->getSaveDir().string()) : dir;
  std::string lvl = pl->m_level ? std::string(pl->m_level->m_levelName) : std::string("level");
  return base + "/" + lvl + ".telemetry.jsonl";
}

} // namespace

$on_mod(Loaded) { configure(); }

// ── Per-tick emit (§2.3) ──────────────────────────────────────────────────────
class $modify(TapGJBGL, GJBaseGameLayer) {
  void update(float dt) {
    GJBaseGameLayer::update(dt);
    auto& t = Tap::get();
    if (!t.active) return;
    auto* pl = PlayLayer::get();
    if (!pl) return;
    if (t.mode == Mode::Live) {
      // Clock = level time accumulator (§2.2). speed = game speed multiplier.
      emitTick(pl->m_time * 1000.0, this->m_gameState.m_timeWarp, pl->m_isPaused);
      t.ws.poll(); // accept/handshake a (re)connecting renderer
    } else {
      writeTelemetry(pl);
    }
    ++t.frame;
  }
};

// ── Button state (feeds telemetry `held`) ─────────────────────────────────────
class $modify(TapPlayer, PlayerObject) {
  void pushButton(PlayerButton b) {
    PlayerObject::pushButton(b);
    if (b == PlayerButton::Jump) Tap::get().held = true;
  }
  void releaseButton(PlayerButton b) {
    PlayerObject::releaseButton(b);
    if (b == PlayerButton::Jump) Tap::get().held = false;
  }
};

// ── Level lifecycle (§2.3) ────────────────────────────────────────────────────
class $modify(TapPlayLayer, PlayLayer) {
  bool init(GJGameLevel* level, bool useReplay, bool dontCreateObjects) {
    if (!PlayLayer::init(level, useReplay, dontCreateObjects)) return false;
    auto& t = Tap::get();
    t.active = true;
    t.frame = 0;
    bool startpos = this->m_startPosObject != nullptr;
    double songOffset = startpos ? this->m_time * 1000.0 : 0.0; // §6.2: begin mid-song

    if (t.mode == Mode::Capture) {
      t.file.open(captureName(this), std::ios::trunc);
      t.disk = std::make_unique<tap::Drain>([](const std::string& s) {
        Tap::get().file << s; // buffered off-thread (§2.7)
      });
    } else {
      // §2.4 levelStart — id, name, song offset, startpos flag
      std::string name = level ? std::string(level->m_levelName) : "";
      char buf[256];
      snprintf(buf, sizeof(buf),
        "{\"t\":\"levelStart\",\"id\":%d,\"name\":%s,\"songOffsetMs\":%.1f,\"startpos\":%s}",
        level ? level->m_levelID.value() : 0, jstr(name).c_str(), songOffset,
        startpos ? "true" : "false");
      emitEvent(buf);
    }
    return true;
  }

  // The one that bites people (§2.3): practice-mode respawns fire this constantly.
  void resetLevel() {
    PlayLayer::resetLevel();
    Tap::get().frame = 0;
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"t\":\"reset\",\"ms\":%.1f}", this->m_time * 1000.0);
    emitEvent(buf);
  }

  void pauseGame(bool p) {
    PlayLayer::pauseGame(p);
    emitEvent("{\"t\":\"pause\"}");
  }
  void resumeGame() {
    PlayLayer::resumeGame();
    char buf[64];
    snprintf(buf, sizeof(buf), "{\"t\":\"resume\",\"ms\":%.1f}", this->m_time * 1000.0);
    emitEvent(buf);
  }

  void onQuit() {
    auto& t = Tap::get();
    emitEvent("{\"t\":\"levelEnd\"}");
    t.active = false;
    if (t.disk) { t.disk.reset(); t.file.close(); } // flush + close the capture file
    PlayLayer::onQuit();
  }
};
