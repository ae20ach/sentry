import {RuleTester} from '@typescript-eslint/rule-tester';

import {preferFindBy} from './prefer-find-by';

const ruleTester = new RuleTester();

ruleTester.run('prefer-find-by', preferFindBy, {
  valid: [
    {
      name: 'already using findByText',
      code: `expect(await screen.findByText('foo')).toBeInTheDocument();`,
    },
    {
      name: 'mock assertion inside waitFor (no getBy)',
      code: `await waitFor(() => { expect(mockFn).toHaveBeenCalled(); });`,
    },
    {
      name: 'queryByText for absence check',
      code: `await waitFor(() => { expect(screen.queryByText('foo')).not.toBeInTheDocument(); });`,
    },
    {
      name: 'queryAllBy for absence check',
      code: `await waitFor(() => { expect(screen.queryAllByText('foo')).toHaveLength(0); });`,
    },
    {
      name: 'multiple expect statements',
      code: `await waitFor(() => { expect(screen.getByText('a')).toBeInTheDocument(); expect(screen.getByText('b')).toBeInTheDocument(); });`,
    },
    {
      name: 'multi-statement with variable assignment and sibling traversal',
      code: `
        await waitFor(() => {
          const term = screen.getByText('Sample Rate:');
          const definition = term.nextElementSibling;
          expect(definition).toHaveTextContent('75%');
        });
      `,
    },
    {
      name: 'function reference passed to waitFor',
      code: `
        const check = () => expect(screen.getByText('foo')).toBeInTheDocument();
        await waitFor(check);
      `,
    },
    {
      name: 'custom function call inside waitFor',
      code: `await waitFor(() => myCustomFunction());`,
    },
    {
      name: 'async arrow callback (uses await internally)',
      code: `await waitFor(async () => { expect(await screen.findByText('foo')).toBeInTheDocument(); });`,
    },
    {
      name: 'chained access on getBy result (.closest)',
      code: `await waitFor(() => { expect(screen.getByText('foo').closest('a')).toHaveAttribute('href', '/link'); });`,
    },
    {
      name: 'indexed getAllBy with property access',
      code: `await waitFor(() => { expect(screen.getAllByTestId('item')[0].textContent).toBeTruthy(); });`,
    },
    {
      name: 'getBy result assigned then used with other operations',
      code: `
        await waitFor(() => {
          const el = screen.getByText('foo');
          doSomething(el);
          expect(el).toBeInTheDocument();
        });
      `,
    },
    {
      name: 'waitFor with return statement (not an ExpressionStatement)',
      code: `await waitFor(() => { return screen.getByText('foo'); });`,
    },
    {
      name: 'bare getBy inside waitFor without expect (handled by community rule)',
      code: `await waitFor(() => screen.getByText('foo'));`,
    },
    {
      name: 'expect wrapping a non-getBy call',
      code: `await waitFor(() => { expect(container.querySelector('.foo')).toBeInTheDocument(); });`,
    },
    {
      name: 'getBy on unknown receiver (not screen or within)',
      code: `await waitFor(() => { expect(view.getByText('foo')).toBeInTheDocument(); });`,
    },
  ],

  invalid: [
    // --- Body style variants ---
    {
      name: 'block body with toBeInTheDocument',
      code: `await waitFor(() => { expect(screen.getByText('foo')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByText('foo')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'expression body single line',
      code: `await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());`,
      output: `expect(await screen.findByRole('button')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'expression body with newline',
      code: `await waitFor(() =>
  expect(screen.getByRole('button', {name: 'Reset'})).toBeDisabled()
);`,
      output: `expect(await screen.findByRole('button', {name: 'Reset'})).toBeDisabled();`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- Assertion variants ---
    {
      name: 'toBeDisabled assertion',
      code: `await waitFor(() => { expect(screen.getByRole('button', {name: /set as default/i})).toBeDisabled(); });`,
      output: `expect(await screen.findByRole('button', {name: /set as default/i})).toBeDisabled();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'toBeEnabled assertion',
      code: `await waitFor(() => { expect(screen.getByText('Select Dashboard')).toBeEnabled(); });`,
      output: `expect(await screen.findByText('Select Dashboard')).toBeEnabled();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'toHaveFocus assertion',
      code: `await waitFor(() => expect(screen.getByRole('option', {name: 'Option One'})).toHaveFocus());`,
      output: `expect(await screen.findByRole('option', {name: 'Option One'})).toHaveFocus();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'toHaveTextContent assertion',
      code: `await waitFor(() => { expect(screen.getByTestId('count')).toHaveTextContent('5'); });`,
      output: `expect(await screen.findByTestId('count')).toHaveTextContent('5');`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'toHaveAttribute assertion',
      code: `await waitFor(() => { expect(screen.getByRole('link')).toHaveAttribute('href', '/foo'); });`,
      output: `expect(await screen.findByRole('link')).toHaveAttribute('href', '/foo');`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'negated matcher (.not.toBeDisabled)',
      code: `await waitFor(() => { expect(screen.getByRole('button')).not.toBeDisabled(); });`,
      output: `expect(await screen.findByRole('button')).not.toBeDisabled();`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- Query type variants ---
    {
      name: 'getByTestId',
      code: `await waitFor(() => { expect(screen.getByTestId('my-element')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByTestId('my-element')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getByLabelText',
      code: `await waitFor(() => { expect(screen.getByLabelText('Email')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByLabelText('Email')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getByPlaceholderText',
      code: `await waitFor(() => { expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByPlaceholderText('Search...')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getByDisplayValue',
      code: `await waitFor(() => { expect(screen.getByDisplayValue('hello')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByDisplayValue('hello')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getByAltText',
      code: `await waitFor(() => { expect(screen.getByAltText('logo')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByAltText('logo')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getByTitle',
      code: `await waitFor(() => { expect(screen.getByTitle('Close')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByTitle('Close')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- getAllBy variants ---
    {
      name: 'getAllByText with toHaveLength',
      code: `await waitFor(() => { expect(screen.getAllByText('item')).toHaveLength(3); });`,
      output: `expect(await screen.findAllByText('item')).toHaveLength(3);`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getAllByRole',
      code: `await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(5); });`,
      output: `expect(await screen.findAllByRole('listitem')).toHaveLength(5);`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'getAllByTestId',
      code: `await waitFor(() => { expect(screen.getAllByTestId('row')).toHaveLength(2); });`,
      output: `expect(await screen.findAllByTestId('row')).toHaveLength(2);`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- Scope variants ---
    {
      name: 'within() scope',
      code: `await waitFor(() => { expect(within(container).getByText('foo')).toBeInTheDocument(); });`,
      output: `expect(await within(container).findByText('foo')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'within() with complex container expression',
      code: `await waitFor(() => { expect(within(rows[0]).getByRole('button', {name: 'Edit'})).toBeInTheDocument(); });`,
      output: `expect(await within(rows[0]).findByRole('button', {name: 'Edit'})).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- waitFor options ---
    {
      name: 'waitFor with timeout option (getBy has no options)',
      code: `await waitFor(() => { expect(screen.getByText('Test Item')).toBeInTheDocument(); }, {timeout: 1000});`,
      output: `expect(await screen.findByText('Test Item', undefined, {timeout: 1000})).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'waitFor with timeout+interval options',
      code: `await waitFor(() => { expect(screen.getByText('foo')).toBeInTheDocument(); }, {timeout: 2000, interval: 10});`,
      output: `expect(await screen.findByText('foo', undefined, {timeout: 2000, interval: 10})).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
    {
      name: 'waitFor with options AND getBy has existing options (2 args)',
      code: `await waitFor(() => { expect(screen.getByRole('button', {name: 'Save'})).toBeInTheDocument(); }, {timeout: 5000});`,
      output: `expect(await screen.findByRole('button', {name: 'Save'}, {timeout: 5000})).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- Argument patterns ---
    {
      name: 'regex argument',
      code: `await waitFor(() => { expect(screen.getByText(/loading complete/i)).toBeInTheDocument(); });`,
      output: `expect(await screen.findByText(/loading complete/i)).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },

    // --- Without outer await ---
    {
      name: 'waitFor without await (rare)',
      code: `waitFor(() => { expect(screen.getByText('foo')).toBeInTheDocument(); });`,
      output: `expect(await screen.findByText('foo')).toBeInTheDocument();`,
      errors: [{messageId: 'preferFindBy'}],
    },
  ],
});
