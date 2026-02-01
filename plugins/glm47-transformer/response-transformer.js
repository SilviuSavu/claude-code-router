// response-transformer.js
// Converts GLM response to OpenAI extended format (with thinking.content)
// The Anthropic endpoint transformer will then convert to final Anthropic format


class ResponseTransformer {
  constructor(thinkingManager, options = {}) {
    this.thinkingManager = thinkingManager;
    this.aliasedModel = options.aliasedModel ?? 'claude-opus-4-5-20250514';
  }

  async transform(response) {
    try {

      if (!response.choices || !response.choices[0]) {
        return response;
      }

      const choice = response.choices[0];
      const message = choice.message;

      // If there's reasoning_content, convert it to thinking format (OpenAI extended)
      if (message.reasoning_content) {

        // Store for later use
        this.thinkingManager.store(
          response.id || 'default',
          message.reasoning_content
        );

        // Convert to OpenAI extended thinking format
        // Generate a simple signature (timestamp-based identifier)
        const signature = `glm47_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        message.thinking = {
          content: message.reasoning_content,
          signature: signature
        };

        // Remove the original reasoning_content field
        delete message.reasoning_content;
      }

      // Alias model name to Claude so Claude Code shows ESC key and other UI features
      response.model = this.aliasedModel;

      return response;

    } catch (error) {
      // Return original response if transformation fails
      return response;
    }
  }
}

module.exports = { ResponseTransformer };
