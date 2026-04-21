import {RuleTester} from '@typescript-eslint/rule-tester';

import {noReactTypeImport} from './no-react-type-import';

const ruleTester = new RuleTester();

ruleTester.run('no-react-type-import', noReactTypeImport, {
  valid: [
    // React namespace access is the preferred pattern.
    {
      code: `type Props = {children: React.ReactNode};`,
      filename: '/static/app/file.tsx',
    },
    // Value imports from 'react' are fine (hooks, etc).
    {
      code: `import {useState} from 'react';\nconst [x] = useState(0);`,
      filename: '/static/app/file.tsx',
    },
    // Default and namespace imports of React are fine.
    {
      code: `import React from 'react';`,
      filename: '/static/app/file.tsx',
    },
    {
      code: `import * as React from 'react';`,
      filename: '/static/app/file.tsx',
    },
    // Imports from other packages untouched.
    {
      code: `import type {Foo} from 'other';\ntype X = Foo;`,
      filename: '/static/app/file.tsx',
    },
  ],

  invalid: [
    // `import type {X} from 'react'` — remove whole line.
    {
      code: `import type {ReactNode} from 'react';\ntype Props = {children: ReactNode};`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `type Props = {children: React.ReactNode};`,
    },
    // `import type {X, Y} from 'react'` — two reports, one fix removes line.
    {
      code: `import type {FC, ReactNode} from 'react';\ntype A = FC;\ntype B = ReactNode;`,
      filename: '/static/app/file.tsx',
      errors: [
        {messageId: 'forbidden', data: {name: 'FC'}},
        {messageId: 'forbidden', data: {name: 'ReactNode'}},
      ],
      output: `type A = React.FC;\ntype B = React.ReactNode;`,
    },
    // Inline type specifier alongside a value specifier.
    {
      code: `import {useState, type ReactNode} from 'react';\ntype P = ReactNode;\nconst [x] = useState(0);`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `import {useState} from 'react';\ntype P = React.ReactNode;\nconst [x] = useState(0);`,
    },
    // Inline type specifier before a value specifier.
    {
      code: `import {type ReactNode, useState} from 'react';\ntype P = ReactNode;\nconst [x] = useState(0);`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `import {useState} from 'react';\ntype P = React.ReactNode;\nconst [x] = useState(0);`,
    },
    // All specs are types but sit next to a default import.
    {
      code: `import React, {type ReactNode} from 'react';\ntype P = ReactNode;\nReact.createElement('div');`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `import React from 'react';\ntype P = React.ReactNode;\nReact.createElement('div');`,
    },
    // Renamed type import — replacement uses the imported (remote) name.
    {
      code: `import type {ReactNode as Node} from 'react';\ntype P = Node;`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `type P = React.ReactNode;`,
    },
    // Used in generic position.
    {
      code: `import type {ComponentProps} from 'react';\ntype X = ComponentProps<typeof Foo>;`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ComponentProps'}}],
      output: `type X = React.ComponentProps<typeof Foo>;`,
    },
    // Multiple references to the same imported type.
    {
      code: `import type {ReactNode} from 'react';\ntype A = ReactNode;\ntype B = ReactNode;`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `type A = React.ReactNode;\ntype B = React.ReactNode;`,
    },
    // Mixed: one flagged, one value, with default import present.
    {
      code: `import React, {type ReactNode, useState} from 'react';\ntype P = ReactNode;\nconst [x] = useState(0);\nReact.createElement('div');`,
      filename: '/static/app/file.tsx',
      errors: [{messageId: 'forbidden', data: {name: 'ReactNode'}}],
      output: `import React, {useState} from 'react';\ntype P = React.ReactNode;\nconst [x] = useState(0);\nReact.createElement('div');`,
    },
    // Multiple inline type specs alongside value specs, with references far
    // from the import. Exercises the single-rangehull strategy.
    {
      code:
        `import {useState, type Dispatch, type SetStateAction} from 'react';\n` +
        `type Foo = {bar: Dispatch<SetStateAction<string>>};\n` +
        `const [x] = useState('');`,
      filename: '/static/app/file.tsx',
      errors: [
        {messageId: 'forbidden', data: {name: 'Dispatch'}},
        {messageId: 'forbidden', data: {name: 'SetStateAction'}},
      ],
      output:
        `import {useState} from 'react';\n` +
        `type Foo = {bar: React.Dispatch<React.SetStateAction<string>>};\n` +
        `const [x] = useState('');`,
    },
  ],
});
