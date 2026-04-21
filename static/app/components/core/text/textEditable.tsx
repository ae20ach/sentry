import {useEffect, useReducer, useRef} from 'react';

import {Button} from '@sentry/scraps/button';
import {Input} from '@sentry/scraps/input';
import {Flex, type Responsive} from '@sentry/scraps/layout';

import {IconEdit} from 'sentry/icons/iconEdit';
import type {FormSize, TextSize} from 'sentry/utils/theme';

import {Text, type BaseTextProps} from './text';

type ButtonSize = 'zero' | 'xs' | 'sm' | 'md';

interface SizeConfig {
  editButtonSize: ButtonSize;
  inputSize: FormSize;
  saveButtonSize: ButtonSize;
}

const SIZE_CONFIG: Record<TextSize, SizeConfig> = {
  xs: {inputSize: 'xs', saveButtonSize: 'xs', editButtonSize: 'xs'},
  sm: {inputSize: 'xs', saveButtonSize: 'xs', editButtonSize: 'xs'},
  md: {inputSize: 'sm', saveButtonSize: 'sm', editButtonSize: 'xs'},
  lg: {inputSize: 'sm', saveButtonSize: 'sm', editButtonSize: 'sm'},
  xl: {inputSize: 'md', saveButtonSize: 'md', editButtonSize: 'sm'},
  '2xl': {inputSize: 'md', saveButtonSize: 'md', editButtonSize: 'md'},
};

const DEFAULT_SIZE_CONFIG: SizeConfig = SIZE_CONFIG.md;

function getSizeConfig(size: Responsive<TextSize> | undefined): SizeConfig {
  if (typeof size === 'string') {
    return SIZE_CONFIG[size] ?? DEFAULT_SIZE_CONFIG;
  }
  return DEFAULT_SIZE_CONFIG;
}

export interface TextEditableProps extends BaseTextProps {
  /**
   * The current text value to display and edit.
   */
  children: string;
  /**
   * Called when the user commits a new value via Enter key or Save button.
   */
  onChange: (value: string) => void;
  /**
   * Placeholder shown when value is empty.
   */
  placeholder?: string;
  /**
   * Controls the font size of the displayed text.
   */
  size?: Responsive<TextSize>;
}

type State = {isEditing: false} | {draft: string; isEditing: true};

type Action =
  | {initialValue: string; type: 'edit'}
  | {draft: string; type: 'update'}
  | {type: 'cancel'}
  | {type: 'save'};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'edit':
      return {isEditing: true, draft: action.initialValue};
    case 'update':
      if (!state.isEditing) {
        return state;
      }
      return {isEditing: true, draft: action.draft};
    case 'cancel':
    case 'save':
      return {isEditing: false};
    default:
      return state;
  }
}

export function TextEditable({
  children,
  onChange,
  placeholder,
  size,
  ...textProps
}: TextEditableProps) {
  const {inputSize, saveButtonSize, editButtonSize} = getSizeConfig(size);
  const [state, dispatch] = useReducer(reducer, {isEditing: false});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.isEditing) {
      inputRef.current?.focus();
    }
  }, [state.isEditing]);

  function handleEdit() {
    dispatch({type: 'edit', initialValue: children});
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (state.isEditing) {
      onChange(state.draft);
    }
    dispatch({type: 'save'});
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      dispatch({type: 'cancel'});
    }
  }

  if (state.isEditing) {
    return (
      <form aria-label="Edit text" onSubmit={handleSubmit}>
        <Flex align="center" gap="sm">
          <Input
            ref={inputRef}
            size={inputSize}
            value={state.draft}
            onChange={e => dispatch({type: 'update', draft: e.target.value})}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
          />
          <Button priority="primary" size={saveButtonSize} type="submit">
            Save
          </Button>
        </Flex>
      </form>
    );
  }

  return (
    <Flex align="center" gap="xs">
      <Text size={size} {...textProps}>
        {children || placeholder}
      </Text>
      <Button
        priority="transparent"
        size={editButtonSize}
        icon={<IconEdit />}
        onClick={handleEdit}
        aria-label="Edit"
      />
    </Flex>
  );
}
