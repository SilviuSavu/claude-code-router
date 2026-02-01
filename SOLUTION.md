# Web Search Mystery: SOLVED

## TL;DR

**Problem**: Web search works when Claude Code connects directly to Z.AI, but not through Claude Code Router (CCR).

**Root Cause**: CCR automatically converts tool definitions from Anthropic format → OpenAI format before sending to Z.AI's Anthropic endpoint, corrupting the tool schemas. Z.AI rejects the malformed tools with a 422 error.

**Additional Finding**: MCP servers ARE accessible through `ccr code` (Claude Code connects to them directly), but the tool definitions get corrupted by CCR's format conversion before reaching Z.AI.

**Solution**: Either use Claude Code directly with Z.AI, or file a bug report with CCR about incorrect format conversion for Anthropic endpoints.

---

## The Actual Bug in CCR

When you run `ccr code`, CCR sets `ANTHROPIC_BASE_URL=http://127.0.0.1:3457` and Claude Code sends requests there.

**The Bug**: CCR sees requests to `/v1/messages` and automatically converts tool schemas:

**Before (Anthropic format sent by Claude Code)**:
```json
{
  "name": "mcp__web-search-prime__webSearchPrime",
  "description": "Search web information",
  "input_schema": {
    "type": "object",
    "properties": {"search_query": {"type": "string"}},
    "required": ["search_query"]
  }
}
```

**After CCR conversion (OpenAI format)**:
```json
{
  "type": "function",
  "function": {
    "name": "mcp__web-search-prime__webSearchPrime",
    "description": "Search web information",
    "parameters": {
      "type": "object",
      "properties": {"search_query": {"type": "string"}},
      "required": ["search_query"]
    }
  }
}
```

**Result**: Z.AI's Anthropic endpoint at `https://api.z.ai/api/anthropic/v1/messages` receives OpenAI-formatted tools and returns:

```json
{
  "detail": [{
    "type": "missing",
    "loc": ["body", "tools", 0, "name"],
    "msg": "Field required"
  }]
}
```

This happens **even with empty `transformers: []` array** because CCR has built-in format conversion logic.

**Why MCP shows as connected**: Claude Code manages MCP connections separately from the LLM API requests. The `/mcp` command shows MCP servers Claude Code has connected to directly - these connections bypass CCR entirely. The bug is only in how CCR forwards the tool schemas to Z.AI.

---

## What I Discovered (Using Tokentap)

