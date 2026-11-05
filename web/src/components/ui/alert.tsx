import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const alertVariants = cva("flex gap-3 rounded-lg border p-4 text-sm [&_svg]:mt-0.5 [&_svg]:size-5 [&_svg]:shrink-0", {
  variants: {
    variant: {
      default: "bg-card",
      destructive: "border-destructive/50 bg-destructive/10 text-foreground [&_svg]:text-destructive",
      warning: "border-warning/50 bg-warning/10 text-foreground [&_svg]:text-warning",
      info: "border-primary/30 bg-primary/5",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Alert({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>) {
  return <div role={variant === "destructive" ? "alert" : "status"} className={cn(alertVariants({ variant }), className)} {...props} />;
}
