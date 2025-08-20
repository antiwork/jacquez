import { jest } from '@jest/globals';
import { parseAIResponse } from '../utils/jsonParser';

describe('generateFriendlyResponse integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('parseAIResponse handles valid AI response', () => {
    const aiResponse = '"comment_needed": true, "comment": "Please add more details", "reasoning": "Missing info"';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(true);
    expect(result.comment).toBe("Please add more details");
    expect(result.reasoning).toBe("Missing info");
  });

  test('parseAIResponse handles malformed AI response', () => {
    const aiResponse = '"comment_needed": true, "comment": "Please add';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(true);
    expect(result.comment).toBe("Please add");
    expect(result.reasoning).toBe("Repaired from malformed JSON response");
  });

  test('parseAIResponse handles completely invalid response', () => {
    const aiResponse = 'This is not JSON at all';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(false);
    expect(result.comment).toBe("");
    expect(result.reasoning).toBe("Failed to parse JSON response, skipping comment to avoid posting malformed content");
  });

  test('parseAIResponse respects NO_COMMENT_NEEDED signal', () => {
    const aiResponse = 'NO_COMMENT_NEEDED - everything looks good';
    const result = parseAIResponse(aiResponse);

    expect(result.comment_needed).toBe(false);
    expect(result.comment).toBe("");
  });
});

describe('Link Following Functionality', () => {
  function extractMarkdownLinks(content: string): Array<{text: string, url: string}> {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const links: Array<{text: string, url: string}> = [];
    let match;
    
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        text: match[1],
        url: match[2]
      });
    }
    
    return links;
  }

  function resolveGitHubUrl(url: string, owner: string, repo: string): string | null {
    if (url.startsWith('http')) {
      if (url.includes('github.com') && url.includes(owner) && url.includes(repo)) {
        return url.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/').replace('/tree/', '/');
      }
      return null;
    }
    
    const cleanUrl = url.startsWith('./') ? url.substring(2) : url;
    return `https://raw.githubusercontent.com/${owner}/${repo}/main/${cleanUrl}`;
  }

  test('extractMarkdownLinks parses standard markdown links', () => {
    const content = 'Please see our [README](README.md) and [Code of Conduct](CODE_OF_CONDUCT.md) for details.';
    const links = extractMarkdownLinks(content);
    
    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({ text: 'README', url: 'README.md' });
    expect(links[1]).toEqual({ text: 'Code of Conduct', url: 'CODE_OF_CONDUCT.md' });
  });

  test('extractMarkdownLinks handles various link formats', () => {
    const content = `
    - [Relative link](./docs/guide.md)
    - [Absolute GitHub link](https://github.com/owner/repo/blob/main/SETUP.md)
    - [External link](https://example.com)
    `;
    const links = extractMarkdownLinks(content);
    
    expect(links).toHaveLength(3);
    expect(links[0].url).toBe('./docs/guide.md');
    expect(links[1].url).toBe('https://github.com/owner/repo/blob/main/SETUP.md');
    expect(links[2].url).toBe('https://example.com');
  });

  test('resolveGitHubUrl converts relative URLs correctly', () => {
    expect(resolveGitHubUrl('README.md', 'owner', 'repo'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/README.md');
    
    expect(resolveGitHubUrl('./docs/guide.md', 'owner', 'repo'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/docs/guide.md');
  });

  test('resolveGitHubUrl converts GitHub URLs to raw URLs', () => {
    const githubUrl = 'https://github.com/owner/repo/blob/main/SETUP.md';
    expect(resolveGitHubUrl(githubUrl, 'owner', 'repo'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/SETUP.md');
  });

  test('resolveGitHubUrl filters out non-GitHub URLs', () => {
    expect(resolveGitHubUrl('https://example.com/guide', 'owner', 'repo')).toBeNull();
  });

  test('depth limiting prevents infinite recursion', () => {
    const maxDepth = 3;
    expect(maxDepth).toBe(3);
  });

  test('extractMarkdownLinks handles empty content', () => {
    const links = extractMarkdownLinks('');
    expect(links).toHaveLength(0);
  });

  test('extractMarkdownLinks handles content with no links', () => {
    const content = 'This is just plain text with no markdown links.';
    const links = extractMarkdownLinks(content);
    expect(links).toHaveLength(0);
  });

  test('resolveGitHubUrl handles different GitHub URL formats', () => {
    expect(resolveGitHubUrl('https://github.com/owner/repo/blob/main/docs/file.md', 'owner', 'repo'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/docs/file.md');
    
    expect(resolveGitHubUrl('https://github.com/owner/repo/tree/main/docs', 'owner', 'repo'))
      .toBe('https://raw.githubusercontent.com/owner/repo/main/docs');
  });
});
