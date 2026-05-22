import { cn } from "@/lib/utils";
// TODO  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82VmxGTFVRPT06ZTQ1NDQzZjk=

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
// eslint-disable  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82VmxGTFVRPT06ZTQ1NDQzZjk=

export { Skeleton };
