import {Fragment} from 'react';

import {displayRawContent as rawStacktraceContent} from 'sentry/components/events/interfaces/crashContent/stackTrace/rawContent';
import type {ExceptionType} from 'sentry/types/event';
import type {PlatformKey} from 'sentry/types/project';

interface Props {
  type: 'original' | 'minified';
  values: ExceptionType['values'];
  platform?: PlatformKey;
}

export function RawContent({type, platform, values}: Props) {
  if (!values) {
    return null;
  }

  return (
    <Fragment>
      {values.map((exc, excIdx) => {
        const exceptionValue =
          type === 'original' ? exc.value : exc.rawValue || exc.value;
        const exceptionType = type === 'original' ? exc.type : exc.rawType || exc.type;

        const rawContent = exc.stacktrace ? (
          rawStacktraceContent({
            data: type === 'original' ? exc.stacktrace : exc.rawStacktrace,
            platform,
            exception: exc,
            isMinified: type === 'minified',
          })
        ) : (
          <div>
            {exceptionType}: {exceptionValue}
          </div>
        );
        return (
          <div key={excIdx} data-test-id="raw-stack-trace">
            <pre className="traceback plain">{rawContent}</pre>
          </div>
        );
      })}
    </Fragment>
  );
}
