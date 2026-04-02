import {ThemeProvider} from '@emotion/react';

// eslint-disable-next-line @sentry/scraps/no-core-import -- SSR snapshot needs direct import to avoid barrel re-exports with heavy deps
import {CodeBlock} from 'sentry/components/core/code/codeBlock';
// eslint-disable-next-line @sentry/scraps/no-core-import -- SSR snapshot needs direct import to avoid barrel re-exports with heavy deps
import {InlineCode} from 'sentry/components/core/code/inlineCode';
// eslint-disable-next-line no-restricted-imports -- SSR snapshot rendering needs direct theme access
import {darkTheme, lightTheme} from 'sentry/utils/theme/theme';

const themes = {light: lightTheme, dark: darkTheme};

describe('InlineCode', () => {
  describe.each(['light', 'dark'] as const)('%s', themeName => {
    it.snapshot.each<'accent' | 'neutral'>(['accent', 'neutral'])(
      'variant-%s',
      variant => (
        <ThemeProvider theme={themes[themeName]}>
          <div style={{padding: 8}}>
            Some text with <InlineCode variant={variant}>inline code</InlineCode> in it.
          </div>
        </ThemeProvider>
      ),
      variant => ({theme: themeName, variant})
    );
  });
});

describe('CodeBlock', () => {
  describe.each(['light', 'dark'] as const)('%s', themeName => {
    it.snapshot('default', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <CodeBlock hideCopyButton>{'const x = 1;\nconsole.log(x);'}</CodeBlock>
        </div>
      </ThemeProvider>
    ));

    it.snapshot('with-filename', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <CodeBlock hideCopyButton filename="example.js">
            {'const x = 1;\nconsole.log(x);'}
          </CodeBlock>
        </div>
      </ThemeProvider>
    ));

    it.snapshot('not-rounded', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <CodeBlock hideCopyButton isRounded={false}>
            {'const x = 1;\nconsole.log(x);'}
          </CodeBlock>
        </div>
      </ThemeProvider>
    ));

    it.snapshot('dark-mode', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <CodeBlock hideCopyButton dark>
            {'const x = 1;\nconsole.log(x);'}
          </CodeBlock>
        </div>
      </ThemeProvider>
    ));
  });
});
