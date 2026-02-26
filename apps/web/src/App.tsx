import React from "react";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { router } from "@/router";
import ErrorBoundary from "@/components/ErrorBoundary";

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ErrorBoundary>
  );
}
