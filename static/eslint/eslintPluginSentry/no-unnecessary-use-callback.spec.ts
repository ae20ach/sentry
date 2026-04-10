import {RuleTester} from '@typescript-eslint/rule-tester';

import {noUnnecessaryUseCallback} from './no-unnecessary-use-callback';

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {jsx: true},
    },
  },
});

ruleTester.run('no-unnecessary-use-callback', noUnnecessaryUseCallback, {
  valid: [
    {
      name: 'useCallback passed directly to custom component',
      code: `
        const fn = useCallback(() => {
          console.log('click');
        }, []);
        <MyComponent onClick={fn} />
      `,
    },
    {
      name: 'regular function passed to intrinsic element',
      code: `
        const fn = () => console.log('click');
        <button onClick={fn} />
      `,
    },
    {
      name: 'regular function wrapped in arrow on intrinsic element',
      code: `
        const fn = () => console.log('click');
        <button onClick={() => fn()} />
      `,
    },
    {
      name: 'inline arrow on intrinsic element without useCallback',
      code: `
        <button onClick={() => console.log('click')} />
      `,
    },
    {
      name: 'useCallback used in dependency array',
      code: `
        const fn = useCallback(() => {}, []);
        useEffect(() => { fn() }, [fn]);
      `,
    },
    {
      name: 'useCallback result used in non-JSX context',
      code: `
        const fn = useCallback(() => {}, []);
        someFunction(fn);
      `,
    },
    {
      name: 'arrow wrapping a call to a different function',
      code: `
        const fn = useCallback(() => {}, []);
        <button onClick={() => otherFn()} />
      `,
    },
    {
      name: 'useCallback passed directly to namespaced custom component',
      code: `
        const fn = useCallback(() => {}, []);
        <Namespace.Component onClick={fn} />
      `,
    },
    {
      name: 'arrow body calls non-useCallback function',
      code: `
        const fn = useCallback(() => {}, []);
        <button onClick={() => { doSomethingElse(); }} />
      `,
    },
    {
      name: 'useCallback justified by custom component usage alongside direct invocation',
      code: `
        const fn = useCallback(() => {}, []);
        <><MyComponent onClick={fn} /><button onClick={() => fn()} /></>
      `,
    },
    {
      name: 'useCallback justified by custom component usage alongside intrinsic element',
      code: `
        const fn = useCallback(() => {}, []);
        <><MyComponent onClick={fn} /><button onClick={fn} /></>
      `,
    },
    {
      name: 'useCallback passed as callback ref to intrinsic element',
      code: `
        const fn = useCallback((node) => {
          if (node) node.focus();
        }, []);
        <input ref={fn} />
      `,
    },
  ],

  invalid: [
    {
      name: 'arrow wrap on intrinsic element',
      code: `
        const fn = useCallback(() => {
          console.log('click');
        }, []);
        <button onClick={() => fn()} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'arrow wrap on custom component',
      code: `
        const fn = useCallback(() => {
          console.log('click');
        }, []);
        <MyComponent onClick={() => fn()} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'arrow wrap with argument forwarding',
      code: `
        const fn = useCallback((e) => {
          console.log(e);
        }, []);
        <button onClick={(e) => fn(e)} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'direct reference on <button>',
      code: `
        const fn = useCallback((e) => {
          console.log('click');
        }, []);
        <button onClick={fn} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'direct reference on <div>',
      code: `
        const fn = useCallback(() => {}, []);
        <div onMouseEnter={fn} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'direct reference on <input>',
      code: `
        const fn = useCallback(() => {}, []);
        <input onChange={fn} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'direct reference on <a>',
      code: `
        const fn = useCallback(() => {}, []);
        <a onClick={fn} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
    {
      name: 'arrow wrap with multiple arguments',
      code: `
        const handler = useCallback((a, b) => {}, []);
        <button onClick={(a, b) => handler(a, b)} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'handler'}}],
    },
    {
      name: 'useCallback called inside block-body arrow with additional logic',
      code: `
        const fn = useCallback(() => {}, []);
        <button onClick={() => { fn(); doSomethingElse(); }} />
      `,
      errors: [{messageId: 'unnecessaryUseCallback', data: {name: 'fn'}}],
    },
  ],
});
