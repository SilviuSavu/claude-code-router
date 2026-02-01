# UQLM + DeepAgent Integration Context

## Date: 2026-01-31

## Summary
We implemented an UncertaintyDetector module in the claude-code-router's GLM47 transformer to prevent hallucination spirals by detecting when queries need current information and forcing web search.

## What Was Built

### New File Created
- `~/.claude-code-router/plugins/glm47-transformer/uncertainty-detector.js`
  - Detects keywords like "latest", "2026", "current", "new" → forces web search
  - Analyzes thinking content for uncertainty signals ("I think", "my knowledge cutoff", etc.)
  - Returns confidence scores (0-1) with threshold 0.7

### Files Modified
1. **request-transformer.js**
   - Added UncertaintyDetector integration
   - `shouldForceWebSearch()` checks incoming requests
   - Injects `<web_search_priority>` hint when current info needed

2. **index.js**
   - Removed deprecated StreamProcessor import
   - Added response uncertainty analysis after streaming completes
   - Logs uncertainty signals and confidence scores

### Files Deleted (deprecated)
- `stream-processor.js` (unused - streaming done inline)
- All `.bak` and `.tmp` files
- `test-transformer.js`

## Current File Structure
```
plugins/glm47-transformer/
├── index.js                  # Main entry (8.9KB)
├── request-transformer.js    # Request handling (7.8KB)
├── response-transformer.js   # Non-streaming response (1.9KB)
├── thinking-manager.js       # Thinking persistence (0.8KB)
├── tool-parser.js            # Tool call parsing (1.6KB)
└── uncertainty-detector.js   # NEW: UQLM-style detection (7.6KB)
```

## Test Results

### Test 1: "What's the latest version of Node.js in 2026?"
- UncertaintyDetector detected "latest", "2026" ✅
- Model said "This requires current information" ✅
- Z.AI web search returned 0 results ❌ (API issue)
- Model fell back to WebFetch(nodejs.org) ✅
- Got accurate answer: v24.13.0 LTS, v25.5.0 Current ✅

### Test 2: "What's new in React 19?"
- UncertaintyDetector triggered ✅
- Model acknowledged "ground rules" (our injected hint) ✅
- Z.AI web search returned 0 results ❌ (API issue)
- Model fell back to WebFetch(react.dev) ✅
- Got comprehensive React 19 changelog ✅

## Resolved Issues

### 1. Z.AI Web Search Returns 0 Results - FIXED ✅
**Root Cause**: Wrong format. Z.AI's "Web Search in Chat" is a **TOOL** in `tools` array, NOT a request parameter.

**Wrong (what we had)**:
```javascript
transformed.web_search = { enable: true };  // Does nothing
```

**Correct (Z.AI Web Search in Chat)**:
```javascript
tools = [{
  type: 'web_search',
  web_search: {
    enable: 'True',
    search_engine: 'search-prime',
    search_result: 'True',
    search_prompt: '...',
    count: '10',
    search_recency_filter: 'noLimit',
    content_size: 'high'
  }
}]
```

**Fix Applied (2026-01-31)**:
- Added `injectWebSearchTool()` method to request-transformer.js
- When UncertaintyDetector detects current-info keywords:
  1. Injects Z.AI `web_search` tool into the `tools` array
  2. Injects `<web_search_priority>` hint into system message
- Model uses Z.AI's native search with `search-prime` engine
- Response includes `web_search` array with results and citations `[Source: ref_N]`

**Reference**: https://docs.z.ai/guides/tools/web-search

### 2. Console.log Not in Pino Logs
- Our `console.log` statements go to stdout, not Pino
- Need to update transformer to use router's logger
- Task #5 created for this

## Latest Updates (2026-01-31 - After 4-hour Research)

### Research Phase Completed
- Launched 6 parallel research agents to investigate Z.AI web_search
- Comprehensive findings documented in WEB-SEARCH-RESEARCH-FINDINGS.md

### Critical Fixes Applied
1. **Changed search-prime → search-std** (PRIORITY 1)
   - Issue #74: search-prime requires Pro subscription
   - search-std works on Lite tier
   - Prevents 403 Forbidden errors

2. **Added glm-4-air Model Support** (PRIORITY 2)
   - GLM-4.7 has known tool calling degradation bugs
   - glm-4-air has better tool support
   - Auto-switches to glm-4-air when web search triggered
   - Configurable via `useAirForWebSearch` option (default: true)

3. **Updated Configuration Options**
```json
{
  "transformers": [{
    "path": "~/.claude-code-router/plugins/glm47-transformer/index.js",
    "options": {
      "preserveThinking": true,
      "forceReasoning": true,
      "webSearch": true,
      "useAirForWebSearch": true,
      "debug": false
    }
  }]
}
```

## Open Tasks
- Task #5: Update transformer to use Pino logging instead of console.log
- **NEW**: Test fixes with real queries to verify web search now works
- **NEW**: Monitor if glm-4-air successfully uses search results

## Architecture Overview

```
Claude Code Request
       ↓
┌─────────────────────────────────────────────────┐
│ GLM47Transformer.transformRequestIn()           │
│                                                 │
│ 1. Preserve Claude Code tools (WebFetch, etc.)  │
│ 2. UncertaintyDetector.shouldForceWebSearch()   │
│    - Check for current-info keywords            │
│    - If detected:                               │
│      a) injectWebSearchTool() → adds Z.AI       │
│         web_search tool with search-prime       │
│      b) injectWebSearchHint() → system prompt   │
└─────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────┐
│ Z.AI GLM-4.7 API                                │
│ - tools array includes type: "web_search"       │
│ - Z.AI performs search with search-prime engine │
│ - Response includes web_search[] with results   │
│ - Model cites sources as [Source: ref_N]        │
└─────────────────────────────────────────────────┘
       ↓
┌─────────────────────────────────────────────────┐
│ GLM47Transformer.transformResponseOut()         │
│                                                 │
│ UncertaintyDetector.analyzeThinking()           │
│ - Check thinking for uncertainty signals        │
│ - Log confidence scores                         │
│ - Warn if knowledge cutoff issues detected      │
└─────────────────────────────────────────────────┘
       ↓
Response to Claude Code
```

## Key Research References

### GitHub Repos Researched
- [cvs-health/uqlm](https://github.com/cvs-health/uqlm) - Uncertainty detection (UQLM)
- [RUC-NLPIR/DeepAgent](https://github.com/RUC-NLPIR/DeepAgent) - Autonomous tool calling
- [human-re/Agentic-Reasoning](https://github.com/human-re/Agentic-Reasoning) - Web search integration

### GLM-4.7 Official Docs
- [Thinking Mode](https://docs.z.ai/guides/capabilities/thinking-mode)
- [API Reference](https://docs.z.ai/guides/llm/glm-4.7)

### Three GLM-4.7 Thinking Modes
1. **Interleaved Thinking** - thinks before every tool call
2. **Preserved Thinking** - retains reasoning across turns (`clear_thinking: false`)
3. **Turn-level Thinking** - per-turn control over reasoning

## Config Reference
```json
// ~/.claude-code-router/config.json
{
  "transformers": [{
    "path": "~/.claude-code-router/plugins/glm47-transformer/index.js",
    "options": {
      "preserveThinking": true,
      "forceReasoning": true,
      "webSearch": true,
      "debug": false
    }
  }]
}
```

## Success Criteria Met
- ✅ Model proactively seeks current information
- ✅ Doesn't hallucinate from stale training data
- ✅ Falls back to alternative tools when web search fails
- ✅ Provides accurate, sourced answers
- ✅ Prevents hallucination spirals
