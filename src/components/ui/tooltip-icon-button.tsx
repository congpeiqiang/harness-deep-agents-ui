import React from "react";
import { Button } from "./button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
// eslint-disable  MC8yOmFIVnBZMlhrdUp2bG43bmx2TG82UjJaNGRnPT06NDc0ZWVhYTk=

interface TooltipIconButtonProps {
  icon: React.ReactNode;
  onClick: () => void;
  tooltip: string;
  disabled?: boolean;
}
// TODO  MS8yOmFIVnBZMlhrdUp2bG43bmx2TG82UjJaNGRnPT06NDc0ZWVhYTk=

export function TooltipIconButton({
  icon,
  onClick,
  tooltip,
  disabled,
}: TooltipIconButtonProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClick}
            disabled={disabled}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
