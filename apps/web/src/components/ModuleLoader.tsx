import React, { Suspense } from "react";
import { Skeleton } from "@pnptv/ui-kit";

interface ModuleLoaderProps {
  children: React.ReactNode;
}

function PageSkeleton() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-[#D4007A] border-t-transparent animate-spin" />
    </div>
  );
}

export function ModuleLoader({ children }: ModuleLoaderProps) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}
