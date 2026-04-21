/**
 * ESLint rule: no-react-type-import
 *
 * Disallows importing types from 'react' and autofixes to use `React.Foo`
 * (which is available via the React UMD global) instead.
 */
import type {TSESLint, TSESTree} from '@typescript-eslint/utils';
import {AST_NODE_TYPES, ESLintUtils} from '@typescript-eslint/utils';

function isTypeSpecifier(
  spec: TSESTree.ImportSpecifier,
  declIsTypeOnly: boolean
): boolean {
  return declIsTypeOnly || spec.importKind === 'type';
}

function findVariable(
  sourceCode: TSESLint.SourceCode,
  localName: string,
  spec: TSESTree.ImportSpecifier
): TSESLint.Scope.Variable | undefined {
  const scopeManager = sourceCode.scopeManager;
  if (!scopeManager) return undefined;
  const stack: TSESLint.Scope.Scope[] = [...scopeManager.scopes];
  while (stack.length) {
    const scope = stack.pop()!;
    const match = scope.variables.find(
      v => v.name === localName && v.defs.some(d => d.node === spec)
    );
    if (match) return match;
    if (scope.childScopes) stack.push(...scope.childScopes);
  }
  return undefined;
}

export const noReactTypeImport = ESLintUtils.RuleCreator.withoutDocs({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Prefer `React.Foo` over importing types from "react" — React is available as a UMD global.',
    },
    fixable: 'code',
    schema: [],
    messages: {
      forbidden: 'Prefer `React.{{name}}` over importing `{{name}}` from "react".',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      ImportDeclaration(node) {
        if (node.source.value !== 'react') return;

        const declIsTypeOnly = node.importKind === 'type';
        const namedSpecs = node.specifiers.filter(
          (spec): spec is TSESTree.ImportSpecifier =>
            spec.type === AST_NODE_TYPES.ImportSpecifier
        );
        const typeSpecs = namedSpecs.filter(s => isTypeSpecifier(s, declIsTypeOnly));
        if (typeSpecs.length === 0) return;

        const nonTypeNamedSpecs = namedSpecs.filter(
          s => !isTypeSpecifier(s, declIsTypeOnly)
        );
        const defaultOrNamespace = node.specifiers.find(
          s => s.type !== AST_NODE_TYPES.ImportSpecifier
        );
        const allNamedAreTypes = nonTypeNamedSpecs.length === 0;

        // Emit one report per offending specifier so authors see each
        // violation individually. To avoid ESLint merging multiple reports'
        // fix rangehulls and marking them as conflicting (which can skip
        // fixes silently when references live far from the import), we
        // place ALL autofixes on the first report and leave subsequent
        // reports fix-less. This yields one rangehull per ImportDeclaration
        // covering the import plus all references.
        for (let i = 0; i < typeSpecs.length; i++) {
          const spec = typeSpecs[i]!;
          const localName = spec.local.name;
          const importedName =
            spec.imported.type === AST_NODE_TYPES.Identifier
              ? spec.imported.name
              : localName;
          const isFirst = i === 0;

          context.report({
            node: spec,
            messageId: 'forbidden',
            data: {name: importedName},
            fix: isFirst ? fixer => buildDeclarationFixes(fixer, node) : undefined,
          });
        }

        function buildDeclarationFixes(
          fixer: TSESLint.RuleFixer,
          declNode: TSESTree.ImportDeclaration
        ): TSESLint.RuleFix[] {
          const fixes: TSESLint.RuleFix[] = [];

          // Reference replacements for every offending specifier.
          for (const spec of typeSpecs) {
            const localName = spec.local.name;
            const importedName =
              spec.imported.type === AST_NODE_TYPES.Identifier
                ? spec.imported.name
                : localName;
            const variable = findVariable(sourceCode, localName, spec);
            if (!variable) continue;
            for (const ref of variable.references) {
              if (ref.identifier === spec.local) continue;
              fixes.push(fixer.replaceText(ref.identifier, `React.${importedName}`));
            }
          }

          // Import statement mutation.
          if (allNamedAreTypes && !defaultOrNamespace) {
            // Whole declaration is type-only imports — drop the line.
            const text = sourceCode.getText();
            let end = declNode.range[1];
            if (text[end] === '\n') end++;
            fixes.push(fixer.removeRange([declNode.range[0], end]));
          } else if (allNamedAreTypes && defaultOrNamespace) {
            // `import React, {type Foo, type Bar} from 'react'` →
            // drop everything after the default/namespace specifier
            // through the closing brace.
            const lastNamed = namedSpecs[namedSpecs.length - 1]!;
            const closeBrace = sourceCode.getTokenAfter(lastNamed, {
              filter: t => t.value === '}',
            });
            if (closeBrace) {
              fixes.push(
                fixer.removeRange([defaultOrNamespace.range[1], closeBrace.range[1]])
              );
            }
          } else {
            // Mixed named specs — coalesce adjacent type specs into
            // single non-overlapping removal ranges.
            const typeIndices = typeSpecs.map(s => namedSpecs.indexOf(s));
            const runs: Array<[number, number]> = [];
            for (const idx of typeIndices) {
              const last = runs[runs.length - 1];
              if (last?.[1] === idx - 1) {
                last[1] = idx;
              } else {
                runs.push([idx, idx]);
              }
            }
            for (const [a, b] of runs) {
              const next = namedSpecs[b + 1];
              const prev = namedSpecs[a - 1];
              if (next) {
                fixes.push(fixer.removeRange([namedSpecs[a]!.range[0], next.range[0]]));
              } else if (prev) {
                fixes.push(fixer.removeRange([prev.range[1], namedSpecs[b]!.range[1]]));
              } else {
                fixes.push(fixer.remove(namedSpecs[a]!));
              }
            }
          }

          return fixes;
        }
      },
    };
  },
});
