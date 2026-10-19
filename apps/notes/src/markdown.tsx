import { useEffect, useMemo, useState } from 'react';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export function MarkdownEditor({ value, onChange, fontSize, theme }: {
  value: string;
  onChange: (value: string) => void;
  fontSize: number;
  theme: string;
}) {
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const change = () => setSystemDark(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  const extensions = useMemo(() => [
    markdown({ codeLanguages: languages }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': '笔记内容' }),
    EditorView.theme({
      '&': { backgroundColor: 'transparent', color: 'var(--text)', fontSize: `${fontSize}px` },
      '.cm-scroller': { fontFamily: 'inherit', lineHeight: '1.9' },
      '.cm-content': { padding: '20px 0', caretColor: 'var(--text)' },
      '.cm-line': { padding: '0' },
      '&.cm-focused': { outline: 'none' },
      '.cm-cursor': { borderLeftColor: 'var(--text)' },
      '.cm-gutters': { display: 'none' },
    }),
  ], [fontSize]);
  return <CodeMirror
    className="markdown-editor"
    value={value}
    onChange={onChange}
    extensions={extensions}
    theme={theme === 'dark' || (theme === 'system' && systemDark) ? 'dark' : 'light'}
    minHeight="calc(100dvh - 280px)"
    placeholder="开始记录…支持 Markdown 格式"
    basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false }}
  />;
}

export function MarkdownPreview({ body }: { body: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true }]]}
    components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}
  >{body}</ReactMarkdown>;
}
