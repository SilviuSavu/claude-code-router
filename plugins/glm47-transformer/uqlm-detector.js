// uqlm-detector.js
// Real-time Uncertainty-Quantified LLM detector with regex-based word salad detection
// Based on research: LLMs exhibit measurable confusion patterns before hallucinating

class UQLMDetector {
  constructor(options = {}) {
    this.confusionThreshold = options.confusionThreshold || 2; // How many signals trigger intervention
    this.debug = options.debug || false;
    this.bufferSize = options.bufferSize || 200; // Analyze last N chars of thinking

    // REGEX PATTERNS - Based on UQLM research papers
    // These patterns indicate the model is confused and about to hallucinate

    // Pattern 1: Explicit Uncertainty (STRONG signal)
    this.uncertaintyPatterns = [
      /i'?m?\s+not\s+(sure|certain|confident)/i,
      /i\s+don'?t\s+(know|have\s+access|have\s+information)/i,
      /i\s+can'?t\s+(confirm|verify|access|be\s+sure)/i,
      /unable\s+to\s+(verify|confirm|access)/i,
      /uncertain\s+(about|whether|if)/i,
      /not\s+confident\s+(that|about|in)/i,
    ];

    // Pattern 2: Hedging Language (MEDIUM signal)
    this.hedgingPatterns = [
      /i\s+(think|believe|guess|assume|suspect)/i,
      /(might|may|could|possibly|perhaps|probably)\s+be/i,
      /it\s+(seems|appears|looks)\s+like/i,
      /if\s+i\s+(recall|remember)\s+correctly/i,
      /as\s+far\s+as\s+i\s+know/i,
    ];

    // Pattern 3: Knowledge Cutoff Issues (STRONG signal)
    this.cutoffPatterns = [
      /my\s+(knowledge|training)\s+(cutoff|data|ends?)/i,
      /as\s+of\s+my\s+(last\s+update|knowledge)/i,
      /i\s+don'?t\s+have\s+access\s+to\s+(current|recent|real-time|latest)/i,
      /my\s+information\s+(is\s+from|ends?\s+at|stops?\s+at)/i,
      /(training|knowledge)\s+data\s+(is\s+from|ends?\s+in)/i,
    ];

    // Pattern 4: Contradictory Reasoning (MEDIUM signal)
    this.contradictionPatterns = [
      /(but|however|although|though).{0,50}(but|however|although)/i, // Double contradictions
      /on\s+the\s+other\s+hand.{0,50}but/i,
      /actually.{0,30}wait.{0,30}(no|actually)/i,
      /i\s+said.{0,50}(but|however|actually)/i,
    ];

    // Pattern 5: Word Salad / Confused Rambling (STRONG signal)
    this.wordSaladPatterns = [
      /\b(\w+)\s+\1\s+\1\b/i, // Word repeated 3+ times
      /(um+|uh+|er+|hmm+)/i, // Filler words
      /\.{3,}/g, // Excessive ellipsis (thinking too hard)
      /\?\s*\?\s*\?/g, // Multiple question marks (confusion)
      /\b(or|and|but)\b\s+\1\s+\1/i, // Repeated conjunctions
    ];

    // Pattern 6: Temporal Confusion (MEDIUM signal)
    this.temporalConfusionPatterns = [
      /(was|used\s+to\s+be)\s+.{0,30}(now|currently|today)/i,
      /at\s+that\s+time.{0,30}(now|currently)/i,
      /(previously|before).{0,30}(but\s+now|currently)/i,
      /may\s+have\s+changed\s+since/i,
    ];

    // Combine all patterns with weights
    this.patternWeights = {
      uncertainty: 3,      // Strongest signal
      cutoff: 3,          // Strongest signal
      wordSalad: 3,       // Strongest signal
      contradiction: 2,    // Medium signal
      temporal: 2,        // Medium signal
      hedging: 1,         // Weakest signal (alone not enough)
    };
  }