After 15+ hours of investigation, I used [Tokentap](https://github.com/jmuncor/tokentap) to capture the actual requests Claude Code sends to Z.AI. Here's what I found:

### Claude Code Sends This Tool:
```json
{
  "name": "mcp__web-search-prime__webSearchPrime",
  "description": "Search web information, returns results including web page title, web page URL, web page summary, website name, website icon, etc.",
  "input_schema": {
    "properties": {
      "search_query": {
        "type": "string",
        "description": "Content to be searched"
      },
      "search_recency_filter": {
        "type": "string",
        "description": "oneDay, oneWeek, oneMonth, oneYear, noLimit"
      },
      "content_size": {
        "type": "string",
        "description": "medium (400-600 words) or high (2500 words)"
      }
    }
  }
}
```

### This is an MCP Server Tool

The tool comes from your `~/.claude.json` MCP configuration:

```json
{
  "mcpServers": {
    "web-search-prime": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_Z_AI_API_KEY_HERE"
      }
    }
  }
}
```

---

## Why Our Transformer Approach Failed

All our attempts tried to inject the **native** `web_search` tool:

```json
{
  "type": "web_search",
  "web_search": {
    "enable": "True",
    "search_engine": "search-std",
    "search_query": "...",
    ...
  }
}
```

But Claude Code never uses this! It uses the **MCP tool** `mcp__web-search-prime__webSearchPrime`.

---

## What CCR Does Differently (UPDATED FINDING)

**Claude Code → Z.AI** (direct):
1. Reads `~/.claude.json` MCP server config
2. Connects to MCP servers directly (for tool execution)
3. Sends request to Z.AI with MCP tools in **Anthropic format**:
   ```json
   {
     "name": "mcp__web-search-prime__webSearchPrime",
     "description": "...",
     "input_schema": {...}
   }
   ```
4. When LLM calls the tool, Claude Code routes it to the MCP server
5. Returns results to LLM
✅ Web search works

**Claude Code → CCR → Z.AI** (routed):
1. Claude Code reads MCP config and includes MCP tools (**Anthropic format**)
2. Sends request to CCR at `http://127.0.0.1:3457/v1/messages`
3. ❌ **CCR automatically converts tools from Anthropic → OpenAI format**:
   ```json
   {
     "type": "function",
     "function": {
       "name": "mcp__web-search-prime__webSearchPrime",
       "description": "...",
       "parameters": {...}
     }
   }
   ```
4. CCR sends converted (broken) tools to Z.AI's **Anthropic endpoint**
5. Z.AI Anthropic endpoint rejects the OpenAI-formatted tools with 422 error
6. Even if tools worked, MCP servers are still connected (Claude Code handles them)
❌ Web search doesn't work because tools are corrupted by format conversion

---

## Evidence from Tokentap Capture

**Request Details**:
- Model: `glm-4.7`
- Tools: 30 total
  - Standard Claude Code tools (Bash, Read, Write, etc.)
  - Built-in web tools (WebFetch, WebSearch)
  - **MCP tools from 4 MCP servers**:
    - `mcp__web-search-prime__webSearchPrime` ← The web search we want!
    - `mcp__web-reader__webReader`
    - `mcp__zai-mcp-server__*` (various image/video analysis tools)
    - `mcp__zread__*` (GitHub repo analysis tools)

**Key Parameters**:
- `tool_choice`: `null` (auto selection)
- `max_tokens`: 32000
- `temperature`: `null`
- `top_p`: `null`

**No native web_search tool anywhere in the request!**

---

## Your Options

### Option 1: Use Claude Code Directly (Recommended)

This is what you're already doing when web search works:

```bash
# In your shell config or before running claude:
export ANTHROPIC_BASE_URL="https://api.z.ai/api/anthropic"
```

**Pros**:
- ✅ Already works perfectly
- ✅ 4,000 monthly web search credits available (871 used so far)
- ✅ No changes needed

**Cons**:
- ❌ Can't use CCR features (model routing, custom transformers)

---

### Option 2: File Bug Report with CCR (Recommended)

File an issue at https://github.com/musistudio/claude-code-router/issues reporting the tool format conversion bug.

**Bug Description**:
- CCR converts Anthropic tool format → OpenAI format
- Then sends to Z.AI's Anthropic endpoint
- Z.AI rejects malformed tools with 422 error
- This breaks ALL tools (including MCP tools) when routing to Anthropic-compatible endpoints

**What CCR needs to fix**:
1. Detect provider endpoint format (Anthropic vs OpenAI)
2. Don't convert tool schemas when forwarding to Anthropic endpoints
3. OR: Add provider config option to disable automatic format conversion

**Benefits**:
- ✅ Would fix tools for ALL Anthropic-compatible providers
- ✅ Benefits entire CCR community
- ✅ Simpler fix than adding MCP support
- ✅ Enables your web search through CCR

**Downside**:
- ⏱️ Requires CCR maintainer to fix
- ⏱️ Timeline uncertain

---

### Option 3: Keep Using Bash for One-Off Queries

For simple data retrieval, keep using:

```bash
curl -s "https://api.duckduckgo.com/?q=your+query&format=json" | jq
```

**Pros**:
- ✅ Works through CCR
- ✅ No web search credits used
- ✅ Good for debugging

**Cons**:
- ❌ Limited to simple queries
- ❌ No LLM-generated search queries
- ❌ Manual integration with responses

---

## Conclusion

After 15+ hours of investigation:

1. ❌ Native `web_search` tool injection doesn't work because Claude Code doesn't use it
2. ✅ Claude Code uses MCP server `web-search-prime`
3. ❌ CCR doesn't support MCP server forwarding
4. ✅ Solution: Use Claude Code directly, or request CCR MCP support

**The mystery is solved!** The 871 / 4K web search credits usage confirms that when you use Claude Code directly with Z.AI, it works perfectly. That's because the MCP server connection is direct, not going through CCR.

---

**Investigation Tools Used**:
- [Tokentap](https://github.com/jmuncor/tokentap) - HTTP proxy for intercepting LLM API traffic
- Modified tokentap config to support Z.AI endpoint
- Captured actual Claude Code requests to Z.AI
- Compared with CCR requests

**Files Updated**:
- `WEB_SEARCH_INVESTIGATION.md` - Full investigation timeline and findings
- `SOLUTION.md` - This file (summary and recommendations)
