import { describe, test, expect } from 'bun:test';
import {
  extractNameAndDescription,
  transformFrontmatter,
  generateOpenAIYaml,
} from '../scripts/resolvers/codex-helpers';

describe('codex helpers', () => {
  test('extractNameAndDescription handles CRLF block scalar frontmatter', () => {
    const content = [
      '---',
      'name: gstack-review',
      'description: |',
      '  Review code for bugs.',
      '  Keep the diff honest.',
      'allowed-tools:',
      '  - Read',
      '---',
      '',
      '# body',
      '',
    ].join('\r\n');

    expect(extractNameAndDescription(content)).toEqual({
      name: 'gstack-review',
      description: 'Review code for bugs.\nKeep the diff honest.',
    });
  });

  test('transformFrontmatter preserves CRLF and strips extra fields for Codex', () => {
    const content = [
      '---',
      'name: gstack-review',
      'description: |',
      '  Review code for bugs.',
      'allowed-tools:',
      '  - Read',
      'version: 1.0.0',
      '---',
      '',
      'Body line one.',
      '',
    ].join('\r\n');

    const output = transformFrontmatter(content, 'codex');

    expect(output.startsWith('---\r\nname: gstack-review\r\ndescription: |\r\n')).toBe(true);
    expect(output).not.toContain('allowed-tools:');
    expect(output).not.toContain('version:');
    expect(output).toContain('\r\nBody line one.\r\n');
  });

  test('generateOpenAIYaml fills empty short_description with a non-empty fallback', () => {
    const content = generateOpenAIYaml('gstack-review', '');

    expect(content).toContain('display_name: "gstack-review"');
    expect(content).toContain('short_description: "Use gstack-review for this task."');
    expect(content).toContain('allow_implicit_invocation: true');
  });
});