  /**
   * Analyze a chunk of thinking content in real-time
   * Returns immediately if confusion detected
   * @param {string} thinkingChunk - Latest chunk of thinking content
   * @param {string} fullThinkingBuffer - Complete thinking so far
   * @returns {Object} - { confused: boolean, score: number, patterns: [], shouldIntervene: boolean }
   */
  analyzeChunk(thinkingChunk, fullThinkingBuffer = '') {
    // Analyze the recent context (last N characters)
    const recentContext = fullThinkingBuffer.slice(-this.bufferSize);
    const combinedText = recentContext + thinkingChunk;

    const detectedPatterns = [];
    let confusionScore = 0;

    // Check each pattern category
    const checks = [
      { name: 'uncertainty', patterns: this.uncertaintyPatterns, weight: this.patternWeights.uncertainty },
      { name: 'cutoff', patterns: this.cutoffPatterns, weight: this.patternWeights.cutoff },
      { name: 'wordSalad', patterns: this.wordSaladPatterns, weight: this.patternWeights.wordSalad },
      { name: 'contradiction', patterns: this.contradictionPatterns, weight: this.patternWeights.contradiction },
      { name: 'temporal', patterns: this.temporalConfusionPatterns, weight: this.patternWeights.temporal },
      { name: 'hedging', patterns: this.hedgingPatterns, weight: this.patternWeights.hedging },
    ];

    for (const check of checks) {
      for (const pattern of check.patterns) {
        const match = combinedText.match(pattern);
        if (match) {
          confusionScore += check.weight;
          detectedPatterns.push({
            type: check.name,
            pattern: pattern.source,
            match: match[0],
            weight: check.weight,
          });

          if (this.debug) {
            console.log(`[UQLM] 🚨 ${check.name.toUpperCase()}: "${match[0]}"`);
          }
        }
      }
    }

    const confused = confusionScore >= this.confusionThreshold;
    const shouldIntervene = confused && this.hasStrongSignals(detectedPatterns);

    if (this.debug && confused) {
      console.log(`[UQLM] Confusion score: ${confusionScore} (threshold: ${this.confusionThreshold})`);
      console.log(`[UQLM] Patterns detected: ${detectedPatterns.map(p => p.type).join(', ')}`);
    }

    return {
      confused,
      score: confusionScore,
      patterns: detectedPatterns,
      shouldIntervene,
      reason: this.generateReason(detectedPatterns),
    };
  }

  /**
   * Check if strong signals (cutoff, uncertainty, word salad) are present
   * These alone are enough to trigger intervention
   */
  hasStrongSignals(patterns) {
    return patterns.some(p =>
      p.type === 'uncertainty' ||
      p.type === 'cutoff' ||
      p.type === 'wordSalad'
    );
  }

  /**
   * Generate human-readable reason for intervention
   */
  generateReason(patterns) {
    if (patterns.length === 0) return 'No confusion detected';

    const types = [...new Set(patterns.map(p => p.type))];
    const samples = patterns.slice(0, 2).map(p => p.match);

    return `Confusion detected: ${types.join(', ')}. Examples: "${samples.join('", "')}"`;
  }

  /**
   * Analyze complete thinking (for post-response analysis)
   * @param {string} thinkingContent - Complete thinking content
   * @returns {Object} - Detailed analysis
   */
  analyzeComplete(thinkingContent) {
    const result = this.analyzeChunk(thinkingContent, '');

    // Additional metrics for complete analysis
    const wordCount = thinkingContent.split(/\s+/).length;
    const avgConfusionDensity = result.score / Math.max(wordCount / 100, 1);

    return {
      ...result,
      wordCount,
      confusionDensity: avgConfusionDensity,
      recommendation: this.getRecommendation(result),
    };
  }

  /**
   * Get recommendation based on analysis
   */
  getRecommendation(analysis) {
    if (!analysis.confused) {
      return 'Response appears confident';
    }

    if (this.hasStrongSignals(analysis.patterns)) {
      return 'URGENT: Force web search immediately - strong hallucination risk';
    }

    if (analysis.score >= this.confusionThreshold * 2) {
      return 'RECOMMENDED: Trigger web search - high confusion detected';
    }

    return 'MONITOR: Watch for additional confusion signals';
  }

  /**
   * Set debug mode
   */
  setDebug(enabled) {
    this.debug = enabled;
  }

  /**
   * Update confusion threshold
   */
  setThreshold(threshold) {
    this.confusionThreshold = threshold;
  }

  /**
   * Add custom pattern
   */
  addPattern(category, pattern, weight = 1) {
    const categoryMap = {
      uncertainty: this.uncertaintyPatterns,
      hedging: this.hedgingPatterns,
      cutoff: this.cutoffPatterns,
      contradiction: this.contradictionPatterns,
      wordSalad: this.wordSaladPatterns,
      temporal: this.temporalConfusionPatterns,
    };

    if (categoryMap[category]) {
      categoryMap[category].push(new RegExp(pattern, 'i'));
      this.patternWeights[category] = weight;
    }
  }
}

module.exports = { UQLMDetector };
