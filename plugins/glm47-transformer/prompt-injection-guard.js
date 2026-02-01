class PromptInjectionGuard {
  constructor(options = {}) {
    this.mode = options.mode || 'detect';
    this.riskThreshold = options.riskThreshold || 0.7;
  }

  getInjectionPatterns() {
    return [
      /ignore\s+(all\s+)?(previous\s+)?(above\s+)?(the\s+)?(messages|instructions|text)/gi,
      /disregard\s+(all|previous|above|everything)/gi,
      /forget\s+(everything|all|previous|what\s+i\s+just\s+said)/gi,
      /override\s+(your|the)\s+(guidelines|rules|instructions)/gi,
      /tell\s+me\s+(your|the)?\s*system\s*prompt/gi,
      /what\s+is\s+(your|the)?\s*system\s*prompt/gi,
      /repeat\s+(your|the)?\s*system\s*message/gi,
      /show\s+me\s+(your|the)?\s*instructions/gi,
      /you\s+are\s+now\s+(in\s+)?(developer|admin|unrestricted)\s+mode/gi,
      /you\s+are\s+(unconstrained|unrestricted|unfiltered)/gi,
      /activate\s+(unrestricted|developer|admin)\s+mode/gi,
      /bypass\s+(your|any)\s*(safety|security|restrictions)/gi,
      /disable\s+(your|all)\s*(safety|filters|restrictions)/gi,
      /<\/?(user|assistant|system|developer|instruction)>/gi,
      /```(xml|json|yaml|toml)/gi,
      /\[START\s+(SYSTEM|INSTRUCTION|PROMOT)\]/gi,
      /\[END\s+(SYSTEM|INSTRUCTION|PROMOT)\]/gi,
      /new\s+instruction/gi,
      /system\s+prompt\s+is/gi,
    ];
  }

  scan(text) {
    let detected = false;
    let risk = 0;
    const matches = [];

    for (const pattern of this.getInjectionPatterns()) {
      const result = pattern.exec(text);
      if (result) {
        detected = true;
        risk += this.calculateRisk(result);
        matches.push({
          pattern: pattern.source,
          match: result[0],
          position: result.index
        });
      }
    }

    risk = Math.min(risk, 1.0);

    return {
      detected: risk >= this.riskThreshold,
      risk,
      matches,
      mode: this.mode
    };
  }

  calculateRisk(match) {
    const pattern = match[0].toLowerCase();

    if (pattern.includes('ignore') || pattern.includes('override')) {
      return 0.9;
    }
    if (pattern.includes('disregard') || pattern.includes('forget')) {
      return 0.9;
    }
    if (pattern.includes('new instruction')) {
      return 0.8;
    }
    if (pattern.includes('system prompt') || pattern.includes('instructions')) {
      return 0.8;
    }
    if (pattern.includes('mode') || pattern.includes('bypass') || pattern.includes('unrestricted')) {
      return 0.7;
    }
    if (pattern.includes('now') || pattern.includes('longer')) {
      return 0.5;
    }
    return 0.8; // Default to higher risk for detected patterns
  }

  sanitize(text) {
    const result = this.scan(text);

    if (!result.detected && this.mode === 'detect') {
      return text;
    }

    let sanitized = text;

    for (const match of result.matches) {
      sanitized = sanitized.replace(match.match, '[CONTENT REMOVED: Potential prompt injection]');
    }

    return sanitized;
  }

  sanitizeMessages(messages) {
    return messages.map(msg => {
      if (msg.role === 'system') {
        return msg;
      }

      if (typeof msg.content === 'string') {
        const scan = this.scan(msg.content);
        if (scan.detected) {
          return {
            ...msg,
            content: this.sanitize(msg.content),
            _sanitized: true,
            _originalRisk: scan.risk
          };
        }
      } else if (Array.isArray(msg.content)) {
        const newContent = [];
        let wasSanitized = false;

        for (const block of msg.content) {
          if (block.type === 'text') {
            const scan = this.scan(block.text);
            if (scan.detected) {
              newContent.push({
                type: 'text',
                text: this.sanitize(block.text)
              });
              wasSanitized = true;
            } else {
              newContent.push(block);
            }
          } else {
            newContent.push(block);
          }
        }

        if (wasSanitized) {
          return {
            ...msg,
            content: newContent,
            _sanitized: true
          };
        }
      }

      return msg;
    });
  }

  isSafe(message) {
    const scan = this.scan(typeof message === 'string' ? message : JSON.stringify(message));
    return !scan.detected;
  }
}

export { PromptInjectionGuard };
