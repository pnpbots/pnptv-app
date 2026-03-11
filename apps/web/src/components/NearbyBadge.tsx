import React from 'react';

interface NearbyBadgeProps {
  userCity?: string | null;
  userCountry?: string | null;
  viewerCity?: string | null;
  viewerCountry?: string | null;
  username: string;
}

export function NearbyBadge({ userCity, userCountry, viewerCity, viewerCountry, username }: NearbyBadgeProps) {
  const isSameCity = userCity && viewerCity && userCity === viewerCity;
  const isSameCountry = userCountry && viewerCountry && userCountry === viewerCountry;

  let badgeText = '';
  let hoverText = '';

  if (isSameCity) {
    badgeText = 'Member Nearby You';
    hoverText = `${username} is also in ${userCity}`;
  } else if (isSameCountry) {
    badgeText = 'Member Nearby You';
    hoverText = `${username} is also in ${userCountry}`;
  } else {
    return null; // Don't render badge if not nearby
  }

  return (
    <span
      className="inline-flex items-center rounded-full bg-blue-400/10 px-2 py-0.5 text-xs font-medium text-blue-400 ring-1 ring-inset ring-blue-400/30"
      title={hoverText}
    >
      {badgeText}
    </span>
  );
}
