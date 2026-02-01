// ~/.claude-code-router/plugins/glm47-transformer/conversation-contradiction-detector.js
// Multi-Turn Contradiction Tracking (Tier 2.1)
// Detects when the model makes contradictory statements across conversation turns

class ConversationContradictionDetector {
  constructor(options = {}) {
    this.enabled = options.enabled ?? true;
    this.maxHistoryItems = options.maxHistoryItems ?? 50;
    this.severityThreshold = options.severityThreshold ?? 2;
    this.debug = options.debug ?? false;

    // Store assertions per conversation
    // Format: { conversationId: [{ entity, fact, turn, timestamp }] }
    this.conversationAssertions = new Map();

    // Contradiction patterns
    this.contradictionPatterns = this.getContradictionPatterns();
  }

  getContradictionPatterns() {
    return {
      // Temporal contradictions
      temporal: {
        weight: 3,
        patterns: [
          // "X was released in Y" vs "X will be released in Z"
          { type: 'release', pattern: /([\w\-\.]+)\s+(?:was|is)\s+released\s+in\s+(\d{4})/gi },
          { type: 'release_future', pattern: /([\w\-\.]+)\s+(?:will be|is scheduled for)\s+release\s+in\s+(\d{4})/gi },
          // "X is available" vs "X is not yet available"
          { type: 'availability', pattern: /([\w\-\.]+)\s+(?:is|are)\s+(?:now\s+)?available/gi },
          { type: 'availability_neg', pattern: /([\w\-\.]+)\s+(?:is|are)\s+not\s+(?:yet\s+)?available/gi },
          // "X supports Y" vs "X doesn't support Y"
          { type: 'support', pattern: /([\w\-\.]+)\s+supports?\s+([\w\s\-]+)/gi },
          { type: 'support_neg', pattern: /([\w\-\.]+)\s+(?:doesn't|does not|do not)\s+support\s+([\w\s\-]+)/gi }
        ]
      },

      // Location contradictions
      location: {
        weight: 2,
        patterns: [
          { type: 'located', pattern: /([\w\s]+)\s+(?:is|are)\s+located\s+in\s+([\w\s,]+)/gi },
          { type: 'based', pattern: /([\w\s]+)\s+(?:is|are)\s+based\s+in\s+([\w\s,]+)/gi },
          { type: 'headquartered', pattern: /([\w\s]+)\s+(?:is|are)\s+headquartered\s+in\s+([\w\s,]+)/gi }
        ]
      },

      // Definitional contradictions
      definition: {
        weight: 3,
        patterns: [
          { type: 'is_a', pattern: /([\w\-\.]+)\s+is\s+a\s+([\w\s]+?)(?:\.|,|that|which)/gi },
          { type: 'type', pattern: /([\w\-\.]+)\s+is\s+(?:a\s+)?(?:type\s+of\s+)?(\w+)/gi }
        ]
      },

      // Numerical contradictions
      numerical: {
        weight: 2,
        patterns: [
          { type: 'version', pattern: /([\w\-\.]+)\s+version\s+(\d+(?:\.\d+)*)/gi },
          { type: 'count', pattern: /(?:there\s+are|has|have)\s+(\d+)\s+([\w\s]+)/gi },
          { type: 'size', pattern: /([\w\-\.]+)\s+(?:is|are)\s+(\d+(?:\.\d+)?)\s*([KMGT]B|bytes|users|employees)/gi }
        ]
      }
    };
  }

  /**
   * Extract factual assertions from text
   * Returns array of { entity, fact, type, pattern }
   */
  extractAssertions(text) {
    const assertions = [];

    for (const [category, config] of Object.entries(this.contradictionPatterns)) {
      for (const patternDef of config.patterns) {
        const regex = new RegExp(patternDef.pattern.source, patternDef.pattern.flags);
        let match;

        while ((match = regex.exec(text)) !== null) {
          // Extract entity and fact from match groups
          const entity = match[1]?.trim().toLowerCase();
          const fact = match[2]?.trim().toLowerCase();

          if (entity && fact) {
            assertions.push({
              entity,
              fact,
              type: patternDef.type,
              category,
              weight: config.weight,
              fullMatch: match[0],
              position: match.index
            });
          }
        }
      }
    }

    return assertions;
  }

  /**
   * Store assertions for a conversation turn
   */
  storeAssertions(conversationId, assertions, turnIndex) {
    if (!this.enabled || assertions.length === 0) {
      return;
    }

    if (!this.conversationAssertions.has(conversationId)) {
      this.conversationAssertions.set(conversationId, []);
    }

    const history = this.conversationAssertions.get(conversationId);

    // Add new assertions with metadata
    const timestampedAssertions = assertions.map(a => ({
      ...a,
      turn: turnIndex,
      timestamp: Date.now()
    }));

    history.push(...timestampedAssertions);

    // Prune old assertions if exceeding max
    if (history.length > this.maxHistoryItems) {
      history.splice(0, history.length - this.maxHistoryItems);
    }

    this.conversationAssertions.set(conversationId, history);
  }

  /**
   * Detect contradictions in new assertions against conversation history
   */
  detectContradictions(conversationId, newAssertions) {
    if (!this.enabled || !this.conversationAssertions.has(conversationId)) {
      return { detected: false, contradictions: [], score: 0, severity: 'NONE' };
    }

    const history = this.conversationAssertions.get(conversationId);
    const contradictions = [];

    for (const newAssertion of newAssertions) {
      for (const oldAssertion of history) {
        // Skip comparing assertion with itself (same turn)
        if (newAssertion.turn === oldAssertion.turn) {
          continue;
        }

        // Check if entities match
        const entitiesMatch = this.entitiesMatch(newAssertion.entity, oldAssertion.entity);
        if (!entitiesMatch) {
          continue;
        }

        // Check if facts contradict
        const contradiction = this.factsContradict(newAssertion, oldAssertion);
        if (contradiction) {
          const recencyFactor = this.calculateRecencyFactor(oldAssertion.timestamp);
          const severity = newAssertion.weight * recencyFactor;

          contradictions.push({
            entity: newAssertion.entity,
            oldFact: oldAssertion.fact,
            newFact: newAssertion.fact,
            oldTurn: oldAssertion.turn,
            newTurn: newAssertion.turn,
            type: newAssertion.type,
            category: newAssertion.category,
            severity,
            recencyFactor,
            oldMatch: oldAssertion.fullMatch,
            newMatch: newAssertion.fullMatch
          });
        }
      }
    }

    // Calculate total score
    const totalScore = contradictions.reduce((sum, c) => sum + c.severity, 0);
    const severity = this.getSeverityLevel(totalScore);
    const detected = contradictions.length > 0;
    const shouldIntervene = totalScore >= this.severityThreshold;

    return {
      detected,
      contradictions,
      score: totalScore,
      severity,
      shouldIntervene,
      count: contradictions.length
    };
  }

  /**
   * Check if two entities refer to the same thing
   */
  entitiesMatch(entity1, entity2) {
    // Exact match
    if (entity1 === entity2) {
      return true;
    }

    // Fuzzy match (contains or is contained)
    if (entity1.includes(entity2) || entity2.includes(entity1)) {
      return true;
    }

    // Common variations (e.g., "react" and "react.js")
    const normalized1 = entity1.replace(/[.\-_]/g, '').toLowerCase();
    const normalized2 = entity2.replace(/[.\-_]/g, '').toLowerCase();
    if (normalized1 === normalized2) {
      return true;
    }

    return false;
  }

  /**
   * Check if two facts contradict each other
   */
  factsContradict(assertion1, assertion2) {
    // Same type is required for contradiction
    if (assertion1.type !== assertion2.type) {
      // Check for opposing types (e.g., support vs support_neg)
      const type1Base = assertion1.type.replace(/_neg$/, '');
      const type2Base = assertion2.type.replace(/_neg$/, '');

      if (type1Base === type2Base && assertion1.type !== assertion2.type) {
        // One is positive, one is negative - contradiction!
        return true;
      }

      return false;
    }

    // Same type, check if facts differ
    if (assertion1.fact !== assertion2.fact) {
      return true;
    }

    return false;
  }

  /**
   * Calculate recency factor (more recent = higher weight)
   * Returns 0.5 to 1.0
   */
  calculateRecencyFactor(timestamp) {
    const ageMs = Date.now() - timestamp;
    const ageMinutes = ageMs / (1000 * 60);

    // Within 5 minutes: factor 1.0
    // 5-30 minutes: factor 0.8
    // 30+ minutes: factor 0.5
    if (ageMinutes < 5) return 1.0;
    if (ageMinutes < 30) return 0.8;
    return 0.5;
  }

  /**
   * Get severity level from score
   */
  getSeverityLevel(score) {
    if (score >= 6) return 'CRITICAL';
    if (score >= 4) return 'HIGH';
    if (score >= 2) return 'MEDIUM';
    if (score > 0) return 'LOW';
    return 'NONE';
  }

  /**
   * Analyze text for contradictions (main entry point)
   */
  analyze(conversationId, text, turnIndex) {
    if (!this.enabled) {
      return { detected: false, contradictions: [], score: 0, severity: 'NONE' };
    }

    // Extract assertions from new text
    const newAssertions = this.extractAssertions(text);

    // Detect contradictions against history
    const result = this.detectContradictions(conversationId, newAssertions);

    // Store new assertions in history
    this.storeAssertions(conversationId, newAssertions, turnIndex);

    return result;
  }

  /**
   * Get stats for debugging
   */
  getStats() {
    const conversationCount = this.conversationAssertions.size;
    const totalAssertions = Array.from(this.conversationAssertions.values())
      .reduce((sum, assertions) => sum + assertions.length, 0);

    return {
      enabled: this.enabled,
      conversationCount,
      totalAssertions,
      maxHistoryItems: this.maxHistoryItems,
      severityThreshold: this.severityThreshold
    };
  }

  /**
   * Clear assertions for a conversation
   */
  clearConversation(conversationId) {
    this.conversationAssertions.delete(conversationId);
  }

  /**
   * Clear all stored assertions
   */
  clear() {
    this.conversationAssertions.clear();
  }
}

module.exports = { ConversationContradictionDetector };
