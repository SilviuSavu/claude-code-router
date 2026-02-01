// ~/.claude-code-router/plugins/glm47-transformer/index.js

const { RequestTransformer } = require('./request-transformer.js');
const { ResponseTransformer } = require('./response-transformer.js');
const { ThinkingManager } = require('./thinking-manager.js');
const { TokenOptimizer } = require('./token-optimizer.js');
const { MultiSessionManager } = require('./multi-session-manager.js');
const { HallucinationDetector } = require('./hallucination-detector.js');
const { HallucinationIntervention } = require('./hallucination-intervention.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Debug log file (same as request-transformer)
const DEBUG_LOG = path.join(process.env.HOME, '.claude-code-router', 'debug-web-search.log');
// Hallucination stats file for status line
const HALLUCINATION_STATS_FILE = path.join(process.env.HOME, '.claude-code-router', 'hallucination-stats.json');

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

// Hallucination stats tracking (persistent)
let hallucinationStats = {
  checks: 0,
  detections: 0,
  interventions: 0,
  totalScore: 0,
  maxScore: 0,
  patterns: {}
};

function loadHallucinationStats() {
  try {
    if (fs.existsSync(HALLUCINATION_STATS_FILE)) {
      const data = fs.readFileSync(HALLUCINATION_STATS_FILE, 'utf8');
      const parsed = JSON.parse(data);
      hallucinationStats = { ...hallucinationStats, ...parsed };
    }
  } catch (e) {
    // Start fresh on error
  }
  return hallucinationStats;
}

function saveHallucinationStats() {
  try {
    fs.writeFileSync(HALLUCINATION_STATS_FILE, JSON.stringify(hallucinationStats, null, 2));
  } catch (e) {
    // Ignore save errors
  }
}

function updateHallucinationStats(analysis) {
  hallucinationStats.checks++;
  if (analysis.detected) {
    hallucinationStats.detections++;
  }
  if (analysis.shouldIntervene) {
    hallucinationStats.interventions++;
  }
  if (analysis.score > 0) {
    hallucinationStats.totalScore += analysis.score;
    if (analysis.score > hallucinationStats.maxScore) {
      hallucinationStats.maxScore = analysis.score;
    }
  }
  // Track patterns
  for (const pattern of analysis.patterns) {
    hallucinationStats.patterns[pattern] = (hallucinationStats.patterns[pattern] || 0) + 1;
  }
  saveHallucinationStats();
  return hallucinationStats;
}

function getHallucinationStatsFormatted() {
  const stats = loadHallucinationStats();
  const avgScore = stats.checks > 0 ? (stats.totalScore / stats.checks).toFixed(1) : '0';
  return {
    checks: stats.checks,
    detections: stats.detections,
    interventions: stats.interventions,
    avgScore,
    maxScore: stats.maxScore
  };
}

// Status line for hallucination monitoring
// Uses stdout so it's more visible, writes to log file for persistence
function statusLine(message, enabled = globalDebugEnabled) {
  if (!enabled) return;
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0]; // HH:MM:SS
  const output = `[HALLUCINATION ${timestamp}] ${message}\n`;

  // Write to stdout (more likely to be visible)
  process.stdout.write(output);

  // Also append to debug log for persistent history
  fs.appendFileSync(DEBUG_LOG, output);
}

