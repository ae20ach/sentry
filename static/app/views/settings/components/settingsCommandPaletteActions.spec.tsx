import {setSearchMap} from 'sentry/components/search/sources/formSource';

import {getSettingsFormActions} from './settingsCommandPaletteActions';

describe('getSettingsFormActions', () => {
  beforeEach(() => {
    setSearchMap([
      {
        title: 'Create Rage Click Issues',
        description: 'Toggles whether or not to create Session Replay Rage Click Issues',
        route: '/settings/:orgId/projects/:projectId/replays/',
        field: {name: 'sentry:replay_rage_click_issues'},
      },
    ]);
  });

  it('resolves settings route params for form search actions', async () => {
    const actions = await getSettingsFormActions('rage', {
      orgId: 'org-slug',
      projectId: 'project-slug',
    });

    const rageClickAction = actions.find(
      action => action.display.label === 'Create Rage Click Issues'
    );

    expect(rageClickAction).toEqual({
      display: {
        label: 'Create Rage Click Issues',
        details: 'Toggles whether or not to create Session Replay Rage Click Issues',
      },
      to: {
        pathname: '/settings/org-slug/projects/project-slug/replays/',
        hash: '#sentry%3Areplay_rage_click_issues',
      },
    });
  });
});
