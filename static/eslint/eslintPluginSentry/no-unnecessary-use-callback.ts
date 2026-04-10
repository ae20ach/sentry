import {AST_NODE_TYPES, ESLintUtils, type TSESTree} from '@typescript-eslint/utils';

interface UsageInfo {
  line: number;
  reason: 'directlyInvoked' | 'intrinsicElement';
  element?: string;
}

function formatUsages(usages: UsageInfo[]): string {
  return usages
    .map(u => {
      if (u.reason === 'directlyInvoked') {
        return `directly invoked in line ${u.line}`;
      }
      return `passed to intrinsic element <${u.element}> in line ${u.line}`;
    })
    .join(' and ');
}

export const noUnnecessaryUseCallback = ESLintUtils.RuleCreator.withoutDocs<
  readonly unknown[],
  'unnecessaryUseCallback' | 'removeUseCallback'
>({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow useCallback where it provides no benefit: when the result is directly invoked (defeating memoization) or passed to intrinsic elements (which are not memoized).',
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      unnecessaryUseCallback:
        'Unnecessary useCallback. `{{name}}` is only used in contexts where memoization provides no benefit. It is {{usages}}.',
      removeUseCallback: 'Remove useCallback wrapper.',
    },
  },
  create(context) {
    // Maps binding name to the useCallback() CallExpression node
    const useCallbackBindings = new Map<string, TSESTree.CallExpression>();
    // Bindings that have at least one usage where memoization is justified
    // (e.g. passed directly to a custom component)
    const justifiedBindings = new Set<string>();
    // Collected flagged usages per binding
    const flaggedUsages = new Map<string, UsageInfo[]>();

    function addFlaggedUsage(name: string, usage: UsageInfo) {
      let usages = flaggedUsages.get(name);
      if (!usages) {
        usages = [];
        flaggedUsages.set(name, usages);
      }
      usages.push(usage);
    }

    /**
     * Walks an AST node looking for a CallExpression whose callee is a
     * tracked useCallback binding. Returns the binding name if found.
     * Uses visitorKeys to avoid circular parent references.
     */
    function findCallToBinding(node: TSESTree.Node): string | null {
      if (
        node.type === AST_NODE_TYPES.CallExpression &&
        node.callee.type === AST_NODE_TYPES.Identifier &&
        useCallbackBindings.has(node.callee.name)
      ) {
        return node.callee.name;
      }
      const keys = context.sourceCode.visitorKeys[node.type] ?? [];
      for (const key of keys) {
        const child = node[key as keyof typeof node] as
          | TSESTree.Node
          | TSESTree.Node[]
          | null
          | undefined;
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item) {
              const result = findCallToBinding(item);
              if (result) {
                return result;
              }
            }
          }
        } else if (child) {
          const result = findCallToBinding(child);
          if (result) {
            return result;
          }
        }
      }
      return null;
    }

    return {
      VariableDeclarator(node) {
        if (node.id.type !== AST_NODE_TYPES.Identifier) {
          return;
        }
        if (
          node.init?.type === AST_NODE_TYPES.CallExpression &&
          node.init.callee.type === AST_NODE_TYPES.Identifier &&
          node.init.callee.name === 'useCallback'
        ) {
          useCallbackBindings.set(node.id.name, node.init);
        }
      },

      JSXAttribute(node) {
        if (node.value?.type !== AST_NODE_TYPES.JSXExpressionContainer) {
          return;
        }

        const expr = node.value.expression;

        // Case 1: Arrow function that calls a useCallback binding in its body
        // e.g. onClick={() => fn()}, onClick={(e) => fn(e)},
        //      onClick={() => { fn(); doSomethingElse(); }}
        if (expr.type === AST_NODE_TYPES.ArrowFunctionExpression) {
          const calledBinding = findCallToBinding(expr.body);
          if (calledBinding) {
            addFlaggedUsage(calledBinding, {
              reason: 'directlyInvoked',
              line: node.value.loc.start.line,
            });
            return;
          }
        }

        // Exception: ref props are callback refs that benefit from memoization
        const propName =
          node.name.type === AST_NODE_TYPES.JSXIdentifier ? node.name.name : null;
        if (propName === 'ref') {
          return;
        }

        if (
          expr.type === AST_NODE_TYPES.Identifier &&
          useCallbackBindings.has(expr.name)
        ) {
          const openingElement = node.parent;
          if (openingElement.type !== AST_NODE_TYPES.JSXOpeningElement) {
            return;
          }
          const tagName = openingElement.name;

          if (
            tagName.type === AST_NODE_TYPES.JSXIdentifier &&
            tagName.name[0] === tagName.name[0]?.toLowerCase()
          ) {
            // Case 2: Direct reference on an intrinsic element
            addFlaggedUsage(expr.name, {
              reason: 'intrinsicElement',
              element: tagName.name,
              line: node.value.loc.start.line,
            });
          } else {
            // Passed directly to a custom component — memoization is justified
            justifiedBindings.add(expr.name);
          }
        }
      },

      'Program:exit'() {
        for (const [name, usages] of flaggedUsages) {
          if (justifiedBindings.has(name)) {
            continue;
          }
          const callNode = useCallbackBindings.get(name);
          if (callNode && callNode.arguments.length > 0) {
            const firstArg = callNode.arguments[0];
            const callbackText = context.sourceCode.getText(firstArg);
            context.report({
              node: callNode,
              messageId: 'unnecessaryUseCallback',
              data: {name, usages: formatUsages(usages)},
              suggest: [
                {
                  messageId: 'removeUseCallback',
                  fix(fixer) {
                    return fixer.replaceText(callNode, callbackText);
                  },
                },
              ],
            });
          }
        }
      },
    };
  },
});
