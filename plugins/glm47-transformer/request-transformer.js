// request-transformer.js
console.log('[GLM47] ★★★ request-transformer.js LOADED at', new Date().toISOString(), '★★★');

const { UncertaintyDetector } = require('./uncertainty-detector');
const fs = require('fs');
const path = require('path');

// Debug log file
const DEBUG_LOG = path.join(process.env.HOME, '.claude-code-router', 'debug-web-search.log');

function debugLog(label, data) {
  const timestamp = new Date().toISOString();
  const entry = `\n=== ${timestamp} === ${label} ===\n${JSON.stringify(data, null, 2)}\n`;
  fs.appendFileSync(DEBUG_LOG, entry);
}

class RequestTransformer {
  constructor(thinkingManager, options = {}) {
    this.thinkingManager = thinkingManager;
    this.uncertaintyDetector = new UncertaintyDetector({
      threshold: options.uncertaintyThreshold || 0.7,
      debug: options.debug || false
    });
  }

  async transform(request, options) {
    const transformed = { ...request };

    // 1. Inject reasoning prompt if forceReasoning enabled
    if (options.forceReasoning) {
      transformed.messages = this.injectReasoningPrompt(transformed.messages);
    }

    // 2. Restore preserved thinking from previous turns
    if (options.preserveThinking) {
      transformed.messages = this.restoreThinkingBlocks(transformed.messages);
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
      console.log('[GLM47] Tools parameter preserved:', request.tools.length, 'tools');
    }

    // 7. FIXED: Preserve tool_choice if present
    if (request.tool_choice) {
      transformed.tool_choice = request.tool_choice;
      console.log('[GLM47] Tool choice preserved:', request.tool_choice);
    }

    // 8. FIXED: Preserve stream parameter explicitly
    if (request.stream !== undefined) {
      transformed.stream = request.stream;
      console.log('[GLM47] Stream parameter preserved:', request.stream);
    }

    // 9. Enable tool_stream for streaming tool call arguments
    // This reduces latency by streaming tool call parameters incrementally
    if (request.stream && request.tools) {
      transformed.tool_stream = true;
      console.log('[GLM47] Tool stream enabled for lower latency');
    }

    // 10. Handle web search when enabled
    // Z.AI's "Web Search in Chat" is a TOOL with type: "web_search"
    // See: https://docs.z.ai/guides/tools/web-search
    if (options.webSearch) {
      // ALWAYS remove ALL web-related tools to prevent conflict
      // The model will use Z.AI's web_search instead
      if (transformed.tools && transformed.tools.length > 0) {
        const beforeCount = transformed.tools.length;
        transformed.tools = transformed.tools.filter(t => {
          if (t.type === 'function') {
            const name = t.function?.name || '';
            const nameLower = name.toLowerCase();

            // PRESERVE all MCP tools (they start with mcp__)
            if (name.startsWith('mcp__')) {
              console.log('[GLM47] Preserving MCP tool:', name);
              return true;
            }

            // Remove built-in Claude Code web tools (but NOT MCP versions)
            if (nameLower.includes('websearch') || nameLower.includes('web_search') ||
                nameLower.includes('webfetch') || nameLower.includes('web_fetch') ||
                nameLower.includes('webreader') || nameLower.includes('web_reader') ||
                nameLower === 'search' || nameLower === 'webreader') {
              console.log('[GLM47] Removing built-in web tool:', name);
              return false;
            }
          }
          return true;
        });
        const removedCount = beforeCount - transformed.tools.length;
        if (removedCount > 0) {
          console.log('[GLM47] Removed', removedCount, 'web-related tools from request');
        }
      }

      // Inject Z.AI web_search tool when uncertainty detected
      const searchAnalysis = this.uncertaintyDetector.shouldForceWebSearch(request);

      if (searchAnalysis.shouldForce) {
        console.log('[GLM47] Web search tool INJECTED - query needs current info');
        console.log('[GLM47] Matched keywords:', searchAnalysis.keywords.join(', '));

        // Extract user's actual query for the search
        const userQuery = this.extractUserQuery(request.messages);
        console.log('[GLM47] User query for search:', userQuery);

        // Inject Z.AI's native web_search tool into the tools array
        transformed.tools = this.injectWebSearchTool(transformed.tools || [], searchAnalysis.keywords, userQuery);

        // CRITICAL: Force web_search tool to be used
        // Setting to "required" forces the model to use a tool
        transformed.tool_choice = "required";
        console.log('[GLM47] Set tool_choice to "required" to force web search usage');

        // Also inject a hint into the system message
        transformed.messages = this.injectWebSearchHint(transformed.messages, searchAnalysis.keywords);

        // OPTIONAL: Switch to alternative model for web search
        // Note: glm-4.7 is "optimized agentic coding" per Z.AI docs, may not need this
        // Available alternatives: glm-4.5-air (lightweight), glm-4.6 (strong coding)
        if (options.useAlternativeModelForWebSearch && options.alternativeModel) {
          transformed.model = options.alternativeModel;  // e.g., 'glm-4.5-air' or 'glm-4.6'
          console.log('[GLM47] Switched to', options.alternativeModel, 'for web search');
        }

        // Disable streaming for web search requests
        // This allows the model to see all search results before responding
        if (transformed.stream) {
          console.log('[GLM47] Disabling streaming for web search request');
          transformed.stream = false;
          transformed._webSearchDisabledStreaming = true;  // Flag for response handler
        }

        // DEBUG: Log the injected tools
        debugLog('TOOLS_AFTER_INJECTION', {
          toolCount: transformed.tools.length,
          toolTypes: transformed.tools.map(t => t.type || (t.function?.name ? `function:${t.function.name}` : 'unknown')),
          webSearchTool: transformed.tools.find(t => t.type === 'web_search'),
          userQuery: userQuery,
          streamingDisabled: !!transformed._webSearchDisabledStreaming
        });
      } else if (options.debug) {
        console.log('[GLM47] No current-info keywords detected, skipping web search injection');
      }
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

  restoreThinkingBlocks(messages) {
    // Convert Anthropic thinking blocks back to GLM reasoning_content format
    // This is needed because CCR converts OpenAI → Anthropic on the way in,
    // and we need to convert back to OpenAI for GLM
    return messages.map(msg => {
      if (msg.role !== 'assistant') return msg;

      // Handle content array format (Anthropic/OpenAI)
      if (Array.isArray(msg.content)) {
        // Extract thinking blocks
        const thinkingBlocks = msg.content.filter(block =>
          block.type === 'thinking' && block.thinking
        );

        if (thinkingBlocks.length > 0) {
          // Combine all thinking content
          const reasoning_content = thinkingBlocks
            .map(block => block.thinking)
            .join('\n\n');

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

  getConversationId() {
    // Extract from request context - implementation specific
    return 'default';
  }

  extractUserQuery(messages) {
    // DEBUG: Log ALL messages first to understand structure
    console.log('[GLM47] === ALL MESSAGES (', messages.length, 'total) ===');
    messages.forEach((msg, i) => {
      const preview = typeof msg.content === 'string'
        ? msg.content.substring(0, 100)
        : JSON.stringify(msg.content).substring(0, 100);
      console.log(`[GLM47] Msg ${i} [${msg.role}]:`, preview);
    });

    // Get user messages, filtering out system-like messages
    const userMessages = messages.filter(m => m.role === 'user');

    console.log('[GLM47] extractUserQuery found', userMessages.length, 'user messages');

    // Patterns to skip (these are likely system prompts, not user questions)
    const skipPatterns = [
      /\[SUGGESTION MODE/i,  // Removed ^ to match anywhere
      /\[SYSTEM/i,
      /<system-reminder>/i,
      /session ground rules/i,
      /SessionStart/i,
      /web page content:/i,
      /You are /i,
      /Your job is /i,
      /mindset for this session/i
    ];

    // Find the last REAL user message (not a system-like prompt)
    for (let i = userMessages.length - 1; i >= 0; i--) {
      const msg = userMessages[i];

      // Extract text content
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter(block => block.type === 'text')
          .map(block => block.text || '')
          .join(' ');
      }

      // Skip if matches system-like patterns
      const isSystemLike = skipPatterns.some(pattern => pattern.test(content));
      console.log('[GLM47] Testing content (first 100 chars):', content.substring(0, 100));
      console.log('[GLM47] Is system-like?', isSystemLike);
      console.log('[GLM47] Content length:', content.length, 'Trimmed length:', content.trim().length);
      if (isSystemLike) {
        console.log('[GLM47] SKIPPING this message (matched system pattern)');
        continue;
      }

      // This looks like a real user question
      const trimmedContent = content.trim();
      if (trimmedContent) {
        console.log('[GLM47] FOUND real user message, returning it');
        return trimmedContent;
      } else {
        console.log('[GLM47] WARNING: Content was empty after trim!');
      }
    }

    // If we got here, ALL user messages were filtered out as system-like
    // Return empty string instead of falling back to a filtered message
    console.log('[GLM47] All user messages were system-like, returning empty query');
    return '';
  }

  injectWebSearchTool(tools, keywords, userQuery) {
    // Z.AI Web Search in Chat tool format (official format from Z.AI docs)
    // See: https://docs.z.ai/guides/tools/web-search
    const webSearchTool = {
      type: 'web_search',
      web_search: {
        enable: 'True',
        search_engine: 'search-std',  // search-std or search-prime
        search_result: 'True',
        search_query: userQuery || keywords.join(' '),
        search_prompt: 'Answer the user\'s question using these search results. Cite sources as [Source: ref_N].',
        count: '10',  // Number of results (1-50)
        search_recency_filter: 'noLimit',  // oneDay, oneWeek, oneMonth, oneYear, noLimit
        content_size: 'high'  // Amount of content in results
      }
    };

    // Check if web_search tool already exists
    const hasWebSearch = tools.some(t => t.type === 'web_search');
    if (hasWebSearch) {
      console.log('[GLM47] Web search tool already present, skipping injection');
      return tools;
    }

    // Prepend web_search tool so it's prioritized
    // Note: WebSearch filtering is now done at a higher level for ALL requests
    console.log('[GLM47] Injected Z.AI web_search tool with search-std engine (Lite tier)');
    return [webSearchTool, ...tools];
  }

  injectWebSearchHint(messages, keywords) {
    // Find system message
    const systemIdx = messages.findIndex(m => m.role === 'system');

    const webSearchHint = `
<web_search_priority>
This query requires CURRENT information (detected keywords: ${keywords.join(', ')}).
Today's date: ${new Date().toISOString().split('T')[0]}

IMPORTANT: Web search results will be provided automatically - do NOT call any WebSearch tool.
The search results are already available. Use them to provide accurate, up-to-date information
with proper citations [Source: ref_N].

If no search results appear, use WebFetch to check official documentation directly:
- For Node.js: https://nodejs.org/
- For React: https://react.dev/
- For other tools: their official websites

Do NOT rely on training data for recent versions, releases, or current state of libraries.
</web_search_priority>
`;

    if (systemIdx >= 0) {
      const systemMsg = messages[systemIdx];
      if (Array.isArray(systemMsg.content)) {
        // Append to content array
        systemMsg.content = [
          ...systemMsg.content,
          { type: 'text', text: webSearchHint }
        ];
      } else {
        systemMsg.content = systemMsg.content + '\n\n' + webSearchHint;
      }
    } else {
      // Insert new system message
      messages.unshift({
        role: 'system',
        content: webSearchHint
      });
    }

    return messages;
  }

  // Expose uncertainty detector for external use
  getUncertaintyDetector() {
    return this.uncertaintyDetector;
  }
}

module.exports = { RequestTransformer };
