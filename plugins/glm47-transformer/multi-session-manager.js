class MultiSessionManager {
  constructor(options = {}) {
    this.maxAgeMs = options.maxAgeMs || 30 * 60 * 1000;
    this.maxSessions = options.maxSessions || 10;
    this.sessionInfo = new Map();
    this.conversationThinking = new Map();
  }

  registerSession(agentId, conversationId) {
    if (this.sessionInfo.size >= this.maxSessions) {
      this.evictOldestSession();
    }
    this.sessionInfo.set(agentId, {
      conversationId,
      lastActive: Date.now()
    });
    if (!this.conversationThinking.has(conversationId)) {
      this.conversationThinking.set(conversationId, []);
    }
  }

  getConversationId(agentId) {
    return this.sessionInfo.get(agentId)?.conversationId;
  }

  hasSession(agentId) {
    return this.sessionInfo.has(agentId);
  }

  storeThinking(conversationId, agentId, thinkingContent) {
    if (this.sessionInfo.has(agentId)) {
      this.sessionInfo.set(agentId, {
        conversationId: this.sessionInfo.get(agentId).conversationId,
        lastActive: Date.now()
      });
    }
    if (!this.conversationThinking.has(conversationId)) {
      this.conversationThinking.set(conversationId, []);
    }
    const thinkingArr = this.conversationThinking.get(conversationId);
    thinkingArr.push({
      content: thinkingContent,
      timestamp: Date.now(),
      agentId
    });
    if (thinkingArr.length > 50) {
      thinkingArr.shift();
    }
  }

  getThinking(conversationId, agentId) {
    if (this.sessionInfo.has(agentId)) {
      this.sessionInfo.set(agentId, {
        conversationId: this.sessionInfo.get(agentId).conversationId,
        lastActive: Date.now()
      });
    }
    const thinkingArr = this.conversationThinking.get(conversationId);
    if (!thinkingArr) return null;
    return thinkingArr.map(t => t.content).join('\n\n');
  }

  getSessionCount() {
    return this.sessionInfo.size;
  }

  getConversationCount() {
    return this.conversationThinking.size;
  }

  removeSession(agentId) {
    this.sessionInfo.delete(agentId);
  }

  evictOldestSession() {
    let oldestAgent = null;
    let oldestTime = Infinity;
    for (const [agentId, info] of this.sessionInfo) {
      if (info.lastActive < oldestTime) {
        oldestTime = info.lastActive;
        oldestAgent = agentId;
      }
    }
    if (oldestAgent) {
      this.removeSession(oldestAgent);
    }
  }

  cleanupExpiredSessions() {
    const now = Date.now();
    const expiredAgents = [];
    for (const [agentId, info] of this.sessionInfo) {
      if (now - info.lastActive > this.maxAgeMs) {
        expiredAgents.push(agentId);
      }
    }
    expiredAgents.forEach(agentId => this.removeSession(agentId));
    return expiredAgents.length;
  }

  getActiveSessions() {
    const sessions = [];
    for (const [agentId, info] of this.sessionInfo) {
      sessions.push({
        agentId,
        conversationId: info.conversationId,
        lastActive: info.lastActive,
        ageMs: Date.now() - info.lastActive
      });
    }
    return sessions.sort((a, b) => b.lastActive - a.lastActive);
  }

  clear() {
    this.sessionInfo.clear();
    this.conversationThinking.clear();
  }
}

export { MultiSessionManager };
