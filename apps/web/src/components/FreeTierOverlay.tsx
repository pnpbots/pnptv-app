import React from 'react';
import { Link } from 'react-router-dom';

interface FreeTierOverlayProps {
  label?: string;
  requiredTier?: 'member' | 'prime';
  children: React.ReactNode;
}

export default function FreeTierOverlay({
  label = 'Upgrade to unlock',
  requiredTier = 'member',
  children,
}: FreeTierOverlayProps) {
  return (
    <div className="relative">
      <div className="pointer-events-none select-none" style={{ filter: 'blur(8px)' }}>
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 rounded-lg">
        <div className="text-white text-center p-4">
          <svg
            className="w-8 h-8 mx-auto mb-2 text-white/80"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <p className="text-sm font-medium mb-3">{label}</p>
          <Link
            to="/subscribe"
            className={`inline-block px-4 py-2 rounded-full text-sm font-semibold ${
              requiredTier === 'prime'
                ? 'bg-gradient-to-r from-yellow-400 to-amber-500 text-black'
                : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white'
            }`}
          >
            {requiredTier === 'prime' ? 'Upgrade to PRIME' : 'Become a Member'}
          </Link>
        </div>
      </div>
    </div>
  );
}
