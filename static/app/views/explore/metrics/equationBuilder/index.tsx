import {useCallback, useEffect, useMemo, useRef, useTransition} from 'react';
import isEqual from 'lodash/isEqual';

import {ArithmeticBuilder} from 'sentry/components/arithmeticBuilder';
import {Expression} from 'sentry/components/arithmeticBuilder/expression';
import {
  extractReferenceLabels,
  resolveExpression,
  unresolveExpression,
} from 'sentry/views/explore/metrics/equationBuilder/utils';

/**
 * A component that takes an equation in full resolved form and allows
 * the user to edit it using "references" to refer to the different components
 * of the equation.
 *
 * The references are used to resolve the equation into a format that is
 * compatible with our querying endpoints.
 */
export function EquationBuilder({
  expression,
  referenceMap,
  handleExpressionChange,
  onReferenceLabelsChange,
}: {
  expression: string;
  handleExpressionChange: (expression: Expression) => void;
  onReferenceLabelsChange?: (labels: string[]) => void;
  referenceMap?: Record<string, string>;
}) {
  const [_, startTransition] = useTransition();
  const references = useMemo(
    () => new Set(Object.keys(referenceMap ?? {})),
    [referenceMap]
  );

  // Tracks the reference map that `expression` was last resolved against.
  // When referenceMap changes externally, expression still contains values
  // resolved against the previous map until we re-resolve and the parent updates.
  const expressionMapRef = useRef(referenceMap);
  const mapChanged = !isEqual(expressionMapRef.current, referenceMap);

  const internalExpression = unresolveExpression(
    expression,
    mapChanged ? expressionMapRef.current : referenceMap
  );

  useEffect(() => {
    expressionMapRef.current = referenceMap;
  }, [referenceMap]);

  // Report which labels this equation references after unresolving.
  // Cleans up on unmount so deleted equations don't block metric deletion.
  useEffect(() => {
    const expr = new Expression(internalExpression, references);
    onReferenceLabelsChange?.(extractReferenceLabels(expr));
    return () => {
      onReferenceLabelsChange?.([]);
    };
  }, [internalExpression, references, onReferenceLabelsChange]);

  const handleInternalExpressionChange = useCallback(
    (newExpression: Expression) => {
      startTransition(() => {
        if (newExpression.isValid) {
          handleExpressionChange(resolveExpression(newExpression, referenceMap));
        }
      });
    },
    [handleExpressionChange, referenceMap]
  );

  return (
    <ArithmeticBuilder
      aggregations={[]}
      expression={internalExpression}
      functionArguments={[]}
      getFieldDefinition={() => null}
      references={references}
      setExpression={handleInternalExpressionChange}
    />
  );
}
