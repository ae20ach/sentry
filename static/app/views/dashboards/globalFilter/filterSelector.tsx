import {useEffect, useMemo, useRef, useState} from 'react';
import styled from '@emotion/styled';
import isEqual from 'lodash/isEqual';
import xor from 'lodash/xor';

import {Button} from '@sentry/scraps/button';
import {Checkbox} from '@sentry/scraps/checkbox';
import {
  CompactSelect,
  MenuComponents,
  type SelectOption,
} from '@sentry/scraps/compactSelect';
import {Container, Flex} from '@sentry/scraps/layout';
import {OverlayTrigger} from '@sentry/scraps/overlayTrigger';
import {Text} from '@sentry/scraps/text';

import {DropdownMenu} from 'sentry/components/dropdownMenu';
import {usePageFilters} from 'sentry/components/pageFilters/usePageFilters';
import {useStagedCompactSelect} from 'sentry/components/pageFilters/useStagedCompactSelect';
import {
  modifyFilterOperatorQuery,
  modifyFilterValue,
} from 'sentry/components/searchQueryBuilder/hooks/useQueryBuilderState';
import {getOperatorInfo} from 'sentry/components/searchQueryBuilder/tokens/filter/filterOperator';
import {
  escapeTagValue,
  getFilterValueType,
  OP_LABELS,
} from 'sentry/components/searchQueryBuilder/tokens/filter/utils';
import {
  getInitialInputValue,
  getPredefinedValues,
  getSelectedValuesFromText,
  prepareInputValueForSaving,
  tokenSupportsMultipleValues,
} from 'sentry/components/searchQueryBuilder/tokens/filter/valueCombobox';
import {TermOperator} from 'sentry/components/searchSyntax/parser';
import {IconChevron} from 'sentry/icons';
import {t} from 'sentry/locale';
import {prettifyTagKey} from 'sentry/utils/fields';
import {keepPreviousData, useQuery} from 'sentry/utils/queryClient';
import {middleEllipsis} from 'sentry/utils/string/middleEllipsis';
import {useDebouncedValue} from 'sentry/utils/useDebouncedValue';
import {type SearchBarData} from 'sentry/views/dashboards/datasetConfig/base';
import {getDatasetLabel} from 'sentry/views/dashboards/globalFilter/addFilter';
import {
  FilterSelectorTrigger,
  FilterValueTruncated,
} from 'sentry/views/dashboards/globalFilter/filterSelectorTrigger';
import {
  buildNoValueFilterQuery,
  getFieldDefinitionForDataset,
  getFilterToken,
  getValueFilterToken,
  hasNoValueFilter,
  NO_VALUE_SENTINEL,
  NO_VALUE_SUPPORTED_OPERATORS,
  parseFilterValue,
} from 'sentry/views/dashboards/globalFilter/utils';
import {WidgetType, type GlobalFilter} from 'sentry/views/dashboards/types';
import {
  SpanFields,
  subregionCodeToName,
  type SubregionCode,
} from 'sentry/views/insights/types';

type FilterSelectorProps = {
  globalFilter: GlobalFilter;
  onRemoveFilter: (filter: GlobalFilter) => void;
  onUpdateFilter: (filter: GlobalFilter) => void;
  searchBarData: SearchBarData;
  disableRemoveFilter?: boolean;
};

