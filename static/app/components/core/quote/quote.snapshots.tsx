import {ThemeProvider} from '@emotion/react';

// eslint-disable-next-line @sentry/scraps/no-core-import -- SSR snapshot needs direct import to avoid barrel re-exports with heavy deps
import {Quote} from 'sentry/components/core/quote/quote';
// eslint-disable-next-line no-restricted-imports -- SSR snapshot rendering needs direct theme access
import {darkTheme, lightTheme} from 'sentry/utils/theme/theme';

const themes = {light: lightTheme, dark: darkTheme};

describe('Quote', () => {
  describe.each(['light', 'dark'] as const)('%s', themeName => {
    it.snapshot('default', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <Quote>This is a blockquote with some example text content.</Quote>
        </div>
      </ThemeProvider>
    ));

    it.snapshot('with-source-author', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <Quote source={{author: 'Jane Doe'}}>
            This is a blockquote attributed to an author.
          </Quote>
        </div>
      </ThemeProvider>
    ));

    it.snapshot('with-source-author-and-label', () => (
      <ThemeProvider theme={themes[themeName]}>
        <div style={{padding: 8, width: 400}}>
          <Quote source={{author: 'Jane Doe', label: 'On Software'}}>
            This is a blockquote with an author and citation label.
          </Quote>
        </div>
      </ThemeProvider>
    ));
  });
});
