export class TokenOptimizer {
  constructor(options = {}) {
    this.aggressive = options.aggressive ?? false;
    this.maxHistoryTurns = options.maxHistoryTurns ?? 15;
    this.deduplicationEnabled = options.deduplicationEnabled ?? true;
    this.mergeConsecutiveEnabled = options.mergeConsecutiveEnabled ?? true;
    this.lastSavings = null;
  }

  estimateTokens(messages) {
    let totalChars = 0;
    for (const msg of messages) {
      const content = this.extractTextContent(msg);
      totalChars += content.length + this.formatOverhead(msg);
    }
    return Math.ceil(totalChars / 4);
  }

  extractTextContent(msg) {
    if (typeof msg.content === 'string') {
      return msg.content;
    }
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter(b => b.type === 'text')
        .map(b => b.text || '')
        .join('');
    }
    return '';
  }

  formatOverhead(msg) {
    return msg.role.length + 10;
  }

  optimize(messages) {
    const originalEstimate = this.estimateTokens(messages);

    let optimized = [...messages];

    if (this.mergeConsecutiveEnabled) {
      optimized = this.mergeConsecutive(optimized);
    }

    if (this.deduplicationEnabled) {
      optimized = this.removeDuplicates(optimized);
    }

    if (optimized.length > this.maxHistoryTurns * 2) {
      optimized = this.truncateHistory(optimized);
    }

    const optimizedEstimate = this.estimateTokens(optimized);

    this.lastSavings = {
      originalCount: messages.length,
      optimizedCount: optimized.length,
      originalEstimate,
      optimizedEstimate,
      tokensSaved: originalEstimate - optimizedEstimate,
      percentSaved: ((originalEstimate - optimizedEstimate) / originalEstimate * 100).toFixed(2)
    };

    return optimized;
  }

  mergeConsecutive(messages) {
    if (messages.length === 0) return [];

    const merged = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const current = messages[i];
      const last = merged[merged.length - 1];

      if (current.role === last.role && current.role !== 'system') {
        const lastContent = this.extractTextContent(last);
        const currentContent = this.extractTextContent(current);

        merged[merged.length - 1] = {
          ...last,
          content: `${lastContent}\n\n${currentContent}`
        };
      } else {
        merged.push(current);
      }
    }

    return merged;
  }

  removeDuplicates(messages) {
    const seen = new Set();
    const filtered = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        filtered.push(msg);
        continue;
      }

      const content = this.extractTextContent(msg);
      const hash = this.hashContent(content);

      if (!seen.has(hash)) {
        seen.add(hash);
        filtered.push(msg);
      } else if (this.aggressive) {
        continue;
      } else {
        filtered.push(msg);
      }
    }

    return filtered;
  }

  hashContent(content) {
    const normalized = content.toLowerCase().trim().replace(/\s+/g, ' ');
    return normalized.substring(0, 100);
  }

  truncateHistory(messages) {
    const systemMessages = messages.filter(m => m.role === 'system');
    const nonSystem = messages.filter(m => m.role !== 'system');

    const keepCount = this.maxHistoryTurns * 2;
    const recent = nonSystem.slice(-keepCount);

    return [...systemMessages, ...recent];
  }

  getSavings() {
    return this.lastSavings;
  }

  getStats() {
    return {
      aggressive: this.aggressive,
      maxHistoryTurns: this.maxHistoryTurns,
      deduplicationEnabled: this.deduplicationEnabled,
      mergeConsecutiveEnabled: this.mergeConsecutiveEnabled,
      lastSavings: this.lastSavings
    };
  }
}
