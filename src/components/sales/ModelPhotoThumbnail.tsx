'use client';

import React, { useState } from 'react';

interface ModelPhotoThumbnailProps {
  src?: string | null;
  alt: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  showBadgeWhenNoPhoto?: boolean;
}

const sizeClasses = {
  xs: 'w-8 h-8 text-[10px]',
  sm: 'w-12 h-12 text-xs',
  md: 'w-16 h-16 text-sm',
  lg: 'w-24 h-24 text-base',
  xl: 'w-36 h-36 text-lg',
};

const iconSizes = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 36,
  xl: 48,
};

export const ModelPhotoThumbnail: React.FC<ModelPhotoThumbnailProps> = ({
  src,
  alt,
  size = 'md',
  className = '',
  rounded = 'lg',
}) => {
  const [loadError, setLoadError] = useState(false);

  const roundedClass =
    rounded === 'full'
      ? 'rounded-full'
      : rounded === '2xl'
      ? 'rounded-2xl'
      : rounded === 'xl'
      ? 'rounded-xl'
      : rounded === 'lg'
      ? 'rounded-lg'
      : rounded === 'sm'
      ? 'rounded-sm'
      : rounded === 'md'
      ? 'rounded-md'
      : 'rounded-xl';

  const hasValidPhoto = Boolean(src && !loadError);

  if (hasValidPhoto) {
    return (
      <div
        className={`relative inline-flex items-center justify-center overflow-hidden border border-amber-200/80 bg-stone-900 shadow-sm shrink-0 ${sizeClasses[size]} ${roundedClass} ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src!}
          alt={alt}
          className="w-full h-full object-cover"
          loading="lazy"
          onError={() => setLoadError(true)}
        />
      </div>
    );
  }

  // Graceful Fallback Placeholder: Elegant Gold Jewelry / Diamond SVG
  const iconPx = iconSizes[size];

  return (
    <div
      aria-label={`Rasm yo'q: ${alt}`}
      className={`relative inline-flex items-center justify-center border border-dashed border-amber-300/40 bg-gradient-to-br from-amber-50 to-amber-100/60 dark:from-stone-900 dark:to-stone-800 text-amber-600 dark:text-amber-400 select-none shrink-0 ${sizeClasses[size]} ${roundedClass} ${className}`}
    >
      <svg
        width={iconPx}
        height={iconPx}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="opacity-75 drop-shadow-sm"
      >
        {/* Diamond / Gem silhouette */}
        <path d="M6 3h12l4 6-10 12L2 9z" />
        <path d="M11 3 8 9l4 12 4-12-3-6" />
        <path d="M2 9h20" />
      </svg>
    </div>
  );
};
