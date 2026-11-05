import { forwardRef, type SelectHTMLAttributes } from "react";
import { useDirectory } from "@/hooks/api";
import { Select } from "./ui/input";

export const UserSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { emptyLabel?: string }>(
  ({ emptyLabel, children, ...props }, ref) => {
    const dir = useDirectory();
    return (
      <Select ref={ref} {...props}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {children}
        {dir.data?.map((u) => (
          <option key={u.uid} value={u.uid}>
            {u.displayName}
          </option>
        ))}
      </Select>
    );
  },
);
UserSelect.displayName = "UserSelect";
