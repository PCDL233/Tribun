import { describe, expect, it } from 'vitest';
import { runReview } from '../src/run.js';

describe('runReview', () => {
  it('fails clearly when the repository path is invalid', async () => {
    await expect(
      runReview({
        repoPath: 'Z:/missing-ai-review-repository',
        mode: 'fast',
        blockOn: 'BLOCKER',
        json: true,
      }),
    ).rejects.toThrow();
  });
});
