// response-transformer.js
// Converts GLM response to OpenAI extended format (with thinking.content)
// The Anthropic endpoint transformer will then convert to final Anthropic format

import crypto from 'crypto';

export class ResponseTransformer {
  constructor(thinkingManager, options = {}) {
    this.thinkingManager = thinkingManager;
    this.aliasedModel = options.aliasedModel ?? 'claude-opus-4-5-20250514';
    this.signatureVersion = options.signatureVersion ?? 2;
  }

  generateSignature(thinkingContent, messageId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');

    const payload = {
      v: this.signatureVersion,
      ts: timestamp,
      id: messageId || 'unknown',
      r: random,
      c: crypto.createHash('sha256').update(thinkingContent).digest('hex').substring(0, 32)
    };

    const secret = 'glm47-signature-v2';
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));

    const signature = `glm47_v2_${timestamp}_${random.substring(0, 16)}_${hmac.digest('hex').substring(0, 32)}`;

    return {
      version: this.signatureVersion,
      value: signature,
      payload
    };
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

        const signatureData = this.generateSignature(message.reasoning_content, response.id);

        // Convert to OpenAI extended thinking format with enhanced signature
        message.thinking = {
          content: message.reasoning_content,
          signature: signatureData.value
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
