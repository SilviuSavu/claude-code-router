// uncertainty-detector.js
// Detects when queries need current info and analyzes thinking for uncertainty signals
// Part of UQLM + DeepAgent integration for preventing hallucination spirals

class UncertaintyDetector {
  constructor(options = {}) {
    this.threshold = options.threshold || 0.7;
    this.debug = options.debug || false;

    // Keywords that suggest the query needs current/recent information
    this.currentInfoKeywords = [
      // Time-sensitive
      'latest', 'current', 'recent', 'new', 'newest', 'updated',
      'today', 'now', 'this year', 'this month', 'this week',
      // Years (dynamic - add current and recent years)
      '2026', '2025', '2024',
      // Version/release related
      'version', 'release', 'update', 'changelog', 'what\'s new',
      // Documentation/API related
      'documentation', 'docs', 'api', 'official',
      // Comparison with current state
      'currently', 'nowadays', 'these days', 'at the moment'
    ];

    // Phrases that indicate uncertainty in the model's thinking
    this.uncertaintySignals = [
      // Epistemic uncertainty
      'i think', 'i believe', 'probably', 'might be', 'could be',
      'not sure', 'uncertain', 'unsure', 'not certain',
      // Knowledge cutoff indicators
      'as of my', 'my knowledge', 'my training', 'cutoff',
      'i don\'t have', 'i don\'t know', 'no information',
      'may have changed', 'might have changed', 'could have changed',
      // Hedging language
      'it seems', 'it appears', 'apparently', 'supposedly',
      'i would guess', 'my guess', 'if i recall', 'if i remember',
      // Outdated info indicators
      'outdated', 'old information', 'previously', 'used to be',
      'was available', 'was released', 'at that time'
    ];

    // Strong uncertainty signals (higher weight)
    this.strongUncertaintySignals = [
      'i don\'t have access to',
      'my knowledge cutoff',
      'i cannot access',
      'unable to verify',
      'cannot confirm',
      'no recent information'
    ];
  }

  /**
   * Analyze REQUEST to decide if web search should be forced
   * Called during transformRequestIn
   * @param {Object} request - The incoming request
   * @returns {Object} - { shouldForce: boolean, reason: string, keywords: string[] }
   */
  shouldForceWebSearch(request) {
    const messages = request.messages || [];

    // Get the last user message
    const lastUserMessage = messages
      .filter(m => m.role === 'user')
      .pop();

    if (!lastUserMessage) {
      return { shouldForce: false, reason: 'no user message', keywords: [] };
    }

    const content = this.extractContent(lastUserMessage);
    const lower = content.toLowerCase();

    // CRITICAL FIX: Ignore system-like messages (ground rules, suggestions, etc.)
    // These contain keywords like "latest", "current", "documentation" but aren't real user queries
    const systemPatterns = [
      /session ground rules/i,
      /\[suggestion mode\]/i,
      /<system-reminder>/i,
      /web page content:/i,
      /SessionStart/i,
      /mindset for this session/i
    ];

    const isSystemLike = systemPatterns.some(pattern => pattern.test(content));
    if (isSystemLike) {
      return { shouldForce: false, reason: 'system-like message, not user query', keywords: [] };
    }

    // Find matching keywords
    const matchedKeywords = this.currentInfoKeywords.filter(kw =>
      lower.includes(kw.toLowerCase())
    );

    const shouldForce = matchedKeywords.length > 0;

    if (this.debug && shouldForce) {
      console.log('[UncertaintyDetector] Force web search - matched keywords:', matchedKeywords);
    }

    return {
      shouldForce,
      reason: shouldForce ? 'query contains current-info keywords' : 'no current-info keywords',
      keywords: matchedKeywords
    };
  }

