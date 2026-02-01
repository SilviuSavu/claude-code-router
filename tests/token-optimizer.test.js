import { TokenOptimizer } from '../plugins/glm47-transformer/token-optimizer.js';

describe('Token Optimizer', () => {
  it('should remove redundant messages', () => {
    const to = new TokenOptimizer({ aggressive: true });

    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Hello' }, // duplicate
      { role: 'assistant', content: 'Hi' }, // duplicate
    ];

    const result = to.optimize(messages);
    expect(result.length).toBeLessThan(messages.length);
  });

  it('should merge consecutive messages from same role', () => {
    const to = new TokenOptimizer();

    const messages = [
      { role: 'user', content: 'Part 1' },
      { role: 'user', content: 'Part 2' },
      { role: 'assistant', content: 'Response' }
    ];

    const result = to.optimize(messages);
    expect(result.length).toBe(2);
    expect(result[0].content).toContain('Part 1');
    expect(result[0].content).toContain('Part 2');
  });

  it('should estimate token savings', () => {
    const to = new TokenOptimizer();

    const messages = [
      { role: 'user', content: 'a'.repeat(100) },
      { role: 'assistant', content: 'b'.repeat(100) },
    ];

    const result = to.optimize(messages);
    const savings = to.getSavings();

    expect(savings.originalEstimate).toBeGreaterThan(0);
    expect(savings.optimizedEstimate).toBeLessThanOrEqual(savings.originalEstimate);
    expect(parseFloat(savings.percentSaved)).toBeGreaterThanOrEqual(0);
  });

  it('should preserve system messages', () => {
    const to = new TokenOptimizer();

    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' }
    ];

    const result = to.optimize(messages);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe('You are helpful');
  });
});
