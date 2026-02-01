// ~/.claude-code-router/plugins/glm47-transformer/hallucination-intervention.js
// Hallucination Intervention Handler for Z.AI GLM Models
// Creates retry requests with forced web search when hallucination is detected

class HallucinationIntervention {
  constructor(options = {}) {
    this.autoIntervene = options.autoIntervene ?? true;
    this.forceWebSearch = options.forceWebSearch ?? true;
    this.debug = options.debug ?? false;
  }

  /**
   * Create an intervention request based on the original request
   * @param {Object} originalRequest - The original Anthropic request
   * @param {Object} analysis - The hallucination analysis result
   * @returns {Object} Modified request with intervention settings
   */
  createInterventionRequest(originalRequest, analysis) {
    const interventionRequest = {
      ...originalRequest,
      messages: [...(originalRequest.messages || [])]
    };

    // Add intervention system message
    const interventionMessage = {
      role: 'system',
      content: `IMPORTANT: You appear uncertain about some facts in your response.
Please use web search to verify current information and provide accurate answers.
Focus on factual accuracy and cite sources when possible.`
    };

    // Insert intervention message at the beginning
    interventionRequest.messages.unshift(interventionMessage);

    // Force tool use for web search
    if (this.forceWebSearch) {
      interventionRequest.tools = [{
        type: 'web_search',
        web_search: {
          search_context_size: 'medium',
          user_location: { type: 'approximate' }
        }
      }];
      interventionRequest.tool_choice = { type: 'any', required: ['web_search'] };
    }

    // Mark as intervention
    interventionRequest._hallucinationIntervention = true;
    interventionRequest._interventionReason = analysis.matches
      .map(m => m.category)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(', ');

    return interventionRequest;
  }

  /**
   * Execute intervention by making a new API request
   * @param {Object} endpoint - The endpoint configuration
   * @param {Object} retryRequest - The retry request
   * @param {Function} fetchFn - Fetch function (for testing)
   * @returns {Response} Streaming response from the intervention
   */
  async executeIntervention(endpoint, retryRequest, fetchFn = null) {
    const fetch = fetchFn || global.fetch;
    const apiUrl = endpoint?.api_base_url;
    const apiKey = endpoint?.api_key;

    if (!apiUrl || !apiKey) {
      throw new Error('HallucinationIntervention: Missing endpoint configuration');
    }

    // Log intervention start
    if (this.debug) {
      console.error('[HALLUCINATION_INTERVENTION] Starting intervention', {
        reason: retryRequest._interventionReason,
        url: apiUrl.replace(apiKey, '***')
      });
    }

    // Make the request
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(retryRequest)
    });

    if (!response.ok) {
      throw new Error(`HallucinationIntervention: API request failed with status ${response.status}`);
    }

    // Mark response as intervention
    response._hallucinationIntervention = true;

    return response;
  }

  /**
   * Create a direct text response for immediate feedback
   * @param {Object} analysis - The hallucination analysis result
   * @param {string} originalQuery - The original user query
   * @returns {string} Intervention message
   */
  createInterventionMessage(analysis, originalQuery = '') {
    const categories = analysis.matches
      .map(m => m.category)
      .filter((v, i, a) => a.indexOf(v) === i);

    let message = 'I detected uncertainty in my initial reasoning. ';
    message += 'Let me search for current information to provide a more accurate answer.';
    message += '\n\nDetected uncertainty patterns: ' + categories.join(', ');

    return message;
  }
}

module.exports = { HallucinationIntervention };
