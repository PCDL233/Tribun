import { describe, expect, it } from 'vitest';
import { getTreeSitterContext } from '../src/ast-foreign.js';

function changedLines(...lineNos: number[]): Array<{ newLineNo: number | null }> {
  return lineNos.map((newLineNo) => ({ newLineNo }));
}

describe('getTreeSitterContext (Phase 4 多语言函数级上下文)', () => {
  it('extracts the enclosing Python function with parameters', () => {
    const source = [
      'import os',
      '',
      'def transfer(amount, user):',
      '    if amount <= 0:',
      '        raise ValueError("invalid")',
      '    return os.rename(user, user)',
      '',
      'def helper():',
      '    pass',
    ].join('\n');
    const result = getTreeSitterContext(source, changedLines(5), 'python');
    expect(result.signature).toMatchObject({
      name: 'transfer',
      params: ['amount', 'user'],
      isAsync: false,
      range: { startLine: 3, endLine: 6 },
    });
    expect(result.snippet).toContain('raise ValueError');
    expect(result.snippet).not.toContain('def helper');
  });

  it('detects async python functions and extracts classes as containers', () => {
    const source = [
      'async def fetch(client):',
      '    return await client.get("/")',
      '',
      'class Repo:',
      '    def save(self, item):',
      '        return item',
    ].join('\n');
    expect(getTreeSitterContext(source, changedLines(2), 'python').signature).toMatchObject({
      name: 'fetch',
      isAsync: true,
    });
    // 更内层的函数节点胜出（isSmaller 语义）：变更行落在方法体内时提取方法而非外层类
    const methodResult = getTreeSitterContext(source, changedLines(6), 'python');
    expect(methodResult.signature).toMatchObject({ name: 'save', params: ['self', 'item'] });
    expect(methodResult.snippet).toContain('return item');
  });

  it('extracts go functions and methods', () => {
    const goSource = [
      'package main',
      '',
      'import "errors"',
      '',
      'func Transfer(amount int) error {',
      '    if amount <= 0 {',
      '        return errors.New("invalid")',
      '    }',
      '    return nil',
      '}',
    ].join('\n');
    const result = getTreeSitterContext(goSource, changedLines(7), 'go');
    expect(result.signature).toMatchObject({
      name: 'Transfer',
      isAsync: false,
      range: { startLine: 5, endLine: 10 },
    });
    expect(result.snippet).toContain('errors.New');
  });

  it('extracts java methods inside classes', () => {
    const javaSource = [
      'public class Payment {',
      '    public boolean pay(int amount) {',
      '        if (amount <= 0) {',
      '            throw new IllegalArgumentException();',
      '        }',
      '        return true;',
      '    }',
      '}',
    ].join('\n');
    const result = getTreeSitterContext(javaSource, changedLines(4), 'java');
    expect(result.signature).toMatchObject({
      name: 'pay',
      params: ['int amount'],
      range: { startLine: 2, endLine: 7 },
    });
    expect(result.snippet).toContain('IllegalArgumentException');
  });

  it('degrades to empty snippet on syntax errors (解析失败自动降级)', () => {
    const result = getTreeSitterContext(
      'def broken(:\n    pass',
      changedLines(2),
      'python',
    );
    expect(result.snippet).toBe('');
    expect(result.signature).toBeNull();
  });

  it('degrades for unknown languages and missing changed lines', () => {
    expect(getTreeSitterContext('x := 1', changedLines(1), 'rust')).toEqual({
      snippet: '',
      signature: null,
    });
    expect(getTreeSitterContext('x := 1', [], 'go')).toEqual({ snippet: '', signature: null });
  });
});
