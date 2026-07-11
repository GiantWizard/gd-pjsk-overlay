// Bounded, non-blocking message queue + dedicated drain thread (§2.7).
//
// The hard rule: a send/disk-write must NEVER block GJBaseGameLayer::update() — a blocking
// call there stutters the game. update() only ever try_push()es and returns immediately;
// if the queue is full it DROPS the message (never block, never buffer unboundedly, §2.7).
// A background thread drains the queue to whatever sink is provided (WS or disk).
#pragma once
#include <string>
#include <deque>
#include <mutex>
#include <condition_variable>
#include <thread>
#include <atomic>
#include <functional>

namespace tap {

class Drain {
public:
  // `sink` runs on the worker thread; it does the (possibly slow) send/write.
  explicit Drain(std::function<void(const std::string&)> sink, size_t cap = 4096)
    : sink_(std::move(sink)), cap_(cap) {
    worker_ = std::thread([this] { run(); });
  }
  ~Drain() {
    { std::lock_guard<std::mutex> l(m_); stop_ = true; } cv_.notify_all();
    if (worker_.joinable()) worker_.join();
  }

  // Called from update() — non-blocking. Returns false if the message was dropped.
  bool push(std::string msg) {
    {
      std::lock_guard<std::mutex> l(m_);
      if (q_.size() >= cap_) { ++dropped_; return false; } // full → drop, don't block
      q_.push_back(std::move(msg));
    }
    cv_.notify_one();
    return true;
  }

  uint64_t dropped() const { return dropped_.load(); }

private:
  void run() {
    for (;;) {
      std::string msg;
      {
        std::unique_lock<std::mutex> l(m_);
        cv_.wait(l, [this] { return stop_ || !q_.empty(); });
        if (stop_ && q_.empty()) return;
        msg = std::move(q_.front()); q_.pop_front();
      }
      sink_(msg);
    }
  }

  std::function<void(const std::string&)> sink_;
  std::deque<std::string> q_;
  std::mutex m_;
  std::condition_variable cv_;
  std::thread worker_;
  size_t cap_;
  bool stop_ = false;
  std::atomic<uint64_t> dropped_{0};
};

} // namespace tap
