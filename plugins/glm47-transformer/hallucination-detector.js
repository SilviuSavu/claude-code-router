// ~/.claude-code-router/plugins/glm47-transformer/hallucination-detector.js

class HallucinationDetector {
  constructor(options = {}) {
    this.threshold = options.threshold ?? 3;
    this.bufferSize = options.bufferSize ?? 500;
    this.debug = options.debug ?? false;
    this.enabled = options.enabled ?? true;

    // Context-aware thresholds (Tier 1.2)
    this.contextAwareThresholds = options.contextAwareThresholds ?? {
      factualQuery: 3,      // Strict for factual questions
      opinionQuery: 6,      // Lenient, hedging is normal
      reasoningQuery: 4,    // Moderate for logical tasks
      futureQuery: 7,       // Very lenient, speculation is expected
      codeDebug: 2          // Very strict for code
    };

    // Pattern weights based on research (2025)
    this.patternCategories = this.getHallucinationPatterns();
    this.queryClassifier = new QueryClassifier();
  }

  getHallucinationPatterns() {
    // Pattern categories with weights based on research findings
    // Higher weight = stronger signal for hallucination
    return {
      // Weight 3: Strong signals - immediate intervention
      explicitUncertainty: {
        weight: 3,
        patterns: [
          /i'?m?\s+not\s+(sure|certain|confident)/gi,
          /i\s+don'?t\s+(know|have\s+access|have\s+information)/gi,
          /unable\s+to\s+(verify|confirm|determine|answer)/gi,
          /uncertain\s+about/gi,
          /not\s+certain\s+(what|how|when|where|why)/gi,
          /i\s+am\s+unsure\s+about/gi,
        ]
      },
      // Weight 3: Knowledge cutoff signals
      knowledgeCutoff: {
        weight: 3,
        patterns: [
          /my\s+(knowledge|training)\s+(cutoff|data|ends?)\s+(is|was)/gi,
          /i\s+don'?t\s+have\s+access\s+to\s+(current|recent|up\s+to\s+date)\s+(information|data)/gi,
          /training\s+data\s+(ends|cut\s+off)/gi,
          /as\s+of\s+(my|the)\s+(knowledge|training)\s+(cutoff|limit)/gi,
          /information\s+(may\s+be\s+)?outdated/gi,
          /i\s+(don'?t|do\s+not)\s+have\s+(real-time|live|current)\s+(data|information|access)/gi,
        ]
      },
      // Weight 3: Confusion signals
      wordSalad: {
        weight: 3,
        patterns: [
          /\b(\w+)\s+\1\s+\1\b/g,  // Triple repetition
          /(um+|uh+|er+|hmm+)(\s+(um+|uh+|er+|hmm+))+/gi,  // Stuttering fillers
          /\.{4,}/g,  // Excessive ellipsis
          /\?\s*\?\s*\?+/g,  // Multiple question marks
          /(maybe|perhaps|possibly)\s+(maybe|perhaps|possibly)/gi,  // Repeated hedging
        ]
      },
      // Weight 2: Contradictory reasoning
      contradictoryReasoning: {
        weight: 2,
        patterns: [
          /(but|however).{0,50}(but|however)/gi,
          /actually.{0,30}wait.{0,30}(no|actually)/gi,
          /(on\s+one\s+hand|on\s+the\s+other\s+hand).{0,100}(but|however|yet)/gi,
          /(although|though|even\s+though).{0,100}(contradicts|conflicts\s+with|is\s+opposite\s+to)/gi,
          /(i\s+(think|believe|said)).{0,100}(wait|actually\s+no|correction)/gi,
        ]
      },
      // Weight 2: Temporal confusion
      temporalConfusion: {
        weight: 2,
        patterns: [
          /(was|used\s+to\s+be).{0,30}(now|currently|presently)/gi,
          /may\s+have\s+changed\s+since/gi,
          /(currently|now|presently).{0,30}(was|used\s+to\s+be|previously)/gi,
          /(in\s+the\s+past|formerly|previously).{0,50}(but\s+now|however\s+now)/gi,
          /(don'?t\s+know\s+if\s+still\s+true|not\s+sure\s+if\s+still\s+the\s+case)/gi,
        ]
      },
      // Weight 2: Avoidance language
      avoidance: {
        weight: 2,
        patterns: [
          /i\s+(cannot|can'?t|unable\s+to)\s+(answer|provide|give|respond)\s+with\s+(certainty|confidence)/gi,
          /rather\s+than\s+speculat/gi,
          /would\s+not\s+want\s+to\s+(mislead|guess|speculate)/gi,
          /cannot\s+be\s+determined\s+with\s+(certainty|the\s+available\s+information)/gi,
        ]
      },
      // Weight 1: Hedging language (weaker signal)
      hedgingLanguage: {
        weight: 1,
        patterns: [
          /i\s+(think|believe|guess|assume|suppose)(\s+probably|\s+likely|\s+maybe|\s+possibly)?/gi,
          /(might|may|could|possibly)\s+be/gi,
          /it\s+seems\s+(that|like)/gi,
          /it\s+appears\s+(that|as\s+if)/gi,
          /i\s+(would|might|could)(\s+(say|suggest|imagine|guess|assume))/gi,
        ]
      }
    };
  }

  analyze(text, buffer = '', messages = null) {
    if (!this.enabled) {
      return {
        detected: false,
        score: 0,
        normalizedScore: 0,
        severity: 'NONE',
        confidence: 0,
        matches: [],
        patterns: [],
        shouldIntervene: false
      };
    }

    const fullText = buffer + text;
    const matches = [];
    const detectedPatterns = [];
    let totalScore = 0;

    // Check each pattern category
    for (const [category, config] of Object.entries(this.patternCategories)) {
      for (const pattern of config.patterns) {
        const regex = new RegExp(pattern.source, pattern.flags);
        let match;
        while ((match = regex.exec(fullText)) !== null) {
          matches.push({
            category,
            pattern: pattern.source,
            match: match[0],
            position: match.index,
            weight: config.weight
          });
          detectedPatterns.push(category);
          totalScore += config.weight;
        }
      }
    }

    // Calculate normalized score (0-1 range)
    // Max possible score = 10 (reasonable upper bound for detection)
    const maxPossibleScore = 10;
    const normalizedScore = Math.min(1.0, totalScore / maxPossibleScore);

    // Calculate confidence based on pattern diversity
    const uniquePatterns = [...new Set(detectedPatterns)];
    const patternDiversity = uniquePatterns.length;
    // Higher diversity = higher confidence (multiple types of signals)
    const confidence = Math.min(1.0, patternDiversity / 3); // 0.33 per unique pattern type, max 1.0

    // Determine severity level
    const severity = this.getSeverityLevel(normalizedScore);

    const detected = totalScore >= 1;
    const shouldIntervene = this.shouldIntervene({
      score: totalScore,
      normalizedScore,
      severity,
      matches,
      messages
    });

    return {
      detected,
      score: totalScore,
      normalizedScore,
      severity,
      confidence,
      matches,
      patterns: uniquePatterns,
      shouldIntervene,
      textSnippet: text.substring(0, 100)
    };
  }

  getSeverityLevel(normalizedScore) {
    if (normalizedScore >= 0.8) return 'CRITICAL';
    if (normalizedScore >= 0.5) return 'HIGH';
    if (normalizedScore >= 0.25) return 'MEDIUM';
    if (normalizedScore > 0) return 'LOW';
    return 'NONE';
  }

  shouldIntervene(analysis) {
    // Intervention if any high-weight pattern detected or threshold reached
    const hasHighWeightPattern = analysis.matches.some(m => m.weight >= 3);

    // Use context-aware threshold if messages are provided
    let threshold = this.threshold;
    if (analysis.messages) {
      const queryType = this.queryClassifier.classify(analysis.messages);
      threshold = this.contextAwareThresholds[queryType] || this.threshold;

      // Filter out allowed patterns for context
      // For opinion queries, hedging is normal and should be ignored
      if (queryType === 'opinionQuery') {
        const filteredMatches = analysis.matches.filter(m =>
          m.category !== 'hedgingLanguage' && m.category !== 'avoidance'
        );
        const filteredScore = filteredMatches.reduce((sum, m) => sum + m.weight, 0);
        analysis.score = filteredScore;
      }
      // For future queries, temporal patterns are expected
      else if (queryType === 'futureQuery') {
        const filteredMatches = analysis.matches.filter(m =>
          m.category !== 'hedgingLanguage' && m.category !== 'temporalConfusion'
        );
        const filteredScore = filteredMatches.reduce((sum, m) => sum + m.weight, 0);
        analysis.score = filteredScore;
      }
    }

    const thresholdReached = analysis.score >= threshold;

    // Also consider severity level
    const isCriticalSeverity = analysis.severity === 'CRITICAL' || analysis.severity === 'HIGH';

    return hasHighWeightPattern || thresholdReached || isCriticalSeverity;
  }

  // Analyze just the incoming chunk (fast, minimal state)
  analyzeChunk(chunk, messages = null) {
    return this.analyze(chunk, '', messages);
  }

  // Check if text should trigger immediate intervention
  isHighRisk(text) {
    const analysis = this.analyze(text);
    return analysis.shouldIntervene;
  }

  // Get stats for debugging
  getStats() {
    return {
      enabled: this.enabled,
      threshold: this.threshold,
      bufferSize: this.bufferSize,
      patternCategories: Object.keys(this.patternCategories)
    };
  }

  reset() {
    // Reset any internal state (for future use)
  }
}

/**
 * QueryClassifier - Categorizes user queries to apply context-aware thresholds
 * Tier 1.2 implementation
 */
class QueryClassifier {
  constructor() {
    this.categories = {
      factualQuery: {
        patterns: [
          /^(what|when|where|who|which)\s+(is|are|was|were|did)/i,
          /^(how\s+many|how\s+much)/i,
          /(latest|current|newest)\s+(version|release)/i,
          /^(does|do|is|are)\s+.+(support|have|include|contain)/i
        ],
        weight: 1.5
      },
      opinionQuery: {
        patterns: [
          /^(what\s+do\s+you\s+think|in\s+your\s+opinion)/i,
          /\b(better|best|worse|worst)\b/i,
          /\b(prefer|recommend|suggestion)\b/i,
          /^(should\s+i|which\s+one\s+should)/i,
          /\b(vs\.?|versus|or)\b.*\?/i,  // "X or Y?" pattern
          /which\s+is\s+(better|best|worse|preferred)/i
        ],
        weight: 0.5  // Allow more hedging
      },
      reasoningQuery: {
        patterns: [
          /^(how\s+does|how\s+would|why\s+does)/i,
          /^(explain|describe|analyze)/i,
          /^(calculate|compute|determine)/i,
          /\b(if.*then|because|therefore)\b/i
        ],
        weight: 1.0
      },
      futureQuery: {
        patterns: [
          /\b(will|would|could|might|may)\b/i,
          /\b(future|upcoming|planned|roadmap)\b/i,
          /\b(predict|forecast|expect)\b/i,
          /\b(when\s+will|in\s+the\s+future)\b/i
        ],
        weight: 0.3  // Very lenient, speculation is expected
      },
      codeDebug: {
        patterns: [
          /\b(error|exception|bug|crash|fail|broken)\b/i,
          /\b(debug|fix|resolve|troubleshoot)\b/i,
          /\b(why\s+is.*not\s+working)\b/i,
          /\b(syntax\s+error|runtime\s+error|compile\s+error)\b/i,
          /```[\s\S]*```/  // Contains code block
        ],
        weight: 2.0  // Very strict for code
      }
    };
  }

  classify(messages) {
    if (!messages || messages.length === 0) {
      return 'factualQuery';  // Default
    }

    // Get last user message
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) {
      return 'factualQuery';
    }

    const lastMessage = userMessages[userMessages.length - 1];
    let content = '';

    // Extract text content
    if (typeof lastMessage.content === 'string') {
      content = lastMessage.content;
    } else if (Array.isArray(lastMessage.content)) {
      content = lastMessage.content
        .filter(block => block.type === 'text')
        .map(block => block.text || '')
        .join(' ');
    }

    // Score each category
    const scores = {};
    for (const [category, config] of Object.entries(this.categories)) {
      let score = 0;
      for (const pattern of config.patterns) {
        if (pattern.test(content)) {
          score += config.weight;
        }
      }
      scores[category] = score;
    }

    // Return category with highest score, or 'factualQuery' if all 0
    const maxCategory = Object.keys(scores).reduce((a, b) =>
      scores[a] > scores[b] ? a : b
    );

    return scores[maxCategory] > 0 ? maxCategory : 'factualQuery';
  }
}

module.exports = { HallucinationDetector };
