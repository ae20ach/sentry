import {withDelayedFetch} from './withDelayedFetch';
import {withMainThreadCpuLoad} from './withMainThreadCpuLoad';
import {withMemoryPressure} from './withMemoryPressure';
import {withMicrotaskChurn} from './withMicrotaskChurn';
import {withRealWallClockDelay} from './withRealWallClockDelay';

export const flakeStressProfiles = [
  ['mainThreadCpu', withMainThreadCpuLoad],
  ['microtaskChurn', withMicrotaskChurn],
  ['realWallClock', withRealWallClockDelay],
  ['delayedFetch', withDelayedFetch],
  ['memoryPressure', withMemoryPressure],
] as const;
