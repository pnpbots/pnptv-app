import React from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, "-");
    return (
      <div className="space-y-1">
        {label && (
          <label htmlFor={inputId} className="block text-sm text-pnp-textSecondary">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`w-full rounded-lg bg-pnp-surface border border-pnp-border px-3 py-2 text-pnp-textPrimary placeholder-pnp-textSecondary focus:outline-none focus:ring-2 focus:ring-pnp-accent focus:border-transparent transition-colors ${error ? "border-pnp-error" : ""} ${className}`}
          {...props}
        />
        {error && <p className="text-sm text-pnp-error">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
