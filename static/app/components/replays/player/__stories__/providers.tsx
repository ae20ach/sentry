import {StaticNoSkipReplayPreferences} from 'sentry/components/replays/preferences/replayPreferences';
import {ReplayPlayerPluginsContextProvider} from 'sentry/utils/replays/playback/providers/replayPlayerPluginsContext';
import {ReplayPlayerStateContextProvider} from 'sentry/utils/replays/playback/providers/replayPlayerStateContext';
import {ReplayPreferencesContextProvider} from 'sentry/utils/replays/playback/providers/replayPreferencesContext';
import {ReplayReaderProvider} from 'sentry/utils/replays/playback/providers/replayReaderProvider';
import type {ReplayReader} from 'sentry/utils/replays/replayReader';

export function Providers({
  children,
  replay,
}: {
  children: React.ReactNode;
  replay: ReplayReader;
}) {
  return (
    <ReplayPreferencesContextProvider prefsStrategy={StaticNoSkipReplayPreferences}>
      <ReplayPlayerPluginsContextProvider>
        <ReplayReaderProvider replay={replay}>
          <ReplayPlayerStateContextProvider>{children}</ReplayPlayerStateContextProvider>
        </ReplayReaderProvider>
      </ReplayPlayerPluginsContextProvider>
    </ReplayPreferencesContextProvider>
  );
}
