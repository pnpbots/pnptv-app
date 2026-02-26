import React, { Suspense } from "react";
import { Skeleton } from "@pnptv/ui-kit";

interface ModuleLoaderProps {
  children: React.ReactNode;
}

function PageSkeleton() {
  return (
    <div className="page-container space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-96" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export function ModuleLoader({ children }: ModuleLoaderProps) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}