class GLM47Transformer {
  constructor(options = {}) {
    this.name = 'GLM47';
    // No endPoint - provider transformer only

    // Options
    this.preserveThinking = options.preserveThinking ?? true;
    this.forceReasoning = options.forceReasoning ?? true;
    this.aliasedModel = options.aliasedModel ?? 'claude-opus-4-5-20250514';  // Model name to alias to for UI features
    this.debug = options.debug ?? false;

    // Set global debug flag for debugLog function
    setDebugEnabled(this.debug);

    // Token optimization options
    this.optimizeTokens = options.optimizeTokens ?? true;
    this.aggressiveOptimization = options.aggressiveOptimization ?? false;
    this.maxHistoryTurns = options.maxHistoryTurns ?? 15;

    // Multi-session options
    this.enableMultiSession = options.enableMultiSession ?? true;
    this.maxSessions = options.maxSessions ?? 10;
    this.maxSessionAge = options.maxSessionAge ?? 30 * 60 * 1000;

    // Initialize thinking management components
    this.thinkingManager = new ThinkingManager();

    // Initialize TokenOptimizer
    this.tokenOptimizer = this.optimizeTokens
      ? new TokenOptimizer({
          aggressive: this.aggressiveOptimization,
          maxHistoryTurns: this.maxHistoryTurns
        })
      : null;

    // Initialize MultiSessionManager
    this.multiSessionManager = this.enableMultiSession
      ? new MultiSessionManager({
          maxSessions: this.maxSessions,
          maxAgeMs: this.maxSessionAge
        })
      : null;

    // Track current agent ID for multi-session
    this.currentAgentId = null;
    this.currentConversationId = null;

    // Track original request for intervention (Tier 1.1)
    this.originalRequest = null;
    this.endpointConfig = null;

    // Initialize transformers with options
    this.requestTransformer = new RequestTransformer(this.thinkingManager, {
      debug: this.debug
    });
    this.responseTransformer = new ResponseTransformer(this.thinkingManager, {
      aliasedModel: this.aliasedModel
    });

    // Hallucination detection options
    this.hallucinationDetectionEnabled = options.hallucinationDetectionEnabled ?? false;
    this.hallucinationThreshold = options.hallucinationThreshold ?? 3;
    this.hallucinationBufferSize = options.hallucinationBufferSize ?? 500;
    this.hallucinationAutoIntervene = options.hallucinationAutoIntervene ?? false;
    this.hallucinationStopOnDetect = options.hallucinationStopOnDetect ?? false; // Stop stream when hallucination detected

    // Initialize HallucinationDetector if enabled
    this.hallucinationDetector = this.hallucinationDetectionEnabled
      ? new (require('./hallucination-detector.js').HallucinationDetector)({
          threshold: this.hallucinationThreshold,
          bufferSize: this.hallucinationBufferSize,
          debug: this.debug,
          contextAwareThresholds: options.contextAwareThresholds
        })
      : null;

    // Initialize HallucinationIntervention if auto-intervene is enabled
    this.hallucinationIntervention = (this.hallucinationDetectionEnabled && this.hallucinationAutoIntervene)
      ? new (require('./hallucination-intervention.js').HallucinationIntervention)({
          autoIntervene: this.hallucinationAutoIntervene,
          debug: this.debug
        })
      : null;
  }

