import type {OrganizationIntegration} from 'sentry/types/integrations';

export function VercelOrganizationIntegrationFixture(
  params: Partial<OrganizationIntegration> = {}
): OrganizationIntegration {
  return {
    id: '1',
    name: 'my-vercel-team',
    icon: null,
    domainName: 'vercel.com/my-vercel-team',
    accountType: null,
    status: 'active',
    provider: {
      key: 'vercel',
      slug: 'vercel',
      name: 'Vercel',
      canAdd: false,
      canDisable: false,
      features: ['deployment'],
      aspects: {},
    },
    configOrganization: [],
    configData: {},
    externalId: 'my-vercel-team',
    organizationId: '',
    organizationIntegrationStatus: 'active',
    gracePeriodEnd: '',
    ...params,
  };
}
