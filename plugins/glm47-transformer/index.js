// ~/.claude-code-router/plugins/glm47-transformer/index.js

const { RequestTransformer } = require('./request-transformer.js');
const { ResponseTransformer } = require('./response-transformer.js');
const { ThinkingManager } = require('./thinking-manager.js');
const fs = require('fs');
const path = require('path');

// Debug log file (same as request-transformer)
const DEBUG_LOG = path.join(process.env.HOME, '.claude-code-router', 'debug-web-search.log');

let globalDebugEnabled = false;

function setDebugEnabled(enabled) {
  globalDebugEnabled = enabled;
}

function debugLog(label, data, enabled = globalDebugEnabled) {
  if (!enabled) return;
  const timestamp = new Date().toISOString();
  const entry = `\n=== ${timestamp} === ${label} ===\n${JSON.stringify(data, null, 2)}\n`;
  fs.appendFileSync(DEBUG_LOG, entry);
}

class GLM47Transformer {
  constructor(options = {}) {
    this.name = 'GLM47';
    // No endPoint - provider transformer only
    this.thinkingManager = new ThinkingManager();

    // Options
    this.preserveThinking = options.preserveThinking ?? true;
    this.forceReasoning = options.forceReasoning ?? true;
    this.aliasedModel = options.aliasedModel ?? 'claude-opus-4-5-20250514';  // Model name to alias to for UI features
    this.debug = options.debug ?? false;

    // Set global debug flag for debugLog function
    setDebugEnabled(this.debug);

    // Initialize transformers with options
    this.requestTransformer = new RequestTransformer(this.thinkingManager, {
      debug: this.debug
    });
    this.responseTransformer = new ResponseTransformer(this.thinkingManager, {
      aliasedModel: this.aliasedModel
    });
  }

  // Called to convert incoming Anthropic request to unified format
  async transformRequestOut(request, context) {
    // For /v1/messages endpoint, the incoming request is already in Anthropic format
    // Just return it as unified format (Anthropic format IS the unified format here)
    return request;
  }

  // Called before sending request to GLM
  async transformRequestIn(request) {
    return this.requestTransformer.transform(request, {
      preserveThinking: this.preserveThinking,
      forceReasoning: this.forceReasoning
    });
  }

  // Called to process raw HTTP Response from GLM
  // Called for provider transformers to transform response before endpoint transformer
  async transformResponseOut(response, context) {
    try {
      const contentType = response.headers?.get?.("Content-Type") || "";
      const isStream = contentType.includes("text/event-stream");

      if (isStream) {
        return this.transformStreamingResponse(response, context);
      }

      // For non-streaming, read JSON and convert reasoning_content → thinking.content
      const data = await response.json();

      // DEBUG: Log non-streaming response with web_search
      if (data.web_search) {
        debugLog('NON_STREAMING_RESPONSE_WITH_WEB_SEARCH', {
          webSearchCount: data.web_search.length,
          webSearchSample: data.web_search[0],
          hasChoices: !!data.choices,
          messageContent: data.choices?.[0]?.message?.content?.substring(0, 200)
        });
      }

      const converted = await this.responseTransformer.transform(data);

      // Preserve web_search results in converted response
      if (data.web_search) {
        converted.web_search = data.web_search;
      }

      // Return Response with OpenAI extended thinking format
      return new Response(JSON.stringify(converted), {
        headers: { "Content-Type": "application/json" },
        status: response.status,
        statusText: response.statusText
      });
    } catch (error) {
      return response;
    }
  }

  async transformStreamingResponse(response, context) {
    if (!response.body) {
      return response;
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let thinkingBuffer = '';
    let isThinkingComplete = false;
    const thinkingSignature = `glm47_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Capture self for uncertainty analysis in callback
    const self = this;

    let firstChunkLogged = false;

    const transformedStream = new ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim() || !line.startsWith('data: ')) continue;

              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                // Mark thinking as complete (signature handling may need adjustment)
                isThinkingComplete = true;
                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                continue;
              }

              try {
                const chunk = JSON.parse(data);

                // DEBUG: Log first chunk structure
                if (!firstChunkLogged) {
                  firstChunkLogged = true;
                }

                // Add null check for choices
                if (!chunk.choices || chunk.choices.length === 0) {
                  continue;
                }

                const choice0 = chunk.choices[0];

                // Monitor reasoning_content (CCR converts it to thinking.content AFTER this transformer)
                if (choice0.delta?.reasoning_content) {
                  const reasoning = choice0.delta.reasoning_content;
                  thinkingBuffer += reasoning;

                  // Create new chunk with thinking instead of reasoning_content
                  const transformedChunk = {
                    ...chunk,
                    model: self.aliasedModel, // Alias for Claude Code UI features
                    choices: [{
                      ...choice0,
                      delta: {
                        ...choice0.delta,
                        thinking: {
                          content: reasoning
                        }
                      }
                    }]
                  };

                  // Remove reasoning_content
                  delete transformedChunk.choices[0].delta.reasoning_content;

                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(transformedChunk)}\n\n`));
                }
                // Check if thinking is complete (when we get content after reasoning)
                else if (choice0.delta?.content && thinkingBuffer && !isThinkingComplete) {
                  // Mark thinking as complete, then send content with aliased model
                  isThinkingComplete = true;
                  chunk.model = self.aliasedModel;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
                else {
                  // Pass through with aliased model
                  chunk.model = self.aliasedModel;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
              } catch (e) {
                // Invalid JSON, pass through
                controller.enqueue(encoder.encode(`${line}\n`));
              }
            }
          }

          // Process remaining buffer
          if (buffer.trim()) {
            controller.enqueue(encoder.encode(`${buffer}\n`));
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      }
    });

    return new Response(transformedStream, {
      status: response.status,
      statusText: response.statusText,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      }
    });
  }

  // NOTE: transformStreamChunk and transformStreamEnd are not used
  // Streaming is handled inline in transformStreamingResponse()
  // These methods are kept for potential future router API changes

}

module.exports = GLM47Transformer;
