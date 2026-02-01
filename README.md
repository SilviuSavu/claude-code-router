# Claude Code Router + Z.AI GLM-4.7 with Web Search

This repository contains a working configuration for using **Z.AI's GLM-4.7 model** with **Claude Code** through **Claude Code Router (CCR)**, with **MCP-based web search** fully functional.

## 🎯 What This Solves

After a 15+ hour investigation, we discovered that:
- Claude Code uses Z.AI's **MCP server** for web search (not native `web_search` tool)
- CCR was corrupting tool schemas by converting Anthropic → OpenAI format then sending to Anthropic endpoints
- The solution: Use Z.AI's **OpenAI endpoint** with **GLM47 transformer** that **preserves MCP tools**

## ✅ What Works

- ✅ GLM-4.7 model with thinking/reasoning modes
- ✅ MCP-based web search (`web-search-prime`)
- ✅ Real-time current information retrieval
- ✅ All Claude Code features through CCR
- ✅ Z.AI web search credits properly utilized

## 🚀 Setup

### 1. Prerequisites

```bash
# Install Claude Code Router
npm install -g @musistudio/claude-code-router

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Get Z.AI API Key
# Sign up at https://z.ai and get your API key
```

### 2. Configure CCR

```bash
# Copy example config
cp config.example.json config.json

# Edit config.json and replace YOUR_Z_AI_API_KEY_HERE with your actual key
```

### 3. Configure Claude Code MCP Servers

Add to your `~/.claude.json`:

```json
{
  "mcpServers": {
    "web-search-prime": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/web_search_prime/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_Z_AI_API_KEY_HERE"
      }
    },
    "zai-mcp-server": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/zai-mcp-server/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_Z_AI_API_KEY_HERE"
      }
    },
    "zread": {
      "type": "http",
      "url": "https://api.z.ai/api/mcp/zread/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_Z_AI_API_KEY_HERE"
      }
    }
  }
}
```

### 4. Start CCR and Claude Code

```bash
# Terminal 1: Start CCR
ccr start

# Terminal 2: Start Claude Code through CCR
ccr code
```

### 5. Test Web Search

In Claude Code, ask a question requiring current information:

```
What are the top 3 tech news headlines today?
```

You should see the `mcp__web-search-prime__webSearchPrime` tool being called!

## 🔧 Key Configuration Details

### Provider Configuration

The key is using **Z.AI's OpenAI endpoint** (not Anthropic endpoint):

```json
{
  "name": "zai-openai",
  "api_base_url": "https://api.z.ai/api/coding/paas/v4/chat/completions",
  "transformer": {
    "use": ["GLM47"]
  }
}
```

### GLM47 Transformer

The transformer has been modified to **preserve all MCP tools** (tools starting with `mcp__`):

```javascript
// Preserve MCP tools
if (name.startsWith('mcp__')) {
  console.log('[GLM47] Preserving MCP tool:', name);
  return true;
}
```

See `plugins/glm47-transformer/request-transformer.js` for full details.

## 📚 Documentation

- [SOLUTION.md](SOLUTION.md) - Complete technical breakdown of the solution
- [WEB_SEARCH_INVESTIGATION.md](WEB_SEARCH_INVESTIGATION.md) - Full 15+ hour investigation timeline

## 🐛 The Bug We Found

**CCR was automatically converting tool schemas**:
- Claude Code sends tools in Anthropic format
- CCR converted them to OpenAI format
- Then sent to Z.AI's Anthropic endpoint
- Z.AI rejected malformed tools with 422 error

**The Fix**:
- Use Z.AI's OpenAI endpoint instead
- CCR's conversion is now correct (Anthropic → OpenAI for OpenAI endpoint)
- GLM47 transformer preserves MCP tools
- Everything works!

## 🙏 Credits

- Investigation and solution: Claude Code + human debugging over 15+ hours
- Tools used: [Tokentap](https://github.com/jmuncor/tokentap) for traffic inspection
- Related issue: [CCR #898](https://github.com/musistudio/claude-code-router/issues/898)

## 📝 License

MIT - Use freely, share widely!

## 🤝 Contributing

If you find issues or improvements:
1. Check [SOLUTION.md](SOLUTION.md) for technical details
2. Open an issue describing the problem
3. PRs welcome!

---

**Built with persistence, caffeine, and 15+ hours of debugging** ☕🔧
