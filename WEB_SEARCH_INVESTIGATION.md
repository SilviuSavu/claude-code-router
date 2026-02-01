# Z.AI Web Search Investigation Results

## Duration
15+ hours (2026-01-31 to 2026-02-01)

## Objective
Get Z.AI's native web_search tool working through Claude Code Router

## Key Findings

### ✅ What We Confirmed Working
1. **Z.AI Anthropic Endpoint**: `https://api.z.ai/api/anthropic/v1/messages` responds correctly
2. **Web Search Tracking**: Usage stats include `"server_tool_use": {"web_search_requests": 0}`
3. **User's Subscription**: MAX plan includes 4,000 monthly web search credits (currently used: 871)
4. **Claude Code Direct**: Web search WORKS when user connects Claude Code directly to Z.AI
5. **Bash Alternative**: curl/Bash gets accurate real-time data as workaround

### ❌ What Doesn't Work
1. **OpenAI Coding Endpoint** (`/api/coding/paas/v4`): Accepts web_search tool but model never sees it
2. **OpenAI Standard Endpoint** (`/api/paas/v4`): Insufficient balance/access
3. **Auto-trigger**: Web search doesn't auto-trigger on any query type (news, versions, current events)
4. **Tool Injection**: web_search tool injected correctly but model ignores it

### 🔍 Technical Details

#### Endpoints Tested
| Endpoint | Format | Result |
|----------|--------|--------|
| `/api/coding/paas/v4/chat/completions` | OpenAI | Works, but web_search not exposed to model |
| `/api/paas/v4/chat/completions` | OpenAI | 429 Insufficient balance |
| `/api/anthropic/v1/messages` | Anthropic | Works, web_search tracked but `requests: 0` |

#### Transformer Configurations Tried
1. **GLM47 transformer** (OpenAI format converter)
   - Correctly injects web_search tool
   - Removes competing tools (WebFetch, WebSearch, web-reader)
   - Query extraction works perfectly
   - tool_choice set to "auto" and "required"
   - **Result**: Model never uses web_search tool

2. **Anthropic transformer** (native format)
   - No transformation, sends native Anthropic format
   - web_search tracked in usage stats
   - **Result**: `web_search_requests: 0` even for obvious news queries

#### Web Search Tool Format (from Z.AI docs)
```json
{
  "type": "web_search",
  "web_search": {
    "enable": "True",
    "search_engine": "search-std",
    "search_result": "True",
    "search_query": "<user query>",
    "search_prompt": "Answer using search results...",
    "count": "10",
    "search_recency_filter": "noLimit",
    "content_size": "high"
  }
}
```

### 🎯 MYSTERY SOLVED!

**Question**: Why does web_search work in Claude Code but not CCR?

**Answer**: Claude Code uses Z.AI's **MCP server** (`web-search-prime`), NOT the native `web_search` tool!

**Key Finding** (via Tokentap capture):
- Claude Code sends tool: `mcp__web-search-prime__webSearchPrime`
- This is an MCP server at: `https://api.z.ai/api/mcp/web_search_prime/mcp`
- CCR does NOT forward MCP servers to the LLM
- CCR only forwards tools defined in the request to the Z.AI API endpoint

**MCP Tool Definition**:
```json
{
  "name": "mcp__web-search-prime__webSearchPrime",
  "description": "Search web information, returns results including web page title, web page URL, web page summary, website name, website icon, etc.",
  "input_schema": {
    "properties": {
      "search_query": {"type": "string", "description": "Content to be searched"},
      "search_recency_filter": {"type": "string", "description": "oneDay, oneWeek, oneMonth, oneYear, noLimit"},
      "content_size": {"type": "string", "description": "medium (400-600 words) or high (2500 words)"}
    }
  }
}
```

**Why Our Approach Failed**:
1. We tried injecting native `web_search` tool in transformer
2. But Claude Code never uses native `web_search` - it uses MCP!
3. CCR doesn't support MCP server passthrough/forwarding
4. Therefore web search cannot work through CCR without MCP support

### ✅ Solution Options

**Option 1: Add MCP Support to CCR** (Feature Request)
- File issue with CCR project requesting MCP server support
- CCR would need to forward MCP tool calls to configured MCP servers
- This is the "proper" solution but requires CCR changes

**Option 2: Use Claude Code Directly with Z.AI** (Current Workaround)
- Configure Claude Code: `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`
- Add MCP server in `~/.claude.json`:
  ```json
  "mcpServers": {
    "web-search-prime": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
  ```
- Web search works perfectly this way (871 / 4K credits used confirms this)

**Option 3: Transformer-based MCP Emulation** (Hacky)
- Create transformer that detects web search needs
- Make direct HTTP calls to MCP endpoint
- Return results as tool_result in response
- Complex and fragile, not recommended

### 📋 Investigation Process (Completed)

1. **Used Tokentap** (installed at `/tmp/tokentap`):
   ```bash
   # Terminal 1
   tokentap start

   # Terminal 2
   tokentap claude
   # Ask: "What's the latest Node.js version in 2026?"

   # Check captured request
   cat ~/.tokentap/prompts/2026-*.json
   ```

2. **Compare Requests**: See exact differences between:
   - Claude Code → Z.AI (working, uses credits)
   - CCR → Z.AI (not working, 0 credits)

3. **Check Z.AI Dashboard**:
   - Account settings for web_search feature
   - API key permissions
   - Feature flags or toggles

4. **Contact Z.AI Support**:
   - Ask why web_search tracked but never triggers
   - Request documentation on enabling web_search
   - Clarify if coding endpoint supports web_search

### 🛠️ Current Configuration

**File**: `~/.claude-code-router/config.json`

**Provider**: zai-anthropic
```json
{
  "name": "zai-anthropic",
  "api_base_url": "https://api.z.ai/api/anthropic/v1/messages",
  "models": ["glm-4.7", "glm-4.6", "glm-4.5", "glm-4.5-air"],
  "transformer": {
    "use": ["Anthropic"]
  }
}
```

**Status**: Clean, working configuration. Web search tracked but not triggering.

### 📚 Resources

- [Z.AI Web Search Documentation](https://docs.z.ai/guides/tools/web-search)
- [CCR GitHub Issue #898](https://github.com/musistudio/claude-code-router/issues/898)
- [Tokentap](https://github.com/jmuncor/tokentap) - Traffic inspection tool

### 🎯 Recommendation

**Immediate**: Use Claude Code directly with Z.AI (not through CCR)
- Already configured and working
- 4,000 monthly web search credits available
- No performance impact

**Future**: Request MCP support in CCR
- File issue at: https://github.com/musistudio/claude-code-router/issues
- Would enable web search and other MCP tools through CCR
- Benefits entire CCR community

**Alternative**: Keep using Bash/curl for one-off queries
- Works for simple data retrieval
- No credit usage
- Good for debugging

---

**Last Updated**: 2026-02-01 01:46 UTC
**Investigation Status**: ✅ RESOLVED - Root cause identified via Tokentap

**Root Cause**: Claude Code uses Z.AI's MCP server (`web-search-prime`), which CCR doesn't support.

**Evidence**: Tokentap capture shows Claude Code sending `mcp__web-search-prime__webSearchPrime` tool, not native `web_search`.

**Captured Request Details**:
- Model: glm-4.7
- Tools sent: 30 (including MCP tools from 3 MCP servers)
- MCP servers: web-search-prime, web-reader, zai-mcp-server, zread
- tool_choice: null (auto)
- No native web_search tool injected
