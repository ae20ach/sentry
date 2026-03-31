import {AST_NODE_TYPES, ESLintUtils, type TSESTree} from '@typescript-eslint/utils';

const GET_BY_QUERIES = [
  'getByText',
  'getByRole',
  'getByTestId',
  'getByLabelText',
  'getByPlaceholderText',
  'getByDisplayValue',
  'getByAltText',
  'getByTitle',
] as const;

const GET_ALL_BY_QUERIES = [
  'getAllByText',
  'getAllByRole',
  'getAllByTestId',
  'getAllByLabelText',
  'getAllByPlaceholderText',
  'getAllByDisplayValue',
  'getAllByAltText',
  'getAllByTitle',
] as const;

const ALL_GET_QUERIES = new Set<string>([...GET_BY_QUERIES, ...GET_ALL_BY_QUERIES]);

function getReplacementName(name: string): string {
  if (name.startsWith('getAllBy')) {
    return name.replace('getAllBy', 'findAllBy');
  }
  return name.replace('getBy', 'findBy');
}

/**
 * Checks if a node is a call to screen.getBy* / screen.getAllBy* / within(...).getBy* etc.
 * Returns the method name node if it matches, null otherwise.
 */
function getQueryMethodNode(
  node: TSESTree.Node
): {methodNode: TSESTree.Identifier; queryName: string} | null {
  if (node.type !== AST_NODE_TYPES.CallExpression) {
    return null;
  }

  const callee = node.callee;
  if (callee.type !== AST_NODE_TYPES.MemberExpression) {
    return null;
  }

  const property = callee.property;
  if (property.type !== AST_NODE_TYPES.Identifier) {
    return null;
  }

  if (!ALL_GET_QUERIES.has(property.name)) {
    return null;
  }

  // Must be called on `screen` or `within(...)` (a CallExpression)
  const object = callee.object;
  if (object.type === AST_NODE_TYPES.Identifier && object.name === 'screen') {
    return {methodNode: property, queryName: property.name};
  }

  if (
    object.type === AST_NODE_TYPES.CallExpression &&
    object.callee.type === AST_NODE_TYPES.Identifier &&
    object.callee.name === 'within'
  ) {
    return {methodNode: property, queryName: property.name};
  }

  return null;
}

/**
 * Extracts the single expression from a waitFor callback body.
 * Returns null if the body has multiple statements or isn't a simple expression.
 */
function getSingleExpression(
  callback: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression
): TSESTree.Expression | null {
  const {body} = callback;

  // Expression body: () => expr
  if (body.type !== AST_NODE_TYPES.BlockStatement) {
    return body;
  }

  // Block body with exactly one ExpressionStatement: () => { expr; }
  if (
    body.body.length === 1 &&
    body.body[0]!.type === AST_NODE_TYPES.ExpressionStatement
  ) {
    return body.body[0].expression;
  }

  return null;
}

/**
 * Checks if a node is `expect(<query>).matcher(...)` or `expect(<query>).not.matcher(...)`.
 * Returns the query call node and the expect argument if it matches.
 */
function getExpectWithQuery(node: TSESTree.Expression): {
  queryCall: TSESTree.CallExpression;
  queryMethod: {methodNode: TSESTree.Identifier; queryName: string};
} | null {
  // The outer shape is: someMatcherCall(...)
  if (node.type !== AST_NODE_TYPES.CallExpression) {
    return null;
  }

  // callee is either expect(...).matcher or expect(...).not.matcher
  let expectCall: TSESTree.CallExpression | null = null;

  const callee = node.callee;
  if (callee.type === AST_NODE_TYPES.MemberExpression) {
    const obj = callee.object;

    // expect(...).matcher(...)
    if (
      obj.type === AST_NODE_TYPES.CallExpression &&
      obj.callee.type === AST_NODE_TYPES.Identifier &&
      obj.callee.name === 'expect'
    ) {
      expectCall = obj;
    }

    // expect(...).not.matcher(...)
    if (
      obj.type === AST_NODE_TYPES.MemberExpression &&
      obj.property.type === AST_NODE_TYPES.Identifier &&
      obj.property.name === 'not' &&
      obj.object.type === AST_NODE_TYPES.CallExpression &&
      obj.object.callee.type === AST_NODE_TYPES.Identifier &&
      obj.object.callee.name === 'expect'
    ) {
      expectCall = obj.object;
    }
  }

  if (expectCall?.arguments.length !== 1) {
    return null;
  }

  const expectArg = expectCall.arguments[0]!;
  const queryMethod = getQueryMethodNode(expectArg);
  if (!queryMethod) {
    return null;
  }

  return {
    queryCall: expectArg as TSESTree.CallExpression,
    queryMethod,
  };
}

