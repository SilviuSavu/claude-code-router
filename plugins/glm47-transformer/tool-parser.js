// tool-parser.js

class ToolParser {
  // Regex from vLLM's glm47 parser
  static TOOL_CALL_REGEX = /<tool_call>([\s\S]*?)(?:<arg_key>([\s\S]*?))?<\/tool_call>/;

  parse(xmlString) {
    const match = ToolParser.TOOL_CALL_REGEX.exec(xmlString);
    if (!match) return null;

    try {
      const toolContent = match[1].trim();
      const argContent = match[2]?.trim();

      // Parse function name and arguments
      // GLM format: {"name": "func_name", "arguments": {...}}
      // or sometimes just the function call directly

      let parsed;
      if (toolContent.startsWith('{')) {
        parsed = JSON.parse(toolContent);
      } else {
        // Try to extract name and args from non-JSON format
        parsed = this.parseNonJson(toolContent, argContent);
      }

      if (!parsed?.name) return null;

      return {
        type: 'tool_use',
        id: 'toolu_' + Math.random().toString(36).substr(2, 24),
        name: parsed.name,
        input: parsed.arguments || {}
      };
    } catch (e) {
      console.error('Tool parse error:', e);
      return null;
    }
  }

  parseNonJson(content, argContent) {
    // Handle edge cases where GLM outputs non-standard format
    // This is defensive parsing for malformed outputs

    const nameMatch = content.match(/["']?name["']?\s*[:=]\s*["']([^"']+)["']/);
    const argsMatch = content.match(/["']?arguments["']?\s*[:=]\s*({[\s\S]*})/);

    if (nameMatch) {
      return {
        name: nameMatch[1],
        arguments: argsMatch ? JSON.parse(argsMatch[1]) : {}
      };
    }

    return null;
  }
}

module.exports = { ToolParser };