  /**
   * Analyze RESPONSE thinking content to detect uncertainty
   * Called after receiving response
   * @param {string} thinkingContent - The model's thinking/reasoning content
   * @returns {Object} - { confident: boolean, score: number, signals: string[], analysis: string }
   */
  analyzeThinking(thinkingContent) {
    if (!thinkingContent || thinkingContent.trim() === '') {
      return {
        confident: true,
        score: 1.0,
        signals: [],
        analysis: 'no thinking content to analyze'
      };
    }

    const lower = thinkingContent.toLowerCase();

    // Find matching uncertainty signals
    const matchedSignals = this.uncertaintySignals.filter(signal =>
      lower.includes(signal.toLowerCase())
    );

    // Find strong uncertainty signals (weighted more heavily)
    const matchedStrongSignals = this.strongUncertaintySignals.filter(signal =>
      lower.includes(signal.toLowerCase())
    );

    // Calculate confidence score
    // Regular signals reduce by 0.1 each, strong signals by 0.2 each
    const regularPenalty = matchedSignals.length * 0.1;
    const strongPenalty = matchedStrongSignals.length * 0.2;
    const totalPenalty = Math.min(regularPenalty + strongPenalty, 0.9); // Cap at 0.9 reduction

    const score = Math.max(0.1, 1 - totalPenalty);
    const confident = score >= this.threshold;

    // Generate analysis summary
    let analysis = '';
    if (matchedStrongSignals.length > 0) {
      analysis = `Strong uncertainty detected: ${matchedStrongSignals.join(', ')}`;
    } else if (matchedSignals.length > 0) {
      analysis = `Mild uncertainty signals: ${matchedSignals.slice(0, 3).join(', ')}`;
    } else {
      analysis = 'No uncertainty signals detected';
    }

    if (this.debug) {
      console.log('[UncertaintyDetector] Analysis:', {
        score: score.toFixed(2),
        confident,
        regularSignals: matchedSignals.length,
        strongSignals: matchedStrongSignals.length
      });
    }

    return {
      confident,
      score,
      signals: [...matchedStrongSignals, ...matchedSignals],
      strongSignals: matchedStrongSignals,
      analysis
    };
  }

  /**
   * Quick check if thinking shows signs of knowledge cutoff issues
   * @param {string} thinkingContent - The model's thinking content
   * @returns {boolean} - True if knowledge cutoff issues detected
   */
  hasKnowledgeCutoffIssues(thinkingContent) {
    if (!thinkingContent) return false;

    const lower = thinkingContent.toLowerCase();
    const cutoffIndicators = [
      'my knowledge cutoff',
      'training data',
      'don\'t have access to current',
      'cannot browse',
      'no access to real-time',
      'as of my last update'
    ];

    return cutoffIndicators.some(indicator => lower.includes(indicator));
  }

  /**
   * Extract text content from a message (handles both string and array formats)
   * @param {Object} message - The message object
   * @returns {string} - Extracted text content
   */
  extractContent(message) {
    if (!message || !message.content) return '';

    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter(block => block.type === 'text')
        .map(block => block.text || '')
        .join(' ');
    }

    return '';
  }

  /**
   * Set debug mode
   * @param {boolean} enabled - Enable or disable debug logging
   */
  setDebug(enabled) {
    this.debug = enabled;
  }

  /**
   * Update the confidence threshold
   * @param {number} threshold - New threshold value (0-1)
   */
  setThreshold(threshold) {
    if (threshold >= 0 && threshold <= 1) {
      this.threshold = threshold;
    }
  }

  /**
   * Add custom keywords that indicate need for current info
   * @param {string[]} keywords - Array of keywords to add
   */
  addCurrentInfoKeywords(keywords) {
    this.currentInfoKeywords.push(...keywords);
  }

  /**
   * Add custom uncertainty signals
   * @param {string[]} signals - Array of signals to add
   * @param {boolean} strong - If true, add as strong signals
   */
  addUncertaintySignals(signals, strong = false) {
    if (strong) {
      this.strongUncertaintySignals.push(...signals);
    } else {
      this.uncertaintySignals.push(...signals);
    }
  }
}

module.exports = { UncertaintyDetector };