export const preferFindBy = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Prefer `findBy*` queries over `waitFor` + `getBy*` for waiting on elements.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      preferFindBy:
        'Prefer `{{findByName}}` over `waitFor` + `{{getByName}}`. Use `expect(await {{receiver}}.{{findByName}}(...))` instead.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Match waitFor(...)
        if (
          node.callee.type !== AST_NODE_TYPES.Identifier ||
          node.callee.name !== 'waitFor'
        ) {
          return;
        }

        const callback = node.arguments[0];
        if (!callback) {
          return;
        }

        // Must be an inline arrow or function expression
        if (
          callback.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          callback.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return;
        }

        // Skip async callbacks — they use await internally
        if (callback.async) {
          return;
        }

        const singleExpr = getSingleExpression(callback);
        if (!singleExpr) {
          return;
        }

        const match = getExpectWithQuery(singleExpr);
        if (!match) {
          return;
        }

        const {queryCall, queryMethod} = match;
        const findByName = getReplacementName(queryMethod.queryName);

        // Build the receiver name for the message (screen or within(...))
        const receiverNode = queryCall.callee as TSESTree.MemberExpression;
        const receiver =
          receiverNode.object.type === AST_NODE_TYPES.Identifier
            ? receiverNode.object.name
            : 'within(...)';

        context.report({
          node,
          messageId: 'preferFindBy',
          data: {
            findByName,
            getByName: queryMethod.queryName,
            receiver,
          },
          fix(fixer) {
            const sourceCode = context.sourceCode;
            const waitForOptions = node.arguments[1];

            // Rename getBy* to findBy*
            const fixes: Array<ReturnType<typeof fixer.replaceText>> = [
              fixer.replaceText(queryMethod.methodNode, findByName),
            ];

            // Add `await` before the query call (inside expect)
            fixes.push(fixer.insertTextBefore(queryCall, 'await '));

            // If waitFor has options, append them to the findBy call
            if (waitForOptions) {
              const optionsText = sourceCode.getText(waitForOptions);
              const queryArgs = queryCall.arguments;

              if (queryArgs.length === 0) {
                // findByText() → findByText(undefined, optionsText)
                // Insert before the closing paren of the query call
                fixes.push(
                  fixer.insertTextBeforeRange(
                    [queryCall.range[1] - 1, queryCall.range[1] - 1],
                    `undefined, ${optionsText}`
                  )
                );
              } else if (queryArgs.length === 1) {
                // findByText('foo') → findByText('foo', undefined, optionsText)
                // or findByRole('button', {name: 'x'}) has 2 args
                const lastArg = queryArgs[queryArgs.length - 1]!;
                fixes.push(fixer.insertTextAfter(lastArg, `, undefined, ${optionsText}`));
              } else {
                // Already has 2+ args (e.g. getByRole('button', {name: 'x'}))
                // findBy takes (matcher, queryOptions, waitForOptions)
                const lastArg = queryArgs[queryArgs.length - 1]!;
                fixes.push(fixer.insertTextAfter(lastArg, `, ${optionsText}`));
              }
            }

            // Replace the outer waitFor wrapper with just the inner expression.
            // We need to handle: `await waitFor(() => { expr; })` or `await waitFor(() => expr)`
            // The target node might be wrapped in AwaitExpression
            const outerNode =
              node.parent?.type === AST_NODE_TYPES.AwaitExpression ? node.parent : node;

            const innerText = sourceCode.getText(singleExpr);

            // We can't use replaceText on the outer node and getText on the inner,
            // because our other fixes modify the inner. Instead, replace only the
            // "wrapper" portions: everything before the inner expression and
            // everything after it.
            fixes.push(fixer.removeRange([outerNode.range[0], singleExpr.range[0]]));
            fixes.push(fixer.removeRange([singleExpr.range[1], outerNode.range[1]]));

            return fixes;
          },
        });
      },
    };
  },
});
