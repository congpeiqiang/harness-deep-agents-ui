"use client";

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function DatabaseSelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <label htmlFor="db-select" className="whitespace-nowrap">
        数据库:
      </label>
      <select
        id="db-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-sm border border-input bg-background px-2 py-1 pr-6 text-xs text-foreground outline-none focus:border-primary"
        style={{
          WebkitAppearance: "none",
          MozAppearance: "none",
          appearance: "none",
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23666' d='M3 4.5l3 3 3-3'/%3E%3C/svg%3E")`,
          backgroundRepeat: "no-repeat",
          backgroundPosition: "right 4px center",
          backgroundSize: "12px",
        }}
      >
        <option value="aix_report">aix_report</option>
        <option value="Chinook_AutoIncrement">Chinook_AutoIncrement</option>
      </select>
    </div>
  );
}
