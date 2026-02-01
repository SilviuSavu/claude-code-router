// uqlm-intervention.js
// Real-time intervention mechanism for UQLM-based hallucination prevention
// Monitors thinking stream → Detects confusion → Interrupts → Forces web search → Retries

const { UQLMDetector } = require('./uqlm-detector');

class UQLMInterventionHandler {
  constructor(options = {}) {
    this.uqlmDetector = new UQLMDetector({
      confusionThreshold: options.confusionThreshold || 2,
      debug: options.debug || false,
      bufferSize: options.bufferSize || 200,
    });

    this.enabled = options.enabled !== false; // Default: enabled
    this.maxRetries = options.maxRetries || 1; // Prevent infinite loops
    this.debug = options.debug || false;

    // State tracking
    this.interventionCount = 0;
    this.lastIntervention = null;
  }

  /**
   * Monitor thinking stream in real-time
   * Called for each chunk of thinking content as it arrives
   *
   * @param {string} chunk - New thinking chunk
   * @param {string} buffer - Full thinking buffer so far
   * @param {Object} context - Request context (for retry)
   * @returns {Object} - { shouldIntervene: boolean, analysis: {...}, action: 'continue'|'interrupt' }
   */
  monitorThinking(chunk, buffer, context = {}) {
    if (!this.enabled) {
      return { shouldIntervene: false, action: 'continue' };
    }

    // Analyze this chunk in context of what we've seen so far
    const analysis = this.uqlmDetector.analyzeChunk(chunk, buffer);

    if (analysis.shouldIntervene) {
      console.log('[UQLM] 🚨 INTERVENTION TRIGGERED!');
      console.log(`[UQLM] Reason: ${analysis.reason}`);
      console.log(`[UQLM] Confusion score: ${analysis.score}`);
      console.log(`[UQLM] Detected patterns:`, analysis.patterns.map(p => ({
        type: p.type,
        match: p.match,
      })));

      // Check if we've already retried too many times
      if (context.retryCount >= this.maxRetries) {
        console.log('[UQLM] ⚠️ Max retries reached, allowing response to complete');
        return { shouldIntervene: false, action: 'continue', analysis };
      }

      this.interventionCount++;
      this.lastIntervention = {
        timestamp: new Date().toISOString(),
        analysis,
        context,
      };

      return {
        shouldIntervene: true,
        action: 'interrupt',
        analysis,
        nextAction: 'force_web_search',
      };
    }

    return {
      shouldIntervene: false,
      action: 'continue',
      analysis,
    };
  }

  /**
   * Create intervention request (force web search and retry)
   * Called when intervention is triggered
   *
   * @param {Object} originalRequest - The original request that triggered confusion
   * @param {Object} analysis - UQLM analysis results
   * @returns {Object} - Modified request with forced web search
   */
  createInterventionRequest(originalRequest, analysis) {
    console.log('[UQLM] 🔧 Creating intervention request with forced web search');

    const interventionRequest = JSON.parse(JSON.stringify(originalRequest));

    // Find MCP web search tool
    const mcpWebSearchTool = (interventionRequest.tools || []).find(t =>
      t.type === 'function' &&
      t.function?.name === 'mcp__web-search-prime__webSearchPrime'
    );

    if (mcpWebSearchTool) {
      // Force web search tool
      interventionRequest.tool_choice = {
        type: "function",
        function: { name: "mcp__web-search-prime__webSearchPrime" }
      };

      console.log('[UQLM] ✅ Forced MCP web search tool');
    } else {
      console.log('[UQLM] ⚠️ MCP web search tool not found - cannot intervene');
      return null;
    }

    // Inject system message explaining the intervention
    const interventionHint = `
<uqlm_intervention>
Previous response showed confusion patterns: ${analysis.reason}
You MUST use web search to get accurate, current information.
Do not rely on training data for this query.
</uqlm_intervention>`;

    // Find system message or create one
    const systemMsgIndex = interventionRequest.messages.findIndex(m => m.role === 'system');
    if (systemMsgIndex >= 0) {
      const systemMsg = interventionRequest.messages[systemMsgIndex];
      if (typeof systemMsg.content === 'string') {
        systemMsg.content = interventionHint + '\n\n' + systemMsg.content;
      } else if (Array.isArray(systemMsg.content)) {
        systemMsg.content.unshift({ type: 'text', text: interventionHint });
      }
    } else {
      interventionRequest.messages.unshift({
        role: 'system',
        content: interventionHint,
      });
    }

    // Track retry count
    if (!interventionRequest._uqlm) {
      interventionRequest._uqlm = {};
    }
    interventionRequest._uqlm.retryCount = (interventionRequest._uqlm.retryCount || 0) + 1;
    interventionRequest._uqlm.interventionReason = analysis.reason;
    interventionRequest._uqlm.confusionScore = analysis.score;

    return interventionRequest;
  }

  /**
   * Get intervention statistics
   */
  getStats() {
    return {
      interventionCount: this.interventionCount,
      lastIntervention: this.lastIntervention,
      enabled: this.enabled,
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.interventionCount = 0;
    this.lastIntervention = null;
  }

  /**
   * Enable/disable intervention
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[UQLM] Intervention ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get the detector for external use
   */
  getDetector() {
    return this.uqlmDetector;
  }
}

module.exports = { UQLMInterventionHandler };
