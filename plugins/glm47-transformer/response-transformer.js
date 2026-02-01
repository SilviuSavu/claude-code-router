// response-transformer.js
// Converts GLM response to OpenAI extended format (with thinking.content)
// The Anthropic endpoint transformer will then convert to final Anthropic format

class ResponseTransformer {
  constructor(thinkingManager) {
    this.thinkingManager = thinkingManager;
  }

  async transform(response) {
    try {
      console.log('[GLM47 ResponseTransformer] Starting transformation');

      if (!response.choices || !response.choices[0]) {
        console.warn('[GLM47] Response has no choices, returning as-is');
        return response;
      }

      const choice = response.choices[0];
      const message = choice.message;

      // If there's reasoning_content, convert it to thinking format (OpenAI extended)
      if (message.reasoning_content) {
        console.log('[GLM47] Found reasoning_content, converting to thinking.content');

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
      response.model = 'claude-opus-4-5-20250514';

      console.log('[GLM47] Transformation complete');
      return response;

    } catch (error) {
      console.error('[GLM47] Transform error:', error);
      // Return original response if transformation fails
      return response;
    }
  }
}

module.exports = { ResponseTransformer };