  // Extract conversation ID from request
  extractConversationId(request, context) {
    // Try to get from context first
    if (context?.conversationId) {
      return context.conversationId;
    }

    // Generate conversation ID from first user message
    const messages = request?.messages || [];
    if (messages.length > 0) {
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
          const convId = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
          this.currentConversationId = convId;
          return convId;
        }
      }
    }

    this.currentConversationId = 'default';
    return 'default';
  }

  // Generate stable agent ID
  generateAgentId(request, context) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex').substring(0, 8);
    return `agent_${timestamp}_${random}`;
  }

  // Get stats for debugging
  getStats() {
    return {
      tokenOptimizer: this.tokenOptimizer?.getStats() || { enabled: false },
      multiSession: this.multiSessionManager
        ? {
            enabled: true,
            activeSessions: this.multiSessionManager.getActiveSessions(),
            sessionCount: this.multiSessionManager.getSessionCount(),
            conversationCount: this.multiSessionManager.getConversationCount()
          }
        : { enabled: false },
      thinkingManager: {
        conversations: Object.keys(this.thinkingManager.dump()).length
      }
    };
  }

  // Cleanup method for resource management
  cleanup() {
    this.multiSessionManager?.clear();
  }

  // Called to convert incoming Anthropic request to unified format
  async transformRequestOut(request, context) {
    // For /v1/messages endpoint, the incoming request is already in Anthropic format
    // Just return it as unified format (Anthropic format IS the unified format here)
    return request;
  }

  // Called before sending request to GLM
  async transformRequestIn(request, context = {}) {
    let transformed = { ...request };

    // Store original request for intervention (Tier 1.1)
    // Only store if not already an intervention to prevent infinite loops
    if (!request._hallucinationIntervention) {
      this.originalRequest = { ...request };
      this.endpointConfig = context?.endpoint || null;
    }

    // Extract conversation and agent IDs for multi-session
    const conversationId = this.extractConversationId(request, context);
    const agentId = context?.agentId || this.generateAgentId(request, context);
    this.currentAgentId = agentId;

    // Register session if multi-session is enabled
    if (this.multiSessionManager && agentId) {
      this.multiSessionManager.registerSession(agentId, conversationId);
      debugLog('MULTI_SESSION_REGISTERED', {
        agentId,
        conversationId,
        activeSessions: this.multiSessionManager.getSessionCount()
      }, this.debug);
    }

    // Step 1: Token optimization (before other transformations)
    if (this.tokenOptimizer) {
      const originalMessages = transformed.messages || [];
      const optimizedMessages = this.tokenOptimizer.optimize(originalMessages);
      transformed.messages = optimizedMessages;

      const savings = this.tokenOptimizer.getSavings();
      debugLog('TOKEN_OPTIMIZATION', {
        originalCount: savings?.originalCount,
        optimizedCount: savings?.optimizedCount,
        tokensSaved: savings?.tokensSaved,
        percentSaved: savings?.percentSaved
      }, this.debug);
    }

    // Step 2: Run request transformer
    transformed = await this.requestTransformer.transform(transformed, {
      preserveThinking: this.preserveThinking,
      forceReasoning: this.forceReasoning,
      conversationId,
      agentId,
      multiSessionManager: this.multiSessionManager
    });

    // Step 3: Enable Z.AI tool_stream for streaming tool calls
    if (transformed.tools && transformed.tools.length > 0) {
      transformed.tool_stream = true;
    }

    return transformed;
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

      // Store thinking in MultiSessionManager if enabled
      if (this.enableMultiSession && this.multiSessionManager && this.currentAgentId && data.choices?.[0]?.message?.reasoning_content) {
        const conversationId = this.currentConversationId || data.id || 'default';
        this.multiSessionManager.storeThinking(conversationId, this.currentAgentId, data.choices[0].message.reasoning_content);
        debugLog('NON_STREAMING_THINKING_STORED', {
          conversationId,
          agentId: this.currentAgentId,
          thinkingLength: data.choices[0].message.reasoning_content.length
        }, this.debug);
      }

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
    let thinkingStarted = false;

    // Capture self for uncertainty analysis in callback
    const self = this;

    // Hallucination tracking
    let totalScore = 0;
    let checkCount = 0;
    let maxChunkScore = 0;

    statusLine('Waiting for stream...', this.debug && this.hallucinationDetectionEnabled);

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
                if (thinkingStarted && self.hallucinationDetectionEnabled) {
                  statusLine(`DONE - Score:${totalScore}/${self.hallucinationThreshold}`, self.debug);
                }
                // Mark thinking as complete and store if we have thinking buffer
                if (thinkingBuffer && !isThinkingComplete) {
                  isThinkingComplete = true;
                  const responseId = 'streaming_' + Date.now();
                  self.thinkingManager.store(responseId, thinkingBuffer);

                  // Store in MultiSessionManager if enabled
                  if (self.enableMultiSession && self.multiSessionManager && self.currentAgentId) {
                    const conversationId = self.currentConversationId || responseId;
                    self.multiSessionManager.storeThinking(conversationId, self.currentAgentId, thinkingBuffer);
                    debugLog('STREAMING_THINKING_STORED_ON_DONE', {
                      conversationId,
                      agentId: self.currentAgentId,
                      thinkingLength: thinkingBuffer.length
                    }, self.debug);
                  }
                }
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

                  // First thinking chunk - mark as started
                  if (!thinkingStarted && self.hallucinationDetectionEnabled) {
                    thinkingStarted = true;
                    statusLine('THINKING: streaming...', self.debug);
                  }

                  // Analyze reasoning for hallucination patterns
                  if (self.hallucinationDetector) {
                    const analysis = self.hallucinationDetector.analyzeChunk(reasoning, self.originalRequest?.messages);
                    checkCount++;

                    // Update tracking
                    totalScore = analysis.score;
                    if (analysis.score > maxChunkScore) {
                      maxChunkScore = analysis.score;
                    }

                    // Show check status
                    const thresholdPercent = Math.min(100, Math.round((totalScore / self.hallucinationThreshold) * 100));
                    const statusText = `CHK:${checkCount} Score:${totalScore}/${self.hallucinationThreshold} [${thresholdPercent}%]`;
                    statusLine(statusText, self.debug);

                    // Threshold crossed
                    if (analysis.shouldIntervene) {
                      debugLog('HALLUCINATION_DETECTED', {
                        score: analysis.score,
                        normalizedScore: analysis.normalizedScore,
                        severity: analysis.severity,
                        confidence: analysis.confidence,
                        patterns: analysis.patterns,
                        text: reasoning.substring(0, 100)
                      }, self.debug);

                      statusLine(`ALERT! THRESHOLD CROSSED - Score:${totalScore}/${self.hallucinationThreshold} Severity:${analysis.severity}`, self.debug);

                      // Update stats
                      updateHallucinationStats(analysis);

                      // Stop stream if hallucinationStopOnDetect is enabled
                      if (self.hallucinationStopOnDetect) {
                        debugLog('HALLUCINATION_STOP_STREAM', {
                          reason: 'stop_on_detect enabled',
                          patterns: analysis.patterns,
                          score: analysis.score,
                          severity: analysis.severity
                        }, self.debug);

                        statusLine(`STOPPED - Check:${checkCount} MaxScore:${maxChunkScore}`, self.debug);

                        // Cancel upstream reader first
                        await reader.cancel();

                        // Try intervention if enabled and we have the necessary context
                        if (self.hallucinationAutoIntervene && self.hallucinationIntervention && self.originalRequest && self.endpointConfig) {
                          try {
                            debugLog('HALLUCINATION_INTERVENTION_START', {
                              hasOriginalRequest: !!self.originalRequest,
                              hasEndpointConfig: !!self.endpointConfig,
                              patterns: analysis.patterns
                            }, self.debug);

                            statusLine('INTERVENTION: Creating retry with web search...', self.debug);

                            // Create intervention request
                            const interventionRequest = self.hallucinationIntervention.createInterventionRequest(
                              self.originalRequest,
                              analysis
                            );

                            // Execute intervention (makes new API call)
                            const interventionResponse = await self.hallucinationIntervention.executeIntervention(
                              self.endpointConfig,
                              interventionRequest
                            );

                            debugLog('HALLUCINATION_INTERVENTION_SUCCESS', {
                              status: interventionResponse.status,
                              isStream: interventionResponse.headers?.get?.('Content-Type')?.includes('text/event-stream')
                            }, self.debug);

                            statusLine('INTERVENTION: Streaming retry response...', self.debug);

                            // Stream the intervention response
                            const interventionReader = interventionResponse.body.getReader();
                            try {
                              while (true) {
                                const { done, value } = await interventionReader.read();
                                if (done) break;
                                controller.enqueue(value);
                              }
                            } finally {
                              interventionReader.releaseLock();
                            }

                            controller.close();
                            return;
                          } catch (interventionError) {
                            debugLog('HALLUCINATION_INTERVENTION_ERROR', {
                              error: interventionError.message,
                              stack: interventionError.stack
                            }, self.debug);

                            statusLine(`INTERVENTION FAILED: ${interventionError.message}`, self.debug);

                            // Fall through to normal stop behavior
                          }
                        }

                        // Normal stop behavior (if intervention disabled or failed)
                        // Send DONE and stop streaming
                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));

                        // Mark final_reason as hallucination_detection
                        const finishChunk = {
                          id: chunk.id || 'default',
                          object: 'chat.completion.chunk',
                          created: chunk.created || Date.now(),
                          model: self.aliasedModel,
                          choices: [{
                            index: 0,
                            delta: { content: '' },
                            finish_reason: 'hallucination_detection'
                          }]
                        };
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));

                        controller.close();
                        return; // Exit chunk processing loop
                      }
                    }
                  }

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
                  // Mark thinking as complete
                  isThinkingComplete = true;

                  // Store thinking in ThinkingManager and MultiSessionManager
                  const responseId = chunk.id || 'default';
                  self.thinkingManager.store(responseId, thinkingBuffer);

                  // Store in MultiSessionManager if enabled
                  if (self.enableMultiSession && self.multiSessionManager && self.currentAgentId) {
                    const conversationId = self.currentConversationId || responseId;
                    self.multiSessionManager.storeThinking(conversationId, self.currentAgentId, thinkingBuffer);
                    debugLog('STREAMING_THINKING_STORED', {
                      conversationId,
                      agentId: self.currentAgentId,
                      thinkingLength: thinkingBuffer.length
                    }, self.debug);
                  }

                  chunk.model = self.aliasedModel;
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
                else if (choice0.delta?.tool_calls) {
                  // Handle streaming tool calls from Z.AI tool_stream
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
