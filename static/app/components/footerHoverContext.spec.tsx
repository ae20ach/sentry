import {act, render, screen, userEvent} from 'sentry-test/reactTestingLibrary';

import {
  COOLING_PERIOD_MS,
  FooterHoverProvider,
  useFooterHover,
} from './footerHoverContext';

function TestHarness() {
  const {hoverState, setFooterHovered, setButtonAreaHovered} = useFooterHover();
  return (
    <div>
      <span data-test-id="state">{hoverState}</span>
      <button data-test-id="footer-enter" onClick={() => setFooterHovered(true)} />
      <button data-test-id="footer-leave" onClick={() => setFooterHovered(false)} />
      <button data-test-id="button-enter" onClick={() => setButtonAreaHovered(true)} />
      <button data-test-id="button-leave" onClick={() => setButtonAreaHovered(false)} />
    </div>
  );
}

function renderHarness() {
  const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
  render(
    <FooterHoverProvider>
      <TestHarness />
    </FooterHoverProvider>
  );
  return {
    state: () => screen.getByTestId('state').textContent,
    footerEnter: () => user.click(screen.getByTestId('footer-enter')),
    footerLeave: () => user.click(screen.getByTestId('footer-leave')),
    buttonEnter: () => user.click(screen.getByTestId('button-enter')),
    buttonLeave: () => user.click(screen.getByTestId('button-leave')),
  };
}

describe('FooterHoverContext', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts in off state', () => {
    const {state} = renderHarness();
    expect(state()).toBe('off');
  });

  it('transitions to active when footer is entered', async () => {
    const {state, footerEnter} = renderHarness();
    await footerEnter();
    expect(state()).toBe('active');
  });

  it('stays active during cooling period after footer leave', async () => {
    const {state, footerEnter, footerLeave} = renderHarness();
    await footerEnter();
    await footerLeave();
    expect(state()).toBe('active');
  });

  it('transitions to off after cooling period expires', async () => {
    const {state, footerEnter, footerLeave} = renderHarness();
    await footerEnter();
    await footerLeave();
    act(() => jest.advanceTimersByTime(COOLING_PERIOD_MS));
    expect(state()).toBe('off');
  });

  it('locks when button area is entered during cooling period', async () => {
    const {state, footerEnter, footerLeave, buttonEnter} = renderHarness();
    await footerEnter();
    await footerLeave();
    await buttonEnter();
    expect(state()).toBe('locked');

    act(() => jest.advanceTimersByTime(COOLING_PERIOD_MS));
    expect(state()).toBe('locked');
  });

  it('locks when button area is entered while footer is active', async () => {
    const {state, footerEnter, buttonEnter} = renderHarness();
    await footerEnter();
    await buttonEnter();
    expect(state()).toBe('locked');
  });

  it('stays locked when footer leaves while button area is hovered', async () => {
    const {state, footerEnter, footerLeave, buttonEnter} = renderHarness();
    await footerEnter();
    await buttonEnter();
    await footerLeave();
    expect(state()).toBe('locked');
  });

  it('stays off when button area is entered without prior footer hover', async () => {
    const {state, buttonEnter} = renderHarness();
    await buttonEnter();
    expect(state()).toBe('off');
  });

  it('transitions to off when button area leaves and footer is not hovered', async () => {
    const {state, footerEnter, footerLeave, buttonEnter, buttonLeave} = renderHarness();
    await footerEnter();
    await buttonEnter();
    await footerLeave();
    await buttonLeave();
    expect(state()).toBe('off');
  });

  it('transitions to active when button area leaves but footer is still hovered', async () => {
    const {state, footerEnter, buttonEnter, buttonLeave} = renderHarness();
    await footerEnter();
    await buttonEnter();
    await buttonLeave();
    expect(state()).toBe('active');
  });

  it('cancels cooling when footer is re-entered', async () => {
    const {state, footerEnter, footerLeave} = renderHarness();
    await footerEnter();
    await footerLeave();
    await footerEnter();
    act(() => jest.advanceTimersByTime(COOLING_PERIOD_MS));
    expect(state()).toBe('active');
  });
});
