import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { markdownRemarkPlugins } from '../src/lib/markdownPlugins';

test('shared markdown plugins parse CJK-adjacent bold and strikethrough', () => {
  const html = renderToStaticMarkup(
    React.createElement(ReactMarkdown, { remarkPlugins: markdownRemarkPlugins }, '中文**粗体**中文，中文~~删除~~中文'),
  );

  assert.match(html, /中文<strong>粗体<\/strong>中文/);
  assert.match(html, /中文<del>删除<\/del>中文/);
});
