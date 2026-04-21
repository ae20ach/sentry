import {render, screen, userEvent} from 'sentry-test/reactTestingLibrary';

import {TextEditable} from '@sentry/scraps/text';

describe('TextEditable', () => {
  it('renders text value in display mode', () => {
    render(<TextEditable onChange={jest.fn()}>Hello World</TextEditable>);
    expect(screen.getByText('Hello World')).toBeInTheDocument();
  });

  it('shows edit button in display mode', () => {
    render(<TextEditable onChange={jest.fn()}>Hello World</TextEditable>);
    expect(screen.getByRole('button', {name: 'Edit'})).toBeInTheDocument();
  });

  it('switches to edit mode when edit button is clicked', async () => {
    render(<TextEditable onChange={jest.fn()}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Save'})).toBeInTheDocument();
  });

  it('populates input with current value when entering edit mode', async () => {
    render(<TextEditable onChange={jest.fn()}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));

    expect(screen.getByRole('textbox')).toHaveValue('Hello World');
  });

  it('wraps edit mode content in a form element', async () => {
    render(<TextEditable onChange={jest.fn()}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));

    expect(screen.getByRole('form', {name: 'Edit text'})).toBeInTheDocument();
  });

  it('calls onChange with new value when Save is clicked', async () => {
    const onChange = jest.fn();
    render(<TextEditable onChange={onChange}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'New Value');
    await userEvent.click(screen.getByRole('button', {name: 'Save'}));

    expect(onChange).toHaveBeenCalledWith('New Value');
  });

  it('calls onChange with new value when Enter is pressed', async () => {
    const onChange = jest.fn();
    render(<TextEditable onChange={onChange}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), 'New Value');
    await userEvent.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('New Value');
  });

  it('returns to display mode after saving', async () => {
    const onChange = jest.fn();
    render(<TextEditable onChange={onChange}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));
    await userEvent.click(screen.getByRole('button', {name: 'Save'}));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Edit'})).toBeInTheDocument();
  });

  it('cancels edit and does not call onChange when Escape is pressed', async () => {
    const onChange = jest.fn();
    render(<TextEditable onChange={onChange}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));
    await userEvent.type(screen.getByRole('textbox'), ' Updated');
    await userEvent.keyboard('{Escape}');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('resets draft to current value when re-entering edit mode after cancel', async () => {
    render(<TextEditable onChange={jest.fn()}>Hello World</TextEditable>);

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));
    await userEvent.type(screen.getByRole('textbox'), ' Updated');
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', {name: 'Edit'}));

    expect(screen.getByRole('textbox')).toHaveValue('Hello World');
  });

  it('shows placeholder when children is empty', () => {
    render(
      <TextEditable onChange={jest.fn()} placeholder="Enter a name">
        {''}
      </TextEditable>
    );
    expect(screen.getByText('Enter a name')).toBeInTheDocument();
  });
});
