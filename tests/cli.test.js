import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCli, formatProfiles, formatPostSuccess } from '../buffer.js';

describe('buffer CLI', () => {
  let logSpy;
  let errSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('formats connected profiles output', () => {
    const output = formatProfiles([{ id: 'abc123', service: 'Twitter', username: 'learnopenclaw' }]);
    expect(output).toContain('Connected Profiles');
    expect(output).toContain('abc123');
    expect(output).toContain('Twitter');
  });

  it('executes profiles command', async () => {
    const getProfiles = vi.fn().mockResolvedValue([{ id: '1', service: 'LinkedIn', username: 'ahmad' }]);
    const cli = createCli({ api: { getProfiles } });

    await cli.parseAsync(['node', 'buffer', 'profiles']);

    expect(getProfiles).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Connected Profiles'));
  });

  it('creates a post with --profile', async () => {
    const createPost = vi.fn().mockResolvedValue({
      id: 'post_1',
      text: 'Hello world',
      profiles: [{ service: 'twitter' }],
    });
    const cli = createCli({ api: { createPost } });

    await cli.parseAsync(['node', 'buffer', 'post', 'Hello world', '--profile', 'twitter_profile_id']);

    expect(createPost).toHaveBeenCalledWith({
      text: 'Hello world',
      profileIds: ['twitter_profile_id'],
      queue: false,
    });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Post created successfully'));
  });

  it('creates a post with --profiles and --time', async () => {
    const createPost = vi.fn().mockResolvedValue({
      id: 'post_2',
      text: 'Scheduled',
      scheduledAt: '2026-03-03T14:00:00.000Z',
      profiles: [{ service: 'twitter' }, { service: 'linkedin' }],
    });
    const cli = createCli({ api: { createPost } });

    await cli.parseAsync([
      'node',
      'buffer',
      'post',
      'Scheduled',
      '--profiles',
      'twitter_id,linkedin_id',
      '--time',
      '2026-03-03T14:00:00Z',
    ]);

    expect(createPost).toHaveBeenCalledWith({
      text: 'Scheduled',
      profileIds: ['twitter_id', 'linkedin_id'],
      queue: false,
      scheduledAt: '2026-03-03T14:00:00.000Z',
    });
  });

  it('uses all connected profiles with --all', async () => {
    const getProfiles = vi.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
    const createPost = vi.fn().mockResolvedValue({ id: 'post_3', text: 'All profiles', profiles: [] });
    const cli = createCli({ api: { getProfiles, createPost } });

    await cli.parseAsync(['node', 'buffer', 'post', 'All profiles', '--all', '--queue']);

    expect(getProfiles).toHaveBeenCalled();
    expect(createPost).toHaveBeenCalledWith({
      text: 'All profiles',
      profileIds: ['p1', 'p2'],
      queue: true,
    });
  });

  it('formats post success output', () => {
    const output = formatPostSuccess({
      id: 'post_123',
      text: 'Hello Buffer',
      scheduledAt: '2026-03-03T14:00:00.000Z',
      profiles: [{ service: 'Twitter' }],
    });

    expect(output).toContain('Post created successfully');
    expect(output).toContain('post_123');
    expect(output).toContain('Twitter');
  });
});
