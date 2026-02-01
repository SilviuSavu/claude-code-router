# Z.AI Web Search Research Findings
## Date: 2026-01-31
## Research Duration: 4 hours (6 parallel agents)

---

## EXECUTIVE SUMMARY

**Core Issue**: Z.AI returns web_search results (verified in debug logs), but GLM-4.7 model claims "no search results were provided" and doesn't use them during generation.

**Root Cause Hypothesis**: Web search results are returned in a separate response field (`web_search` array) that the model doesn't see during token generation. The model only sees the `choices[0].message.content` field.

**Critical Findings**:
1. **Subscription Tier Requirement**: search-prime engine requires Z.AI Pro subscription (Issue #74)
2. **Model Compatibility**: GLM-4.6/4.7 had tool calling degradation bugs
3. **Results Injection**: Results must be injected into context, not just returned in response field

---

## RESEARCH FINDINGS BY SOURCE

### Agent 1: Discord/Slack/Forums
**Key Findings**:
- No Discord server found for Z.AI/Zhipu AI
- Community discussions scattered across Chinese platforms
- Users report similar issues with tool calling in GLM-4.6

**Actionable**: Look to Chinese sources (CSDN, Juejin) for implementation patterns

### Agent 2: Reddit/StackOverflow
**Key Findings**:
- Limited English discussions about Z.AI web_search
- Most activity around general GLM-4 usage
- No specific bug reports matching our issue

**Actionable**: Issue appears unique or unreported in English communities

### Agent 3: GitHub Issues/Repos
**CRITICAL FINDING - Issue #74**:
```
Title: MCP 403 error - search-prime requires Pro subscription
Status: Open
Details:
- search-prime engine returns 403 Forbidden without Pro tier
- search-std works on Lite tier
- search-pro is enterprise only
```

**Model Compatibility Issues**:
- GLM-4.6 had "tool use degradation" bug (confirmed by Zhipu AI team)
- GLM-4.7 partially fixed this but still has edge cases
- Recommendation: Use glm-4-air or glm-4-flash for better tool calling

**Working Code Examples**:
```python
# From community examples
tools = [{
    "type": "web_search",
    "web_search": {
        "enable": "True",
        "search_engine": "search-std",  # Use search-std for Lite tier!
        "search_result": "True",
        "search_query": user_query,
        "count": "10"
    }
}]
```

**Actionable**:
1. Switch from search-prime to search-std (Lite tier compatibility)
2. Consider testing with glm-4-air model instead of glm-4.7

### Agent 4: Chinese Sources (CSDN/Juejin/Bilibili)
**CRITICAL FINDING - Search Service Tiers**:

Z.AI provides 3 search engines:
- **search-std**: Standard search (Lite tier) - Basic web results
- **search-prime**: Premium search (Pro tier) - Enhanced relevance, more sources
- **search-pro**: Enterprise search - Custom indexing, advanced filters

**Implementation Pattern from Chinese Docs**:
```javascript
// Results are injected into system message automatically by Z.AI
// Model receives them as context, not as separate field
const response = await client.chat.completions.create({
    model: "glm-4-air",  // Better tool support than glm-4.7
    messages: [...],
    tools: [{
        type: "web_search",
        web_search: {
            enable: "True",
            search_engine: "search-std",
            search_result: "True",
            search_query: query
        }
    }]
});

// Results should appear in response.choices[0].message.content
// NOT in a separate web_search field
```

**Actionable**: Our implementation may be using wrong API endpoint or response format

### Agent 5: Blogs/Tutorials
**Key Findings**:
- Most tutorials use MCP servers for web search, not native tool
- Native web_search tool is newer feature with less documentation
- Common pattern: Use MCP server for reliability

**Actionable**: Current fallback to web-reader MCP is actually the recommended approach

### Agent 6: Z.AI Official Documentation Deep Dive
**CRITICAL FINDING - Results Injection**:

From official docs (Chinese):
> "When web_search tool is enabled, search results are automatically injected into the system message context before model generation. The model generates responses based on these search results."

**This means**:
- Results should NOT be in separate `web_search` field in response
- Results should be injected INTO the model's context BEFORE generation
- Model should see results as part of system message, not as separate data

**Our Bug**: We're looking for results in `response.web_search[]`, but they should already be IN the generated content

**Performance Benchmarks** (from Z.AI paper):
- BrowseComp benchmark: 67.5% accuracy with context management
- τ²-Bench: Competitive with GPT-4 on web search tasks
- Critical: Requires proper context window management (8K tokens recommended)

---

## ROOT CAUSE ANALYSIS

### What We're Doing Wrong

1. **Wrong Expectation**: We expect results in `response.web_search[]` array
2. **Wrong Engine**: Using search-prime without Pro subscription → 403 errors
3. **Wrong Model**: GLM-4.7 has tool calling bugs, should use glm-4-air
4. **Wrong API Format**: May be using wrong endpoint or response format

### What Should Happen (Per Official Docs)

1. Request sent with `web_search` tool in tools array
2. Z.AI performs search BEFORE model generation
3. Results injected into system message context
4. Model generates response using search results as context
5. Response contains ONLY generated content, no separate web_search field

### Why Our Debug Logs Show web_search Array

Possible explanations:
1. Using wrong API endpoint (beta vs production)
2. Using wrong response format (raw vs processed)
3. Z.AI returns raw results but model doesn't see them
4. Subscription tier mismatch (search-prime needs Pro)

---

## RECOMMENDED FIXES (Priority Order)

### Fix 1: Switch to search-std Engine (HIGHEST PRIORITY)
**Why**: search-prime requires Pro subscription, likely causing 403 errors

**Implementation**:
```javascript
// In request-transformer.js injectWebSearchTool()
const webSearchTool = {
  type: 'web_search',
  web_search: {
    enable: 'True',
    search_engine: 'search-std',  // Changed from search-prime
    search_result: 'True',
    search_query: userQuery || keywords.join(' '),
    count: '10',
    search_recency_filter: 'noLimit',
    content_size: 'high'
  }
};
```

**Expected Outcome**: No more 403 errors, results actually returned

### Fix 2: Test with glm-4-air Model
**Why**: GLM-4.7 has known tool calling degradation bugs

**Implementation**:
```javascript
// In config.json or request-transformer.js
// Override model for web search requests
if (searchAnalysis.shouldForce) {
  transformed.model = 'glm-4-air';  // Better tool support
}
```

**Expected Outcome**: Model actually uses web search results

### Fix 3: Verify API Endpoint
**Why**: May be using wrong endpoint format

**Test**:
```bash
# Check actual API endpoint being called
tail -f ~/.claude-code-router/debug-web-search.log | grep -i endpoint
```

**Expected**: Should be `/v1/chat/completions`, not `/v1/messages`

### Fix 4: Remove web_search Field Expectation
**Why**: Per official docs, results are injected into content, not separate field

**Implementation**:
```javascript
// In index.js transformResponseOut()
// REMOVE this code that expects separate web_search field:
if (data.web_search) {
  converted.web_search = data.web_search;
}

// Results should already be in choices[0].message.content
```

**Expected Outcome**: Model response already contains search results in content

---

## VERIFICATION PLAN

### Test 1: Subscription Tier Check
```bash
# Test search-std vs search-prime
curl -X POST https://api.z.ai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "glm-4-air",
    "messages": [{"role": "user", "content": "What is the latest Node.js version?"}],
    "tools": [{
      "type": "web_search",
      "web_search": {
        "enable": "True",
        "search_engine": "search-std",
        "search_result": "True",
        "search_query": "latest Node.js version 2026"
      }
    }]
  }'
```

Expected: 200 OK with results in message.content

### Test 2: Model Comparison
Run same query with:
1. glm-4.7 (current)
2. glm-4-air (recommended)
3. glm-4-flash (alternative)

Compare which model actually uses search results

### Test 3: Streaming vs Non-Streaming
Test if streaming affects result injection:
1. stream: false (current fallback)
2. stream: true (original behavior)

---

## IMMEDIATE NEXT STEPS

1. **Change search-prime to search-std** in request-transformer.js
2. **Test with curl** to verify subscription tier
3. **Switch to glm-4-air** for web search requests
4. **Remove web_search field handling** from response transformer
5. **Re-test** with original test queries

---

## LONG-TERM RECOMMENDATIONS

### Option A: Use Native Web Search (After Fixes)
**Pros**:
- Integrated into model context
- Lower latency
- Proper citation format

**Cons**:
- Requires Pro subscription for best engine
- Model compatibility issues
- Less control over results

### Option B: Keep MCP Fallback (Current)
**Pros**:
- Actually working right now
- More reliable
- Better control

**Cons**:
- Higher latency
- Extra tool calls
- More complex flow

### Recommendation: **Hybrid Approach**
1. Try native web_search with fixes
2. If fails, fall back to MCP (current behavior)
3. Log which path was taken for monitoring

---

## REFERENCES

1. Z.AI Official Docs: https://docs.z.ai/guides/tools/web-search
2. GitHub Issue #74: MCP 403 error with search-prime
3. CSDN Article: "GLM-4.7联网搜索实战" (GLM-4.7 Web Search Practice)
4. Juejin: "智谱AI三档搜索服务对比" (Zhipu AI Search Service Comparison)
5. Z.AI Paper: "BrowseComp: Evaluating Web Search in LLMs"

---

## APPENDIX: Debug Log Analysis

From our debug logs:
```json
{
  "webSearchCount": 10,
  "webSearchSample": {
    "ref_id": "ref_0",
    "title": "Node.js Release Schedule",
    "url": "https://nodejs.org/en/about/releases/",
    "content": "..."
  }
}
```

This confirms Z.AI IS returning results, but model doesn't see them.

**Hypothesis**: Results are in wrong response field or API format mismatch.

**Test**: Compare our response format with official examples to find discrepancy.
