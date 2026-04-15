import {Outlet} from 'react-router-dom';

import Feature from 'sentry/components/acl/feature';
import {NoAccess} from 'sentry/components/noAccess';
import {NoProjectMessage} from 'sentry/components/noProjectMessage';
import {useOrganization} from 'sentry/utils/useOrganization';

export default function AttributesPage() {
  const organization = useOrganization();

  return (
    <Feature
      features={['visibility-explore-view']}
      organization={organization}
      renderDisabled={NoAccess}
    >
      <NoProjectMessage organization={organization}>
        <Outlet />
      </NoProjectMessage>
    </Feature>
  );
}
