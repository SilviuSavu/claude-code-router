// request-transformer.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Debug log file
const DEBUG_LOG = path.join(process.env.HOME, '.claude-code-router', 'debug-web-search.log');

function debugLog(label, data, debugEnabled = false) {
  if (!debugEnabled) return;
  const timestamp = new Date().toISOString();
  const entry = `\n=== ${timestamp} === ${label} ===\n${JSON.stringify(data, null, 2)}\n`;
  fs.appendFileSync(DEBUG_LOG, entry);
}

class RequestTransformer {
  constructor(thinkingManager, options = {}) {
    this.thinkingManager = thinkingManager;
    this.debug = options.debug ?? false;
  }

  async transform(request, options) {
    const transformed = { ...request };

    // Extract conversation ID for thinking preservation
    const conversationId = this.getConversationId(transformed.messages || []);

    // 1. Inject reasoning prompt if forceReasoning enabled
    if (options.forceReasoning) {
      transformed.messages = this.injectReasoningPrompt(transformed.messages);
    }

    // 2. Restore preserved thinking from previous turns
    if (options.preserveThinking) {
      transformed.messages = this.restoreThinkingBlocks(transformed.messages, conversationId);
    }

    // 3. Sanitize any provider_specific_fields from history
    transformed.messages = this.sanitizeMessages(transformed.messages);

    // 4. Add GLM-specific parameters
    transformed.thinking = {
      type: 'enabled',
      clear_thinking: !options.preserveThinking  // false = preserve across turns
    };

    // 5. Ensure do_sample is true (GLM requirement)
    transformed.do_sample = true;

    // 6. Set default temperature to 0.0
    transformed.temperature = 0.0;

    // 7. FIXED: Preserve tools parameter if present
    // GLM-4.7 supports OpenAI-style tools, so pass through unchanged
    if (request.tools) {
      transformed.tools = request.tools;
    }

    // 7. FIXED: Preserve tool_choice if present
    if (request.tool_choice) {
      transformed.tool_choice = request.tool_choice;
    }

    // 8. FIXED: Preserve stream parameter explicitly
    if (request.stream !== undefined) {
      transformed.stream = request.stream;
    }

    // 9. Enable tool_stream for streaming tool call arguments
    // This reduces latency by streaming tool call parameters incrementally
    if (request.stream && request.tools) {
      transformed.tool_stream = true;
    }

    return transformed;
  }

  injectReasoningPrompt(messages) {
    // Find system message
    const systemIdx = messages.findIndex(m => m.role === 'system');

    const reasoningInjection = `
<important_instruction>
Before responding or calling any tool, you MUST think step by step.
Structure your thinking in <think></think> tags.
After thinking, provide your response or tool call.
This is critical for maintaining accuracy.
</important_instruction>
`;

    if (systemIdx >= 0) {
      const systemMsg = messages[systemIdx];
      if (Array.isArray(systemMsg.content)) {
        // Prepend to content array
        systemMsg.content = [
          { type: 'text', text: reasoningInjection },
          ...systemMsg.content
        ];
      } else {
        systemMsg.content = reasoningInjection + '\n\n' + systemMsg.content;
      }
    } else {
      // Insert new system message
      messages.unshift({
        role: 'system',
        content: reasoningInjection
      });
    }

    return messages;
  }

  restoreThinkingBlocks(messages, conversationId) {
    // Get preserved thinking from ThinkingManager for this conversation
    const preservedThinking = this.thinkingManager.get(conversationId);
    const lastThinking = preservedThinking.length > 0 ? preservedThinking[preservedThinking.length - 1] : null;

    // Convert Anthropic thinking blocks back to GLM reasoning_content format
    // This is needed because CCR converts OpenAI → Anthropic on the way in,
    // and we need to convert back to OpenAI for GLM
    return messages.map(msg => {
      if (msg.role !== 'assistant') return msg;

      let reasoning_content = '';

      // Handle content array format (Anthropic/OpenAI)
      if (Array.isArray(msg.content)) {
        // Extract thinking blocks from current message
        const thinkingBlocks = msg.content.filter(block =>
          block.type === 'thinking' && block.thinking
        );

        // First, use preserved thinking from manager if available
        if (lastThinking && thinkingBlocks.length === 0) {
          // No thinking in current message, use preserved
          reasoning_content = lastThinking;
        } else if (thinkingBlocks.length > 0) {
          // Thinking in current message, use it
          reasoning_content = thinkingBlocks
            .map(block => block.thinking)
            .join('\n\n');
        }

        if (reasoning_content) {
          // Get non-thinking content
          const textContent = msg.content
            .filter(block => block.type !== 'thinking')
            .map(block => {
              if (block.type === 'text') return block.text;
              return block; // Keep tool_use, etc. as-is
            })
            .filter(Boolean);

          // Return message with reasoning_content field
          return {
            role: 'assistant',
            content: textContent.length === 1 && typeof textContent[0] === 'string'
              ? textContent[0]  // Single text string
              : textContent,    // Array with tool_use, etc.
            reasoning_content: reasoning_content
          };
        }
      }
      // Handle string content format
      else if (lastThinking && !msg.reasoning_content) {
        // String content with no existing reasoning_content, add preserved thinking
        return {
          role: 'assistant',
          content: msg.content,
          reasoning_content: lastThinking
        };
      }

      return msg;
    });
  }

  sanitizeMessages(messages) {
    return messages.map(msg => {
      if (msg.role !== 'assistant') return msg;

      // Handle content array
      if (Array.isArray(msg.content)) {
        msg.content = msg.content.map(block => {
          if (block.type === 'tool_use' && block.provider_specific_fields) {
            const { provider_specific_fields, ...clean } = block;
            return clean;
          }
          return block;
        });
      }

      return msg;
    });
  }

  getConversationId(messages) {
    // Try to extract conversation ID from request
    // If not found, generate a stable ID from first user message
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length > 0) {
      const firstMsg = userMessages[0];
      let content = '';
      if (typeof firstMsg.content === 'string') {
        content = firstMsg.content;
      } else if (Array.isArray(firstMsg.content)) {
        content = firstMsg.content
          .filter(block => block.type === 'text')
          .map(block => block.text || '')
          .join(' ');
      }
      if (content) {
        return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
      }
    }
    return 'default';
  }

}

module.exports = { RequestTransformer };
