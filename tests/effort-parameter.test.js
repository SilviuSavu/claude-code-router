// tests/effort-parameter.test.js
// Test effort parameter support for Opus 4.5 parity

import { RequestTransformer } from '../plugins/glm47-transformer/request-transformer.js';
import { ThinkingManager } from '../plugins/glm47-transformer/thinking-manager.js';

describe('Effort Parameter Support', () => {
  let transformer;
  let thinkingManager;

  beforeEach(() => {
    thinkingManager = new ThinkingManager();
    transformer = new RequestTransformer(thinkingManager);
  });

  const baseRequest = {
    messages: [
      { role: 'user', content: 'Hello' }
    ],
    model: 'glm-4.7',
    max_tokens: 1024
  };

  describe('effort:low', () => {
    it('converts to minimal thinking params (budget_tokens < 5000)', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'low' });

      expect(result.thinking).toBeDefined();
      expect(result.thinking.type).toBe('enabled');
      expect(result.thinking.budget_tokens).toBeLessThan(5000);
      expect(result.temperature).toBe(0.1);
    });

    it('uses exact budget_tokens of 2048 for low effort', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'low' });

      expect(result.thinking.budget_tokens).toBe(2048);
    });
  });

  describe('effort:medium', () => {
    it('converts to balanced params (5000-20000)', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'medium' });

      expect(result.thinking).toBeDefined();
      expect(result.thinking.type).toBe('enabled');
      expect(result.thinking.budget_tokens).toBeGreaterThanOrEqual(5000);
      expect(result.thinking.budget_tokens).toBeLessThan(20000);
      expect(result.temperature).toBe(0.0);
    });

    it('uses exact budget_tokens of 16384 for medium effort', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'medium' });

      expect(result.thinking.budget_tokens).toBe(16384);
    });
  });

  describe('effort:high', () => {
    it('converts to maximum params (>=20000)', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'high' });

      expect(result.thinking).toBeDefined();
      expect(result.thinking.type).toBe('enabled');
      expect(result.thinking.budget_tokens).toBeGreaterThanOrEqual(20000);
      expect(result.temperature).toBe(0.0);
    });

    it('uses exact budget_tokens of 65536 for high effort', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'high' });

      expect(result.thinking.budget_tokens).toBe(65536);
    });
  });

  describe('default behavior', () => {
    it('defaults to high effort when not specified', async () => {
      const result = await transformer.transform(baseRequest, {});

      expect(result.thinking).toBeDefined();
      expect(result.thinking.type).toBe('enabled');
      expect(result.thinking.budget_tokens).toBeGreaterThanOrEqual(20000);
      expect(result.temperature).toBe(0.0);
    });

    it('defaults to high effort (65536 budget_tokens)', async () => {
      const result = await transformer.transform(baseRequest, {});

      expect(result.thinking.budget_tokens).toBe(65536);
    });

    it('respects existing temperature when specified', async () => {
      const requestWithTemp = { ...baseRequest, temperature: 0.5 };
      const result = await transformer.transform(requestWithTemp, { effort: 'high' });

      // Should preserve existing temperature from request
      expect(result.temperature).toBe(0.5);
    });
  });

  describe('mapEffortToThinkingParams method', () => {
    it('is a method on RequestTransformer', () => {
      expect(typeof transformer.mapEffortToThinkingParams).toBe('function');
    });

    it('returns correct params for low effort', () => {
      const params = transformer.mapEffortToThinkingParams('low');
      expect(params.budget_tokens).toBe(2048);
    });

    it('returns correct params for medium effort', () => {
      const params = transformer.mapEffortToThinkingParams('medium');
      expect(params.budget_tokens).toBe(16384);
    });

    it('returns correct params for high effort', () => {
      const params = transformer.mapEffortToThinkingParams('high');
      expect(params.budget_tokens).toBe(65536);
    });

    it('returns correct params for undefined (default high)', () => {
      const params = transformer.mapEffortToThinkingParams(undefined);
      expect(params.budget_tokens).toBe(65536);
    });
  });

  describe('temperature adjustment', () => {
    it('sets temperature to 0.1 for low effort', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'low' });
      expect(result.temperature).toBe(0.1);
    });

    it('sets temperature to 0.0 for medium effort', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'medium' });
      expect(result.temperature).toBe(0.0);
    });

    it('sets temperature to 0.0 for high effort', async () => {
      const result = await transformer.transform(baseRequest, { effort: 'high' });
      expect(result.temperature).toBe(0.0);
    });
  });
});
