#!/bin/bash
# Test script for Z.AI web search fixes
# Tests the priority fixes from research findings

set -e

echo "=== Z.AI Web Search Fix Verification ==="
echo "Date: $(date)"
echo ""

# Check if API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "ERROR: OPENAI_API_KEY environment variable not set"
    echo "Please set your Z.AI API key first"
    exit 1
fi

echo "1. Testing search-std engine (Lite tier compatibility)..."
echo ""

curl -X POST https://api.z.ai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4-air",
    "messages": [
      {
        "role": "user",
        "content": "What is the latest Node.js LTS version in 2026?"
      }
    ],
    "tools": [{
      "type": "web_search",
      "web_search": {
        "enable": "True",
        "search_engine": "search-std",
        "search_result": "True",
        "search_query": "latest Node.js LTS version 2026",
        "count": "5"
      }
    }],
    "stream": false
  }' | jq '.choices[0].message.content' || echo "Request failed"

echo ""
echo ""
echo "2. Testing glm-4-air vs glm-4.7 tool calling..."
echo ""

echo "Testing with glm-4.7:"
curl -X POST https://api.z.ai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4.7",
    "messages": [
      {
        "role": "user",
        "content": "What are the new features in React 19?"
      }
    ],
    "tools": [{
      "type": "web_search",
      "web_search": {
        "enable": "True",
        "search_engine": "search-std",
        "search_result": "True",
        "search_query": "React 19 new features",
        "count": "5"
      }
    }],
    "stream": false
  }' | jq '.choices[0].message.content' || echo "Request failed"

echo ""
echo ""
echo "Testing with glm-4-air:"
curl -X POST https://api.z.ai/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "glm-4-air",
    "messages": [
      {
        "role": "user",
        "content": "What are the new features in React 19?"
      }
    ],
    "tools": [{
      "type": "web_search",
      "web_search": {
        "enable": "True",
        "search_engine": "search-std",
        "search_result": "True",
        "search_query": "React 19 new features",
        "count": "5"
      }
    }],
    "stream": false
  }' | jq '.choices[0].message.content' || echo "Request failed"

echo ""
echo ""
echo "=== Tests Complete ==="
echo ""
echo "EXPECTED RESULTS:"
echo "1. search-std should work without 403 errors"
echo "2. glm-4-air should provide better responses using search results"
echo "3. Responses should cite sources or show current information"
echo ""
echo "Check output above to verify fixes worked."
