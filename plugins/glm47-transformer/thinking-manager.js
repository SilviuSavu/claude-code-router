// thinking-manager.js

class ThinkingManager {
  constructor() {
    // Map: conversationId -> array of thinking blocks per turn
    this.storage = new Map();
    this.maxTurns = 50; // Prevent unbounded growth
  }

  store(conversationId, thinkingContent) {
    if (!this.storage.has(conversationId)) {
      this.storage.set(conversationId, []);
    }

    const history = this.storage.get(conversationId);
    history.push(thinkingContent);

    // Trim old entries
    if (history.length > this.maxTurns) {
      history.shift();
    }
  }

  get(conversationId) {
    return this.storage.get(conversationId) || [];
  }

  clear(conversationId) {
    this.storage.delete(conversationId);
  }

  // For debugging
  dump() {
    return Object.fromEntries(this.storage);
  }
}

module.exports = { ThinkingManager };
