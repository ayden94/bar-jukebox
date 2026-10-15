import { GuestApp } from "./guest-app";

export default function GuestPage(props: Record<string, unknown>) {
  return (
    <GuestApp
      error={typeof props.error === "string" ? props.error : undefined}
      tableLabel={typeof props.tableLabel === "string" ? props.tableLabel : ""}
    />
  );
}
