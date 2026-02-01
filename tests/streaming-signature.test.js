import { ResponseTransformer } from '../plugins/glm47-transformer/response-transformer.js';
import { ThinkingManager } from '../plugins/glm47-transformer/thinking-manager.js';

describe('Streaming Signature Generation', () => {
  it('should generate longer signatures for thinking blocks', async () => {
    const tm = new ThinkingManager();
    const rt = new ResponseTransformer(tm);

    const response = {
      id: 'test-id',
      choices: [{
        message: {
          reasoning_content: 'This is some thinking content'
        }
      }]
    };

    const result = await rt.transform(response);

    expect(result.choices[0].message.thinking).toBeDefined();
    expect(result.choices[0].message.thinking.signature).toBeDefined();
    expect(result.choices[0].message.thinking.signature.length).toBeGreaterThan(50);
  });

  it('should include version prefix in signature', async () => {
    const tm = new ThinkingManager();
    const rt = new ResponseTransformer(tm);

    const response = {
      id: 'test-id',
      choices: [{
        message: {
          reasoning_content: 'Thinking'
        }
      }]
    };

    const result = await rt.transform(response);

    expect(result.choices[0].message.thinking.signature).toMatch(/^glm47_v2_/);
  });
});