export function FilterSelector({
  globalFilter,
  searchBarData,
  onRemoveFilter,
  onUpdateFilter,
  disableRemoveFilter,
}: FilterSelectorProps) {
  const {selection} = usePageFilters();

  // Ref to break the circular dependency: options need toggleOption, but toggleOption
  // comes from useStagedCompactSelect which depends on options.
  const toggleOptionRef = useRef<((val: string) => void) | undefined>(undefined);
  // Ref to access staged select value from operator onClick without circular deps
  const stagedValueRef = useRef<string[]>([]);

  const {fieldDefinition, filterToken} = useMemo(() => {
    const fieldDef = getFieldDefinitionForDataset(globalFilter.tag, globalFilter.dataset);

    // For filters containing !has: (either standalone or compound with OR),
    // we need a value-based filter token for the UI controls. Parse all tokens
    // and prefer the value filter (non-HAS) one; fall back to a default token.
    const allTokens = globalFilter.value
      ? parseFilterValue(globalFilter.value, globalFilter)
      : [];
    const containsNoValue = hasNoValueFilter(allTokens);
    const valueToken = containsNoValue ? getValueFilterToken(allTokens) : null;

    return {
      fieldDefinition: fieldDef,
      filterToken:
        valueToken ??
        getFilterToken(
          containsNoValue ? {...globalFilter, value: ''} : globalFilter,
          fieldDef
        ),
    };
  }, [globalFilter]);

  // Get initial selected values from the filter token
  const initialValues = useMemo(() => {
    if (!filterToken) {
      return [];
    }

    // Check if the filter value contains !has: (no value filter)
    const allTokens = globalFilter.value
      ? parseFilterValue(globalFilter.value, globalFilter)
      : [];
    const includesNoValue = hasNoValueFilter(allTokens);

    // Extract values from the non-HAS token
    const valueToken = includesNoValue ? getValueFilterToken(allTokens) : null;
    const tokenForParsing = valueToken ?? filterToken;

    const initialValue =
      globalFilter.value && !includesNoValue
        ? getInitialInputValue(tokenForParsing, true)
        : valueToken
          ? getInitialInputValue(valueToken, true)
          : '';

    const selectedValues = getSelectedValuesFromText(initialValue, {escaped: false});
    const values = selectedValues.map(item => item.value);

    if (includesNoValue) {
      values.push(NO_VALUE_SENTINEL);
    }

    return values;
  }, [filterToken, globalFilter]);

  // Get operator info from the filter token
  const {initialOperator, operatorDropdownItems} = useMemo(() => {
    if (!filterToken) {
      return {
        initialOperator: TermOperator.DEFAULT,
        operatorDropdownItems: [],
      };
    }

    const operatorInfo = getOperatorInfo({filterToken, fieldDefinition});

    return {
      initialOperator: operatorInfo?.operator ?? TermOperator.DEFAULT,
      operatorDropdownItems: (operatorInfo?.options ?? []).map(option => ({
        ...option,
        key: option.value,
        label: option.label,
        textValue: option.textValue,
        onClick: () => {
          setStagedOperator(option.value);
          // Deselect "(no value)" when switching to an unsupported operator,
          // but only if it's currently selected (toggle would re-select it otherwise)
          if (
            !NO_VALUE_SUPPORTED_OPERATORS.has(option.value) &&
            stagedValueRef.current.includes(NO_VALUE_SENTINEL)
          ) {
            toggleOptionRef.current?.(NO_VALUE_SENTINEL);
          }
        },
      })),
    };
  }, [filterToken, fieldDefinition]);

  const [stagedOperator, setStagedOperator] = useState<TermOperator>(initialOperator);
  const [activeFilterValues, setActiveFilterValues] = useState<string[]>(initialValues);
  const [stagedFilterValues, setStagedFilterValues] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    setActiveFilterValues(initialValues);
    setStagedFilterValues([]);
  }, [initialValues]);

  // Retrieve full tag definition to check if it has predefined values
  const datasetFilterKeys = searchBarData.getFilterKeys();
  const fullTag = datasetFilterKeys[globalFilter.tag.key];

  const canSelectMultipleValues = filterToken
    ? tokenSupportsMultipleValues(filterToken, datasetFilterKeys, fieldDefinition)
    : true;

  // Retrieve predefined values if the tag has any
  const predefinedValues = useMemo(() => {
    if (!filterToken) {
      return null;
    }
    const filterValue = filterToken.value.text;
    return getPredefinedValues({
      key: fullTag,
      filterValue,
      token: filterToken,
      fieldDefinition,
    });
  }, [fullTag, filterToken, fieldDefinition]);

  // Only fetch values if the tag has no predefined values
  const shouldFetchValues = fullTag
    ? !fullTag.predefined && predefinedValues === null
    : true;

  const baseQueryKey = useMemo(
    () =>
      [
        'global-dashboard-filters-tag-values',
        {
          key: globalFilter.tag.key,
          name: globalFilter.tag.name,
          kind: globalFilter.tag.kind,
        },
        selection,
        searchQuery,
      ] as const,
    [
      globalFilter.tag.key,
      globalFilter.tag.name,
      globalFilter.tag.kind,
      selection,
      searchQuery,
    ]
  );
  const queryKey = useDebouncedValue(baseQueryKey);

  const queryResult = useQuery({
    queryKey,
    queryFn: async ctx => {
      const result = await searchBarData.getTagValues(ctx.queryKey[1], ctx.queryKey[3]);
      return result ?? [];
    },
    placeholderData: keepPreviousData,
    enabled: shouldFetchValues,
    staleTime: 5 * 60 * 1000,
  });

  const {data: fetchedFilterValues, isFetching} = queryResult;

  const options = useMemo((): Array<SelectOption<string>> => {
    if (predefinedValues && !canSelectMultipleValues) {
      return predefinedValues.flatMap(section =>
        section.suggestions.map(suggestion => ({
          label: suggestion.value,
          value: suggestion.value,
        }))
      );
    }

    const optionMap = new Map<string, SelectOption<string>>();
    const fixedOptionMap = new Map<string, SelectOption<string>>();
    const addOption = (value: string, map: Map<string, SelectOption<string>>) => {
      const option: SelectOption<string> = {
        label: middleEllipsis(value, 70, /[\s-_:]/),
        value,
      };

      // Only add checkboxes for multi-select mode
      if (canSelectMultipleValues) {
        option.leadingItems = ({isSelected}: {isSelected: boolean}) => (
          <Checkbox
            checked={isSelected}
            onChange={() => toggleOptionRef.current?.(value)}
            aria-label={t('Select %s', value)}
            tabIndex={-1}
          />
        );
      }

      return map.set(value, option);
    };

    // Filter values in the global filter (skip the no-value sentinel, it's added separately)
    activeFilterValues
      .filter(value => value !== NO_VALUE_SENTINEL)
      .forEach(value => addOption(value, optionMap));

    // Predefined values
    predefinedValues?.forEach(suggestionSection => {
      suggestionSection.suggestions.forEach(suggestion =>
        addOption(suggestion.value, optionMap)
      );
    });
    // Filter values fetched using getTagValues
    fetchedFilterValues?.forEach(value => addOption(value, optionMap));

    // Allow setting a custom filter value based on search input
    if (searchQuery && !optionMap.has(searchQuery)) {
      addOption(searchQuery, fixedOptionMap);
    }
    // Staged filter values inside the filter selector
    stagedFilterValues.forEach(value => {
      if (value !== NO_VALUE_SENTINEL && !optionMap.has(value)) {
        addOption(value, fixedOptionMap);
      }
    });
    const allOptions = [
      ...Array.from(fixedOptionMap.values()),
      ...Array.from(optionMap.values()),
    ];

    // Add "(no value)" option at the top for supported operators
    if (NO_VALUE_SUPPORTED_OPERATORS.has(stagedOperator)) {
      const noValueOption: SelectOption<string> = {
        label: <Text variant="muted">{t('(no value)')}</Text>,
        textValue: t('(no value)'),
        value: NO_VALUE_SENTINEL,
      };
      if (canSelectMultipleValues) {
        noValueOption.leadingItems = ({isSelected}: {isSelected: boolean}) => (
          <Checkbox
            checked={isSelected}
            onChange={() => toggleOptionRef.current?.(NO_VALUE_SENTINEL)}
            aria-label={t('Select %s', t('(no value)'))}
            tabIndex={-1}
          />
        );
      }
      allOptions.unshift(noValueOption);
    }

    return allOptions;
  }, [
    fetchedFilterValues,
    predefinedValues,
    activeFilterValues,
    stagedFilterValues,
    searchQuery,
    canSelectMultipleValues,
    stagedOperator,
  ]);

  const translatedOptions = translateKnownFilterOptions(options, globalFilter);

  const handleChange = (rawOpts: string[]) => {
    // Strip the sentinel if the current operator doesn't support it
    const opts = NO_VALUE_SUPPORTED_OPERATORS.has(stagedOperator)
      ? rawOpts
      : rawOpts.filter(opt => opt !== NO_VALUE_SENTINEL);

    if (isEqual(opts, activeFilterValues) && stagedOperator === initialOperator) {
      return;
    }
    if (!filterToken) {
      return;
    }

    setActiveFilterValues(opts);
    if (opts.length === 0) {
      setStagedOperator(TermOperator.DEFAULT);
      onUpdateFilter({
        ...globalFilter,
        value: '',
      });
      return;
    }

    // Separate regular values from the "(no value)" sentinel
    const includeNoValue = opts.includes(NO_VALUE_SENTINEL);
    const valueOpts = opts.filter(opt => opt !== NO_VALUE_SENTINEL);

    // Build the regular value query string (if any regular values exist)
    let valueQuery = '';
    if (valueOpts.length > 0) {
      const cleanedValue = prepareInputValueForSaving(
        getFilterValueType(filterToken, fieldDefinition),
        valueOpts.map(opt => escapeTagValue(opt, {allowArrayValue: false})).join(',')
      );
      valueQuery = modifyFilterValue(filterToken.text, filterToken, cleanedValue);

      if (stagedOperator !== initialOperator) {
        const newToken = parseFilterValue(valueQuery, globalFilter)[0] ?? filterToken;
        valueQuery = modifyFilterOperatorQuery(newToken.text, newToken, stagedOperator);
      }
    }

    // Build the final value, wrapping with OR !has: if "(no value)" is selected
    const noValueQuery = buildNoValueFilterQuery(
      globalFilter.tag.key,
      valueQuery,
      includeNoValue
    );
    const newValue = noValueQuery ?? valueQuery;

    onUpdateFilter({
      ...globalFilter,
      value: newValue,
    });
  };

  const hasOperatorChanges =
    stagedFilterValues.length > 0 && stagedOperator !== initialOperator;

  const stagedSelect = useStagedCompactSelect({
    value: activeFilterValues,
    options: translatedOptions,
    onChange: handleChange,
    onStagedValueChange: setStagedFilterValues,
    multiple: true,
    hasExternalChanges: hasOperatorChanges,
  });

  // Wire up refs after stagedSelect is created to break the circular
  // dependency between options (which need toggleOption) and useStagedCompactSelect
  // (which needs options).
  toggleOptionRef.current = stagedSelect.toggleOption;
  stagedValueRef.current = stagedSelect.value;

  const {dispatch} = stagedSelect;
  const hasStagedChanges =
    xor(stagedSelect.value, activeFilterValues).length > 0 || hasOperatorChanges;

  const renderFilterSelectorTrigger = (filterValues: string[]) => {
    // Strip the sentinel from display when the operator doesn't support it
    const displayValues = NO_VALUE_SUPPORTED_OPERATORS.has(stagedOperator)
      ? filterValues
      : filterValues.filter(v => v !== NO_VALUE_SENTINEL);

    return (
      <FilterSelectorTrigger
        globalFilter={globalFilter}
        activeFilterValues={displayValues}
        operator={stagedOperator}
        options={translatedOptions}
        queryResult={queryResult}
      />
    );
  };

  if (!canSelectMultipleValues) {
    return (
      <CompactSelect
        multiple={false}
        disabled={false}
        options={translatedOptions}
        value={activeFilterValues.length > 0 ? activeFilterValues[0] : undefined}
        onChange={option => {
          const newValue = option?.value;
          handleChange(newValue ? [newValue] : []);
        }}
        onClose={() => {
          setStagedFilterValues([]);
        }}
        menuTitle={
          <MenuTitleWrapper>
            {t('%s Filter', getDatasetLabel(globalFilter.dataset))}
          </MenuTitleWrapper>
        }
        menuHeaderTrailingItems={({closeOverlay}) => (
          <Flex gap="lg">
            {activeFilterValues.length > 0 && (
              <MenuComponents.ClearButton
                onClick={() => {
                  setSearchQuery('');
                  handleChange([]);
                }}
              />
            )}
            {!disableRemoveFilter && (
              <MenuComponents.HeaderButton
                aria-label={t('Remove Filter')}
                onClick={() => {
                  onRemoveFilter(globalFilter);
                  closeOverlay();
                }}
              >
                {t('Remove Filter')}
              </MenuComponents.HeaderButton>
            )}
          </Flex>
        )}
        trigger={triggerProps => (
          <Container maxWidth={FILTER_SELECTOR_MAX_WIDTH}>
            <OverlayTrigger.Button {...triggerProps}>
              {renderFilterSelectorTrigger(activeFilterValues)}
            </OverlayTrigger.Button>
          </Container>
        )}
      />
    );
  }

  return (
    <CompactSelect
      grid
      multiple
      {...stagedSelect.compactSelectProps}
      search={{
        placeholder: t('Search or enter a custom value...'),
        onChange: (searchValue: string) => {
          dispatch({type: 'set search', search: searchValue});
          setSearchQuery(searchValue);
        },
      }}
      disabled={false}
      sizeLimit={30}
      onClose={() => {
        setSearchQuery('');
        setStagedFilterValues(stagedSelect.value);
        setStagedOperator(initialOperator);
      }}
      sizeLimitMessage={t('Use search to find more filter values…')}
      emptyMessage={
        isFetching ? t('Loading filter values...') : t('No filter values found')
      }
      menuFooter={
        hasStagedChanges ? (
          <Flex gap="md" align="center" justify="end">
            <MenuComponents.CancelButton
              onClick={() => dispatch({type: 'remove staged'})}
            />
            <MenuComponents.ApplyButton
              onClick={() => {
                dispatch({type: 'remove staged'});
                handleChange(stagedSelect.value);
              }}
            />
          </Flex>
        ) : null
      }
      menuTitle={
        <MenuTitleWrapper>
          <OperatorFlex>
            <DropdownMenu
              usePortal
              trigger={(triggerProps, isOpen) => (
                <WildcardButton gap="xs" align="center">
                  <FilterValueTruncated>
                    {prettifyTagKey(globalFilter.tag.key)}
                  </FilterValueTruncated>
                  <Button {...triggerProps} size="zero" priority="transparent">
                    <Flex gap="xs" align="center">
                      <SubText>{OP_LABELS[stagedOperator]}</SubText>
                      <IconChevron direction={isOpen ? 'up' : 'down'} size="xs" />
                    </Flex>
                  </Button>
                </WildcardButton>
              )}
              items={operatorDropdownItems}
            />
          </OperatorFlex>
        </MenuTitleWrapper>
      }
      menuHeaderTrailingItems={({closeOverlay}) => (
        <Flex gap="lg">
          {activeFilterValues.length > 0 && (
            <MenuComponents.ClearButton
              onClick={() => {
                setSearchQuery('');
                handleChange([]);
              }}
            />
          )}
          {!disableRemoveFilter && (
            <MenuComponents.HeaderButton
              onClick={() => {
                onRemoveFilter(globalFilter);
                closeOverlay();
              }}
            >
              {t('Remove Filter')}
            </MenuComponents.HeaderButton>
          )}
        </Flex>
      )}
      trigger={triggerProps => (
        <Container maxWidth={FILTER_SELECTOR_MAX_WIDTH}>
          <OverlayTrigger.Button {...triggerProps}>
            {renderFilterSelectorTrigger(activeFilterValues)}
          </OverlayTrigger.Button>
        </Container>
      )}
    />
  );
}

const translateKnownFilterOptions = (
  options: Array<SelectOption<string>>,
  globalFilter: GlobalFilter
) => {
  const key = globalFilter.tag.key;
  const dataset = globalFilter.dataset;

  if (key === SpanFields.USER_GEO_SUBREGION && dataset === WidgetType.SPANS) {
    return options.map(option => ({
      ...option,
      label: subregionCodeToName[option.value as SubregionCode] || option.label,
    }));
  }
  return options;
};

export const FILTER_SELECTOR_MAX_WIDTH = '300px';

export const MenuTitleWrapper = styled('span')`
  display: inline-block;
  padding-top: ${p => p.theme.space.xs};
  padding-bottom: ${p => p.theme.space.xs};
`;

const OperatorFlex = styled(Flex)`
  margin-left: -${p => p.theme.space.sm};
`;

const WildcardButton = styled(Flex)`
  padding: 0 ${p => p.theme.space.md};
`;

const SubText = styled('span')`
  color: ${p => p.theme.tokens.content.secondary};
  font-size: ${p => p.theme.font.size.sm};
`;
