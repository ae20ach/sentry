import {useState} from 'react';

import {useHotkeys} from '@sentry/scraps/hotkey';

interface Props {
  /**
   * The currently impersonated username (i.e. who we're viewing as).
   */
  currentUsername: string;
  /**
   * The actual logged-in superuser username.
   */
  actualUsername: string;
  /**
   * CSRF token for the switch-user form.
   */
  csrfToken: string;
}

/**
 * ViewAsBar — superuser "view as" toolbar.
 *
 * Replaces the legacy vanilla-JS implementation in viewas/header.html.
 * Uses `useHotkeys` from @sentry/scraps so the hotkey is automatically
 * suppressed when an input or textarea has focus.
 *
 * Toggle shortcut: cmd+` (Mac) / ctrl+` (non-Mac)
 */
function ViewAsBar({currentUsername, actualUsername, csrfToken}: Props) {
  const [visible, setVisible] = useState(false);

  useHotkeys([
    {
      match: ['command+`', 'ctrl+`'],
      callback: () => setVisible(v => !v),
      // explicitly do NOT set includeInputs — default false means inputs are ignored
    },
  ]);

  if (!visible) {
    return null;
  }

  const isImpersonating = actualUsername && actualUsername !== currentUsername;

  return (
    <div
      id="login_as"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 35,
        lineHeight: '34px',
        color: '#ccc',
        margin: 0,
        padding: '3px 15px',
        background: '#222',
        border: '3px solid #000',
        borderWidth: '3px 0',
        boxSizing: 'content-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontFamily: 'arial, helvetica, sans-serif',
        fontSize: 13,
      }}
    >
      <div style={{overflow: 'hidden', whiteSpace: 'nowrap'}}>
        You are logged in as <strong style={{color: '#fff'}}>{currentUsername}</strong>
        {isImpersonating && (
          <span>
            {' '}(acting as <strong style={{color: '#fff'}}>{actualUsername}</strong>)
          </span>
        )}
      </div>
      <form method="POST" style={{display: 'flex', alignItems: 'center', gap: 4}}>
        <input type="hidden" name="csrfmiddlewaretoken" value={csrfToken} />
        <span style={{color: '#ccc'}}>Switch user:</span>
        <input
          type="text"
          name="login_as"
          defaultValue={currentUsername}
          style={{
            border: 0,
            margin: '0 3px',
            padding: 0,
            height: 'auto',
            lineHeight: 1,
            width: 120,
            background: 'inherit',
            outline: 0,
            borderBottom: '1px solid #aaa',
            boxShadow: 'none',
            color: '#fff',
            fontSize: 13,
            fontFamily: 'arial, helvetica, sans-serif',
          }}
        />
        <input
          type="submit"
          value="Go"
          style={{
            fontSize: 11,
            padding: '0 8px',
            height: 'auto',
            lineHeight: '22px',
            display: 'inline-block',
            verticalAlign: 'middle',
            textTransform: 'uppercase',
            textAlign: 'center',
            borderRadius: 3,
            background: 'inherit',
            border: 0,
            color: '#ccc',
            fontWeight: 'bold',
            cursor: 'pointer',
          }}
        />
        {isImpersonating && (
          <input
            type="submit"
            value="Logout"
            onClick={e => {
              const form = (e.target as HTMLInputElement).form!;
              (form.elements.namedItem('login_as') as HTMLInputElement).value = '';
            }}
            style={{
              fontSize: 11,
              padding: '0 8px',
              height: 'auto',
              lineHeight: '22px',
              display: 'inline-block',
              verticalAlign: 'middle',
              textTransform: 'uppercase',
              textAlign: 'center',
              borderRadius: 3,
              background: 'inherit',
              border: 0,
              color: '#ccc',
              fontWeight: 'bold',
              cursor: 'pointer',
            }}
          />
        )}
      </form>
    </div>
  );
}

export default ViewAsBar;
