import {Fragment, useState} from 'react';
import styled from '@emotion/styled';

import {useOrganization} from 'sentry/utils/useOrganization';

interface AppIconProps {
  appName: string;
  appIconId?: string | null;
  objectstoreToken?: string | null;
  projectId?: number | null;
}

export function AppIcon({appName, appIconId, projectId, objectstoreToken}: AppIconProps) {
  const organization = useOrganization();
  const [imageError, setImageError] = useState(false);

  let iconUrl = undefined;
  if (appIconId && projectId) {
    const authSuffix = objectstoreToken
      ? `?X-Os-Auth=${encodeURIComponent(objectstoreToken)}`
      : '';
    iconUrl = `/api/0/organizations/${organization.slug}/objectstore/v1/objects/preprod/org=${organization.id};project=${projectId}/${organization.id}/${projectId}/${appIconId}${authSuffix}`;
  }

  return (
    <Fragment>
      {iconUrl && !imageError && (
        <AppIconImg
          src={iconUrl}
          alt="App Icon"
          width={24}
          height={24}
          onError={() => setImageError(true)}
        />
      )}
      {(!iconUrl || imageError) && (
        <AppIconPlaceholder>{appName.charAt(0)}</AppIconPlaceholder>
      )}
    </Fragment>
  );
}

const AppIconImg = styled('img')`
  border-radius: 4px;
`;

const AppIconPlaceholder = styled('div')`
  width: 24px;
  height: 24px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: ${p => p.theme.tokens.background.accent.vibrant};
  color: ${p => p.theme.tokens.content.onVibrant.light};
  font-weight: ${p => p.theme.font.weight.sans.medium};
  font-size: ${p => p.theme.font.size.sm};
`;
