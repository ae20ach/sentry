import {AST_NODE_TYPES, ESLintUtils, type TSESTree} from '@typescript-eslint/utils';

interface PendingReport {
  data: Record<string, string>;
  messageId: 'directlyInvoked' | 'intrinsicElement';
  node: TSESTree.Node;
}

export const noUnnecessaryUseCallback = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Disallow useCallback where it provides no benefit: when the result is directly invoked (defeating memoization) or passed to intrinsic elements (which are not memoized).',
    },
    schema: [],
    messages: {
      directlyInvoked:
        'Unnecessary useCallback. `{{name}}` is immediately called inside an inline arrow function, so the stable reference from useCallback is never used.',
      intrinsicElement:
        'Unnecessary useCallback. `{{name}}` is passed to the intrinsic element `<{{element}}>`, which is not memoized.',
    },
  },
  create(context) {
    const useCallbackBindings = new Set<string>();
    // Bindings that have at least one usage where memoization is justified
    // (e.g. passed directly to a custom component)
    const justifiedBindings = new Set<string>();
    // Potential violations collected during traversal, reported at Program:exit
    const pendingReports = new Map<string, PendingReport[]>();

    function addPendingReport(name: string, report: PendingReport) {
      let reports = pendingReports.get(name);
      if (!reports) {
        reports = [];
        pendingReports.set(name, reports);
      }
      reports.push(report);
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
          useCallbackBindings.add(node.id.name);
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
            addPendingReport(calledBinding, {
              node: node.value,
              messageId: 'directlyInvoked',
              data: {name: calledBinding},
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
            addPendingReport(expr.name, {
              node: node.value,
              messageId: 'intrinsicElement',
              data: {name: expr.name, element: tagName.name},
            });
          } else {
            // Passed directly to a custom component — memoization is justified
            justifiedBindings.add(expr.name);
          }
        }
      },

      'Program:exit'() {
        for (const [name, reports] of pendingReports) {
          if (justifiedBindings.has(name)) {
            continue;
          }
          for (const report of reports) {
            context.report(report);
          }
        }
      },
    };
  },
});
